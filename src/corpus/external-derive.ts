import "@tanstack/react-start/server-only";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { deriveRequest } from "#/db/schema";
import { alignModel, extractModel, savedCompletions } from "#/server/chat";
import { alignment } from "./align";
import { currentTree, type DeriveStandard, UNDERIVED } from "./derive-standard";
import { type DeriveInput, extraction, promptInput } from "./extract";
import type { CorpusClient } from "./session";

// 将岗位、公司、描述编码为数组再计算摘要，字段里的换行也属于输入。队列表只引用经历。
export const inputKeySql =
	"encode(sha256(convert_to(jsonb_build_array(e.title,e.company,e.description)::text,'UTF8')),'hex')";

/** 在写者锁内收集本轮需要处理的输入，复用已保存的结果。返回后无需等外部服务。 */
export async function prepareExternal(
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
				const { rows } = await client.query<
					Pick<DeriveInput, "title" | "company" | "description"> & {
						id: number;
					}
				>(
					"select id,title,company,description from experience where id=any($1::int[])",
					[batch.map((r) => r.id)],
				);
				const prompts = rows.map((row) => ({
					id: row.id,
					text: promptInput(row),
				}));
				const hits = await savedCompletions(
					model,
					spec.system,
					spec.schema,
					prompts.map((row) => row.text),
				);
				for (const { text, id } of prompts) byId.set(id, hits.get(text));
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
const submission = z.union([
	z.strictObject({ id, result: z.unknown() }),
	z.strictObject({ id, unable: z.literal(true) }),
]);

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
	current: DeriveStandard,
	kind: Kind,
	standard: string,
	results: unknown[],
) {
	const spec = current[kind];
	const items = results.map((value, index): Receipt | Result => {
		const parsed = submission.safeParse(value);
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
	if (items.every((item) => "status" in item))
		return { receipts: items, added: 0 };
	const ids = items.flatMap((item) => ("result" in item ? [item.id] : []));
	return db.transaction(async (tx) => {
		const stored = await tx
			.select({
				id: deriveRequest.id,
				result: deriveRequest.result,
				failedVersion: deriveRequest.failedVersion,
			})
			.from(deriveRequest)
			.where(
				and(
					eq(deriveRequest.standard, standard),
					isNotNull(deriveRequest.experienceId),
					inArray(deriveRequest.id, ids),
				),
			)
			.orderBy(deriveRequest.id)
			.for("update");
		// 并发批次按编号顺序锁定请求；同一批里按提交顺序保留第一份结果。
		const byId = new Map(stored.map((row) => [row.id, row]));
		const added: Result[] = [];
		const receipts = items.map((item): Receipt => {
			if ("status" in item) return item;
			const { id } = item;
			const prior = byId.get(id);
			if (!prior) return { id, status: "expired" };
			if (prior.result === null && prior.failedVersion === null) {
				byId.set(id, item);
				added.push(item);
				return { id, status: "accepted" };
			}
			const same =
				prior.failedVersion === item.failedVersion &&
				isDeepStrictEqual(prior.result, item.result);
			return { id, status: same ? "accepted" : "conflict" };
		});
		if (added.length)
			await tx.execute(sql`update derive_request q set result=r.result, failed_version=r."failedVersion"
			from jsonb_to_recordset(${JSON.stringify(added)}::jsonb) as r(id int, result jsonb, "failedVersion" text)
			where q.id=r.id`);
		return { receipts, added: added.length };
	});
}
