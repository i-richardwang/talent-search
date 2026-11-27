/**
 * 为待处理经历段抽取说法、对齐序列并连边。
 * 模型调用在事务外，结果按批提交说法、边和解析版本。模型答不出的段同样有结果：
 * 记录为解析失败，判定标准变了才重新问；端点故障让这一轮中止，下一轮接着。
 * 每轮按 id 向后处理，时间预算耗尽后退出。判定标准变了以后，新结果先写进
 * `experience_next`，每一段都有了新结果再一次替换正式表：检索一直读一份完整的标准。
 */

import "@tanstack/react-start/server-only";
import { runCorpusAgent } from "#/server/corpus-agent";
import { alignmentOf, type SeqPair } from "./align";
import { inputKeySql, prepareDeriveRequests } from "./derive-requests";
import {
	type DeriveStandard,
	deriveStandard,
	deriveToken,
	UNDERIVED,
} from "./derive-standard";
import {
	type DeriveInput,
	type ExtractionResult,
	extractionOf,
} from "./extract";
import { prunePhrases } from "./phrases";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import { type Phrasing, phrasesOf } from "./route-texts";
import type { CorpusClient, CorpusSession } from "./session";

const BATCH = 200;

type StoredRow = DeriveInput &
	Pick<ExperienceRow, "seq_l1" | "seq_l2" | "seq_l3"> & { id: number };

type ParsedRow = {
	row: StoredRow;
	extraction: ExtractionResult;
	sequence: SeqPair | null;
};

/** 一段经历指向一条说法的边。 */
type Link = Phrasing & { experienceId: number };

/**
 * 这一批段的说法与边（组合方式见 `route-texts.ts`）。四类进同一张说法表：一个能力词
 * 恰好和某个岗位名是同一串字时只存一行，两条边各指向它。能力的投入档存在边的
 * 第四列，其余类那一列是空。
 */
export function phrasePlan(batch: Pick<ParsedRow, "row" | "extraction">[]): {
	texts: string[];
	links: Link[];
} {
	const links: Link[] = [];
	for (const { row, extraction } of batch) {
		const phrasings = phrasesOf(
			{
				kind: row.kind,
				unemployed: row.unemployed,
				title: row.title,
				seqL1: row.seq_l1,
				seqL2: row.seq_l2,
				seqL3: row.seq_l3,
				description: row.description,
			},
			extraction.status === "done" ? extraction.value : null,
		);
		for (const p of phrasings) links.push({ experienceId: row.id, ...p });
	}
	return { texts: [...new Set(links.map((link) => link.text))], links };
}

/**
 * 解析进度。`done` 是已有这一版结果的段，正式表里的和暂存的新结果都算；`staging` 是
 * 检索此刻还在读上一版。后台任务看它决定有没有活，任务台画它。
 */
export type DeriveProgress = {
	total: number;
	done: number;
	staging: boolean;
	externalPending?: number;
};

export async function progress(client: CorpusClient): Promise<DeriveProgress> {
	const { mode, version, extract, align } = await deriveStandard(client);
	const { rows } = await client.query<{
		total: string;
		done: string;
		staging: boolean | null;
	}>(
		`select count(*) as total,
			count(*) filter (where n.experience_id is not null or e.derived_identity=$1) as done,
			bool_or(e.derived_identity <> $1) as staging
		 from experience e
		 left join experience_next n on n.experience_id = e.id and n.derived_identity = $1`,
		[version],
	);
	const row = rows[0];
	const state: DeriveProgress = {
		total: Number(row?.total ?? 0),
		done: Number(row?.done ?? 0),
		staging: row?.staging ?? false,
	};
	if (mode === "external") {
		const { rows } = await client.query<{ n: number }>(
			`select count(*)::int as n from derive_request where standard=any($1::text[])
			 and experience_id is not null and result is null and failed_version is null`,
			[[extract.standard, align.standard]],
		);
		state.externalPending = rows[0]?.n ?? 0;
	}
	return state;
}

async function underived(client: CorpusClient, version: string) {
	const { rows } = await client.query<{ n: string }>(
		`select count(*) as n from experience e where ${UNDERIVED}`,
		[version],
	);
	return Number(rows[0]?.n ?? 0);
}

/**
 * 这一版要不要先写进 `experience_next`：正式表里已经有另一版的结果时要，检索在读它们；
 * 正式表是空的或已经是这一版时直接写。顺带清掉不是这一版的暂存结果。
 */
async function staging(
	client: CorpusClient,
	version: string,
): Promise<boolean> {
	const { rows } = await client.query<{ staged: boolean }>(
		`select exists (select 1 from experience
			where derived_identity is distinct from $1 and derived_identity is not null) as staged`,
		[version],
	);
	const staged = rows[0]?.staged ?? false;
	await client.query(
		staged
			? "delete from experience_next where derived_identity <> $1"
			: "delete from experience_next",
		staged ? [version] : [],
	);
	return staged;
}

/** 按 id 读取下一批。抽取与对齐所需回答齐备后，才能写这一段。 */
async function parseBatch(
	client: CorpusClient,
	standard: DeriveStandard,
	afterId: number,
): Promise<ParsedRow[]> {
	const { mode, version, tree } = standard;
	const fields =
		"e.id,e.kind,e.unemployed,e.company,e.title,e.description,e.seq_l1,e.seq_l2,e.seq_l3";
	const pending = `${UNDERIVED} and e.id > $2`;
	const page = `order by e.id limit ${BATCH}`;
	if (mode !== "text") {
		const { rows } = await client.query<
			StoredRow & { extraction: unknown; alignment: unknown }
		>(
			`select ${fields}, x.result as extraction, a.result as alignment
			 from experience e
			 left join derive_request x on x.standard=$3 and x.input_key=${inputKeySql}
			 left join derive_request a on a.standard=$4 and a.input_key=${inputKeySql}
			 where ${pending} and (e.kind <> 'external' or e.unemployed or (
				(e.description='' or x.result is not null or x.failed_version=$1)
				and (not $5::boolean or a.result is not null or a.failed_version=$1)))
			 ${page}`,
			[
				version,
				afterId,
				standard.extract.standard,
				standard.align.standard,
				tree.length > 0,
			],
		);
		return rows.map((row) => ({
			row,
			extraction: extractionOf(row, row.extraction),
			sequence: alignmentOf(row, tree, row.alignment),
		}));
	}
	const { rows } = await client.query<StoredRow>(
		`select ${fields} from experience e where ${pending} ${page}`,
		[version, afterId],
	);
	return rows.map((row) => ({
		row,
		extraction: { status: "skipped" },
		sequence: ["", ""],
	}));
}

/**
 * 边先删后写，段上记版本，没有边指向的说法行跟着清掉。`staged` 时写进暂存的
 * 两张表，正式表里这些段的旧结果不动。
 */
async function commitBatch(
	client: CorpusClient,
	version: string,
	staged: boolean,
	batch: ParsedRow[],
) {
	const { texts, links } = phrasePlan(batch);
	const unanswered = batch.map(
		({ extraction, sequence }) =>
			extraction.status === "failed" || sequence === null,
	);
	await client.query("begin");
	try {
		await client.query(
			`insert into phrase (text)
			 select * from unnest($1::text[])
			 on conflict (text_key) do nothing`,
			[texts],
		);
		const ids = batch.map(({ row }) => row.id);
		const inferred = [
			ids,
			batch.map(({ sequence }) => sequence?.[0] ?? ""),
			batch.map(({ sequence }) => sequence?.[1] ?? ""),
			unanswered,
			version,
		];
		if (staged)
			await client.query(
				`insert into experience_next
					(experience_id, seq_inferred_l1, seq_inferred_l2, unanswered, derived_identity)
				 select r.id, r.l1, r.l2, r.unanswered, $5
				 from unnest($1::int[], $2::text[], $3::text[], $4::bool[])
					as r(id, l1, l2, unanswered)
				 on conflict (experience_id) do update
				 set seq_inferred_l1 = excluded.seq_inferred_l1,
					seq_inferred_l2 = excluded.seq_inferred_l2,
					unanswered = excluded.unanswered,
					derived_identity = excluded.derived_identity`,
				inferred,
			);
		const edges = staged ? "experience_phrase_next" : "experience_phrase";
		await client.query(
			`delete from ${edges} where experience_id = any($1::int[])`,
			[ids],
		);
		await client.query(
			`insert into ${edges} (experience_id, route, phrase_id, engagement)
			 select l.experience_id, l.route, p.id, l.engagement
			 from unnest($1::int[], $2::text[], $3::text[], $4::text[])
				as l(experience_id, route, text, engagement)
			 join phrase p on p.text = l.text
			 on conflict do nothing`,
			[
				links.map((link) => link.experienceId),
				links.map((link) => link.route),
				links.map((link) => link.text),
				links.map((link) => link.engagement),
			],
		);
		await prunePhrases(client);
		if (!staged)
			await client.query(
				`update experience e
				 set seq_inferred_l1 = r.l1, seq_inferred_l2 = r.l2,
					unanswered = r.unanswered, derived_identity = $5
				 from unnest($1::int[], $2::text[], $3::text[], $4::bool[])
					as r(id, l1, l2, unanswered)
				 where e.id = r.id`,
				inferred,
			);
		await client.query("commit");
		return unanswered.filter(Boolean).length;
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

/**
 * 把暂存的新结果一次替换正式表。调用方已确认每一段都有这一版的结果，替换后正式表
 * 只有这一版。
 */
async function promote(client: CorpusClient, version: string) {
	await client.query("begin");
	try {
		await client.query(
			`delete from experience_phrase ep using experience e
			 where e.id = ep.experience_id and e.derived_identity is distinct from $1`,
			[version],
		);
		await client.query(
			`insert into experience_phrase (experience_id, route, phrase_id, engagement)
			 select experience_id, route, phrase_id, engagement from experience_phrase_next`,
		);
		await client.query(
			`update experience e
			 set seq_inferred_l1 = n.seq_inferred_l1, seq_inferred_l2 = n.seq_inferred_l2,
				unanswered = n.unanswered, derived_identity = n.derived_identity
			 from experience_next n where n.experience_id = e.id`,
		);
		await client.query("delete from experience_next");
		await prunePhrases(client);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

/** 写者拿到锁后按此刻的目录登记请求。同步可能在模型作答期间更新目录。 */
async function prepare(client: CorpusClient) {
	const standard = await deriveStandard(client);
	if (standard.mode === "text") {
		await client.query(
			"delete from derive_request where result is null and failed_version is null",
		);
	} else {
		if (standard.mode === "external" && !deriveToken())
			throw new Error(
				"外部解析需要独立的 DERIVE_TOKEN，请使用与 REVIEW_TOKEN 不同的凭据",
			);
		await prepareDeriveRequests(client, standard);
	}
	return standard;
}

type DeriveOutcome = { done: number; left: number };

/** 一批一批地做，直到做完或时间预算用完。连接与锁由调用方给（`session.ts`）。 */
export async function derive(
	session: CorpusSession,
	report: Report,
	budgetMs: number,
): Promise<DeriveOutcome> {
	const { client } = session;
	const deadline = Date.now() + budgetMs;

	let standard = await prepare(client);
	let agentFailure: { error: unknown } | undefined;
	if (standard.mode === "model") {
		const { rows } = await client.query<{ kind: "extract" | "align" }>(
			`select kind from unnest($1::text[],$2::text[]) as s(kind,standard)
			 where exists(select 1 from derive_request q where q.standard=s.standard
			 and q.experience_id is not null and q.result is null and q.failed_version is null)
			 order by array_position($1,kind)`,
			[
				["extract", "align"],
				[standard.extract.standard, standard.align.standard],
			],
		);
		if (rows.length) {
			agentFailure = await session.outsideWriter(async () => {
				try {
					for (const [index, { kind }] of rows.entries()) {
						const now = Date.now();
						if (now >= deadline) break;
						await runCorpusAgent(
							kind,
							report,
							now + (deadline - now) / (rows.length - index),
						);
					}
				} catch (error) {
					return { error };
				}
			});
			standard = await prepare(client);
		}
	}
	const { mode, version } = standard;
	const staged = await staging(client, version);
	const total = await underived(client, version);
	if (mode === "text")
		report("  未配置抽取模型，自述按整段原文处理，入职前经历不推断序列");
	report(`  待解析 ${total} 段`);
	if (staged)
		report("  判定标准已更新：每一段都有新结果之前，检索继续使用上一版结果");

	let done = 0;
	let afterId = 0;
	while (afterId === 0 || Date.now() < deadline) {
		const batch = await parseBatch(client, standard, afterId);
		const last = batch.at(-1);
		if (!last) break;
		afterId = last.row.id;
		const unanswered = await commitBatch(client, version, staged, batch);
		if (unanswered > 0)
			report(`  ${unanswered} 段无法解析，已记录；标准变更后会再处理`);
		done += batch.length;
		report(`  已解析 ${done}/${total} 段`);
	}
	report("");
	const left = await underived(client, version);
	if (staged && left === 0) {
		await promote(client, version);
		report("新标准已生效");
	}
	report(
		left > 0 ? `这一轮到此为止，还剩 ${left} 段下一轮接着` : "全部解析完毕",
	);
	if (agentFailure) throw agentFailure.error;
	return { done, left };
}
