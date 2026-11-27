import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { pool } from "#/db";
import { alignModel, extractModel } from "#/server/chat";
import { alignment } from "./align";
import { standardOf } from "./answer-standard";
import {
	currentTree,
	type DeriveStandard,
	deriveStandard,
	UNDERIVED,
} from "./derive-standard";
import { type DeriveInput, extraction, promptInput } from "./extract";
import type { CorpusClient } from "./session";

type InputText = Pick<DeriveInput, "title" | "company" | "description">;

function textSha(row: InputText) {
	const fields = [row.title, row.company, row.description];
	// 字段中也可能出现「换行 + 字段名」。此时保留字段边界，避免不同经历共用回答。
	const input = fields.some((value) => /\n(?:公司|描述)：/u.test(value))
		? JSON.stringify(fields)
		: promptInput(row);
	return createHash("sha256").update(input).digest("hex");
}

async function modelAnswers(
	client: CorpusClient,
	identity: string,
	schema: z.ZodType,
	hashes: string[],
) {
	const { rows } = await client.query<{ text_sha: string; payload: unknown }>(
		"select text_sha,payload from completion_cache where identity=$1 and text_sha=any($2::text[])",
		[identity, hashes],
	);
	const answers = new Map<string, unknown>();
	for (const row of rows) {
		const answer = schema.safeParse(row.payload);
		if (answer.success && storable(answer.data))
			answers.set(row.text_sha, answer.data);
	}
	return answers;
}
// 将岗位、公司、描述编码为数组再计算摘要，字段里的换行也属于输入。队列表只引用经历。
export const inputKeySql =
	"encode(sha256(convert_to(jsonb_build_array(e.title,e.company,e.description)::text,'UTF8')),'hex')";

/** 在写者锁内收集本轮需要处理的输入，复用已保存的结果。原文来自仍在库里的同一输入。 */
export async function prepareDeriveRequests(
	client: CorpusClient,
	{ tree, version, extract, align }: DeriveStandard,
) {
	await client.query(
		"delete from derive_request where standard <> all($1::text[]) or failed_version <> $2",
		[[extract.standard, align.standard], version],
	);
	for (const kind of ["extract", "align"] as const) {
		if (kind === "align" && !tree.length) continue;
		const spec = kind === "extract" ? extract : align;
		const model = kind === "extract" ? extractModel() : alignModel();
		// 新经历需要请求。同一输入的原经历已删除时，仍可用库里另一段经历保留已有结果。
		const { rows: missing } = await client.query<{ id: number; key: string }>(
			`
			select min(e.id) as id, ${inputKeySql} as key from experience e
			left join derive_request q on q.standard=$2 and q.input_key=${inputKeySql}
			where e.kind='external' and not e.unemployed and ($3='align' or e.description <> '')
				and q.experience_id is null
				and ((${UNDERIVED}) or q.result is not null or q.failed_version=$1)
			group by 2`,
			[version, spec.standard, kind],
		);
		for (let start = 0; start < missing.length; start += 500) {
			const batch = missing.slice(start, start + 500);
			const byId = new Map<number, unknown>();
			if (model) {
				const { rows } = await client.query<InputText & { id: number }>(
					"select id,title,company,description from experience where id=any($1::int[])",
					[batch.map((r) => r.id)],
				);
				const keys = rows.map((row) => ({ id: row.id, hash: textSha(row) }));
				const saved = await modelAnswers(
					client,
					standardOf(spec.system, spec.schema, model),
					spec.schema,
					keys.map((key) => key.hash),
				);
				for (const { id, hash } of keys) byId.set(id, saved.get(hash));
			}
			await client.query(
				`insert into derive_request (experience_id,standard,input_key,result)
				select r.id,$1,r.key,r.result from jsonb_to_recordset($2) r(id int,key text,result jsonb)
				on conflict (standard,input_key) do update set experience_id=excluded.experience_id where derive_request.experience_id is null`,
				[
					spec.standard,
					JSON.stringify(
						batch.map(({ id, key }) => ({ id, key, result: byId.get(id) })),
					),
				],
			);
		}
	}
	await client.query("delete from derive_request where experience_id is null");
}

type Kind = "extract" | "align";

export async function pendingInputs(
	client: CorpusClient,
	{
		kind,
		limit,
		part,
		parts,
	}: { kind: Kind; limit: number; part: number; parts: number },
) {
	const spec =
		kind === "extract" ? extraction : alignment(await currentTree(client));
	const { rows } = await client.query<{
		id: number;
		emp_id: string;
		title: string;
		company: string;
		description: string;
	}>(
		`select q.id,e.emp_id,e.title,e.company,e.description
		from derive_request q join experience e on e.id=q.experience_id
		where q.standard=$1 and q.result is null and q.failed_version is null and q.id % $2=$3
		order by q.id limit $4`,
		[spec.standard, parts, part, limit],
	);
	return {
		empIds: [...new Set(rows.map((row) => row.emp_id))],
		instructions: spec.system,
		schema: z.toJSONSchema(spec.schema),
		standard: spec.standard,
		inputs: rows.map(({ id, title, company, description }) => ({
			id,
			title,
			company,
			description,
		})),
	};
}

const id = z.int32().positive();
export function deriveAnswer<T extends z.ZodType>(result: T) {
	return z.union([
		z.strictObject({ id, result }),
		z.strictObject({ id, unable: z.literal(true) }),
	]);
}
const answerEnvelope = deriveAnswer(z.unknown());

type Receipt =
	| { index: number; status: "invalid" }
	| { id: number; status: "accepted" | "conflict" | "expired" | "invalid" };
type Result = { id: number; result: unknown; failedVersion: string | null };

/** JSONB 的字符串需要有效的 Unicode，且不能含零字符。结果的键由解析标准给定。 */
function storable(value: unknown): boolean {
	if (typeof value === "string")
		return value.isWellFormed() && !value.includes("\u0000");
	if (value && typeof value === "object")
		return Object.values(value).every(storable);
	return true;
}

export async function saveResults(
	kind: Kind,
	standard: string,
	results: unknown[],
	model?: string,
) {
	const client = await pool.connect();
	try {
		await client.query("begin");
		// 同步替换序列目录与本次判定标准检查、回执写入串行。
		await client.query("lock table sequence_catalog in share mode");
		const current = await deriveStandard(client);
		const spec = current[kind];
		const items = results.map((value, index): Receipt | Result => {
			const parsed = answerEnvelope.safeParse(value);
			if (!parsed.success) return { index, status: "invalid" };
			const { id } = parsed.data;
			if (standard !== spec.standard) return { id, status: "expired" };
			if ("unable" in parsed.data)
				return { id, result: null, failedVersion: current.version };
			const checked = spec.schema.safeParse(parsed.data.result);
			if (!checked.success || !storable(checked.data))
				return { id, status: "invalid" };
			return { id, result: checked.data, failedVersion: null };
		});
		const ids = items.flatMap((item) => ("result" in item ? [item.id] : []));
		const { rows } = await client.query<Result & InputText>(
			`select q.id,q.result,q.failed_version as "failedVersion",e.title,e.company,e.description
		 from derive_request q left join experience e on $3 and e.id=q.experience_id
		 where q.experience_id is not null and q.standard=$1 and q.id=any($2::int[]) order by q.id for update of q`,
			[standard, ids, Boolean(model)],
		);
		const byId = new Map<number, Result>(rows.map((row) => [row.id, row]));
		const added: Result[] = [];
		const identity = model
			? standardOf(spec.system, spec.schema, model)
			: undefined;
		const hashes = new Map(
			identity ? rows.map((row) => [row.id, textSha(row)] as const) : [],
		);
		const cached = identity
			? await modelAnswers(client, identity, spec.schema, [...hashes.values()])
			: new Map<string, unknown>();

		const receipts = items.map((item): Receipt => {
			if ("status" in item) return item;
			const { id } = item;
			const prior = byId.get(id);
			if (!prior) return { id, status: "expired" };
			if (prior.result === null && prior.failedVersion === null) {
				const saved = cached.get(hashes.get(id) as string);
				const answer =
					saved === undefined
						? item
						: { id, result: saved, failedVersion: null };
				byId.set(id, answer);
				added.push(answer);
				return {
					id,
					status:
						saved === undefined || isDeepStrictEqual(saved, item.result)
							? "accepted"
							: "conflict",
				};
			}
			const same =
				prior.failedVersion === item.failedVersion &&
				isDeepStrictEqual(prior.result, item.result);
			return { id, status: same ? "accepted" : "conflict" };
		});
		if (added.length) {
			await client.query(
				`update derive_request q set result=r.result, failed_version=r."failedVersion"
				from jsonb_to_recordset($1::jsonb) as r(id int,result jsonb,"failedVersion" text)
				where q.id=r.id`,
				[JSON.stringify(added)],
			);
			if (identity) {
				const answers = added
					.filter((item) => item.result !== null)
					.map((item) => ({ hash: hashes.get(item.id), payload: item.result }));
				await client.query(
					`insert into completion_cache (identity,text_sha,payload)
					select $1,hash,payload from jsonb_to_recordset($2::jsonb) as a(hash text,payload jsonb)
					order by hash on conflict (identity,text_sha) do update set payload=excluded.payload
					where completion_cache.payload is distinct from excluded.payload`,
					[identity, JSON.stringify(answers)],
				);
			}
		}
		await client.query("commit");
		return { receipts, added: added.length };
	} catch (error) {
		await client.query("rollback");
		throw error;
	} finally {
		client.release(client.getTransactionStatus() !== "I");
	}
}
