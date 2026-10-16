/**
 * 为待处理经历段抽取说法、对齐序列、嵌入并连边。
 * 模型调用在事务外，结果按批提交说法、边和解析版本。模型答不出的段同样有结果：
 * 记为未能作答，判定标准变了才重新问；端点故障让这一轮中止，下一轮接着。
 * 每轮按 id 向后处理，时间预算耗尽后退出。判定标准变了以后，新结果先写进
 * `experience_next`，每一段都有了新结果再一次替换正式表：检索一直读一份完整的标准。
 */

import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { EMBED_DIM } from "#/db/schema";
import { chatConfigured } from "#/server/chat";
import { assertCanary, embedSpace } from "#/server/embed";
import { align, alignIdentity, type SeqPair, seqTree } from "./align";
import { embed, probe } from "./embed";
import {
	type Extraction,
	type ExtractionResult,
	extract,
	extractIdentity,
} from "./extract";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import { PHRASING, type Phrasing, phrasesOf } from "./route-texts";
import type { CorpusClient, CorpusSession } from "./session";

/** 查询侧核对嵌入空间时重新嵌的那一串字。改它等于让已有语料的 canary 失效。 */
const CANARY_TEXT = "talent-search embedding canary";

const BATCH = 200;

/** 说法一条语句写多少行：一行带一个一千多维的向量，几百行已经是几兆的语句。 */
const PHRASE_ROWS_PER_STATEMENT = 500;

type StoredRow = ExperienceRow & { id: number };

/** 这一版标准下的一段结果；`unanswered` 见 schema 同名列。 */
type DerivedRow = StoredRow & { unanswered: boolean };

/** 一段经历指向一条说法的边。 */
type Link = Phrasing & { experienceId: number };

/**
 * 这一批段的说法与边（组合方式见 `route-texts.ts`）。五类进同一张说法表：一个能力词
 * 恰好和某个岗位名是同一串字时只嵌一次，两条边各指向它。做过的事的说法是
 * 领域，参与方式存在边的第四列，其余类那一列是空。
 *
 * `extractions` 按段对齐：null 是这一段没有抽取（未配置、无需调用或模型答不出），
 * 它的自述证据退回整段原文。
 */
export function phrasePlan(
	rows: StoredRow[],
	extractions: (Extraction | null)[],
): { texts: string[]; links: Link[] } {
	const links: Link[] = [];
	for (const [index, row] of rows.entries()) {
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
			extractions[index] ?? null,
		);
		for (const p of phrasings) links.push({ experienceId: row.id, ...p });
	}
	return { texts: [...new Set(links.map((link) => link.text))], links };
}

/** 核验当前空间的端点输出；换嵌入空间时清空说法和解析版本。 */
async function ensureSpace(client: CorpusClient, report: Report) {
	const space = embedSpace();
	const { rows } = await client.query<{
		space_id: string;
		model: string;
		dimension: number;
		canary_text: string;
		canary_embedding: string;
	}>(
		"select space_id, model, dimension, canary_text, canary_embedding from embedding_space",
	);
	if (rows.length > 1) throw new Error("语料的嵌入空间元数据不唯一");
	const current = rows[0];
	if (current?.space_id === space.spaceId) {
		if (current.model !== space.model || current.dimension !== EMBED_DIM)
			throw new Error("嵌入空间身份发生变化，请更换 EMBED_SPACE_ID");
		assertCanary(
			JSON.parse(current.canary_embedding),
			await probe(current.canary_text),
		);
		return;
	}
	const canary = await probe(CANARY_TEXT);

	await client.query("begin");
	try {
		if (current) {
			report("  向量模型已更换，既有结果全部作废，所有段重新解析");
			await client.query("truncate phrase restart identity cascade");
			await client.query(
				"update experience set derived_identity = null, unanswered = false",
			);
		}
		await client.query("delete from embedding_space");
		await client.query(
			`insert into embedding_space
				(space_id, model, dimension, canary_text, canary_embedding)
			 values ($1, $2, $3, $4, $5::halfvec)`,
			[
				space.spaceId,
				space.model,
				EMBED_DIM,
				CANARY_TEXT,
				`[${canary.join(",")}]`,
			],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

export async function currentTree(client: CorpusClient): Promise<SeqPair[]> {
	const { rows } = await client.query<{ seq_l1: string; seq_l2: string }>(
		"select distinct seq_l1, seq_l2 from experience where kind = 'internal'",
	);
	return seqTree(rows.map((row) => ({ kind: "internal", ...row })));
}

/**
 * 当前的解析版本：嵌入空间、说法的组合方式，以及抽取和对齐的标准。抽取和对齐没配端点时
 * 它们不在版本里：配上了就该重新解析。
 */
export function identity(tree: SeqPair[]): string {
	const space = embedSpace();
	const parts = [space.spaceId, space.model, PHRASING];
	if (chatConfigured()) parts.push(extractIdentity(), alignIdentity(tree));
	return createHash("sha256").update(parts.join("")).digest("hex");
}

/**
 * 解析进度。`done` 是已有这一版结果的段，正式表里的和暂存的新结果都算，其中 `unanswered`
 * 段未能作答；`staging` 是检索此刻还在读上一版。后台任务看它决定有没有活，任务台画它。
 */
export type Progress = {
	total: number;
	done: number;
	unanswered: number;
	staging: boolean;
};

export async function progress(
	client: CorpusClient,
	version: string,
): Promise<Progress> {
	const { rows } = await client.query<{
		total: string;
		done: string;
		unanswered: string;
		staging: boolean | null;
	}>(
		`select count(*) as total,
			count(r.unanswered) as done,
			count(*) filter (where r.unanswered) as unanswered,
			bool_or(e.derived_identity <> $1) as staging
		 from experience e
		 left join experience_next n on n.experience_id = e.id and n.derived_identity = $1
		 cross join lateral (select case
			when n.experience_id is not null then n.unanswered
			when e.derived_identity = $1 then e.unanswered end as unanswered) r`,
		[version],
	);
	const row = rows[0];
	return {
		total: Number(row?.total ?? 0),
		done: Number(row?.done ?? 0),
		unanswered: Number(row?.unanswered ?? 0),
		staging: row?.staging ?? false,
	};
}

/** 还要调模型的段：正式表里不是这一版，暂存的新结果里也没有。 */
const UNDERIVED = `e.derived_identity is distinct from $1
	and not exists (select 1 from experience_next n
		where n.experience_id = e.id and n.derived_identity = $1)`;

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

async function nextBatch(
	client: CorpusClient,
	version: string,
	afterId: number,
): Promise<StoredRow[]> {
	const { rows } = await client.query<
		Omit<StoredRow, "seq_inferred_l1" | "seq_inferred_l2">
	>(
		`select id, emp_id, kind, unemployed, start_date::text, end_date::text, company, department,
			department_path, company_meta, title, seq_l1, seq_l2, seq_l3, level, description, months
		 from experience e
		 where ${UNDERIVED} and id > $2
		 order by id
		 limit ${BATCH}`,
		[version, afterId],
	);
	// 对齐的两列是这一轮要重新算的：上一版对到的不算数，对不上的就是空
	return rows.map((row) => ({
		...row,
		seq_inferred_l1: "",
		seq_inferred_l2: "",
	}));
}

/** 清除全表孤立说法，避免占用召回名额。同步删除段与解析重写边都可能留下孤立说法。 */
export async function prunePhrases(client: CorpusClient): Promise<void> {
	await client.query(
		`delete from phrase p
		 where not exists (
			select 1 from experience_phrase ep where ep.phrase_id = p.id)
		 and not exists (
			select 1 from experience_phrase_next ep where ep.phrase_id = p.id)`,
	);
}

/**
 * 边先删后写，段上记版本，没有边指向的说法行跟着清掉。`staged` 时写进暂存的
 * 两张表，正式表里这些段的旧结果不动。
 */
async function commitBatch(
	client: CorpusClient,
	version: string,
	staged: boolean,
	rows: DerivedRow[],
	texts: string[],
	vectors: number[][],
	links: Link[],
): Promise<void> {
	await client.query("begin");
	try {
		for (
			let start = 0;
			start < texts.length;
			start += PHRASE_ROWS_PER_STATEMENT
		) {
			const part = texts.slice(start, start + PHRASE_ROWS_PER_STATEMENT);
			await client.query(
				`insert into phrase (text, embedding)
				 select * from unnest($1::text[], $2::halfvec[])
				 on conflict (text) do nothing`,
				[
					part,
					part.map((_, index) => {
						const vector = vectors[start + index];
						if (!vector) throw new Error(`说法没有向量：${part[index]}`);
						return `[${vector.join(",")}]`;
					}),
				],
			);
		}
		const ids = rows.map((row) => row.id);
		const inferred = [
			ids,
			rows.map((row) => row.seq_inferred_l1),
			rows.map((row) => row.seq_inferred_l2),
			rows.map((row) => row.unanswered),
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
			`insert into ${edges} (experience_id, route, phrase_id, involvement)
			 select l.experience_id, l.route, p.id, l.involvement
			 from unnest($1::int[], $2::text[], $3::text[], $4::text[])
				as l(experience_id, route, text, involvement)
			 join phrase p on p.text = l.text
			 on conflict do nothing`,
			[
				links.map((link) => link.experienceId),
				links.map((link) => link.route),
				links.map((link) => link.text),
				links.map((link) => link.involvement),
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
			`insert into experience_phrase (experience_id, route, phrase_id, involvement)
			 select experience_id, route, phrase_id, involvement from experience_phrase_next`,
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

type DeriveOutcome = { done: number; left: number };

/** 一批一批地做，直到做完或时间预算用完。连接与锁由调用方给（`session.ts`）。 */
export async function derive(
	session: CorpusSession,
	report: Report,
	budgetMs: number,
): Promise<DeriveOutcome> {
	const { client } = session;
	const deadline = Date.now() + budgetMs;

	await ensureSpace(client, report);
	const tree = await currentTree(client);
	const version = identity(tree);
	const staged = await staging(client, version);
	const total = await underived(client, version);
	if (!chatConfigured())
		report("  未配置语义模型，自述按整段原文处理，入职前经历不推断序列");
	report(`  待解析 ${total} 段`);
	if (staged)
		report("  判定标准已更新：每一段都有新结果之前，检索继续使用上一版结果");

	let done = 0;
	let afterId = 0;
	while (Date.now() < deadline) {
		const rows = await nextBatch(client, version, afterId);
		if (rows.length === 0) break;
		afterId = rows[rows.length - 1]?.id ?? afterId;
		report("");
		report(`处理一批 ${rows.length} 段…`);

		// 没配抽取端点，每一段都是「没读过」：自述证据退回整段原文（route-texts.ts）
		let extractions: ExtractionResult[] = rows.map(() => ({
			status: "skipped",
		}));
		let aligned: (StoredRow | null)[] = rows;
		if (chatConfigured()) {
			extractions = await extract(rows, report);
			aligned = await align(rows, tree, report);
		}
		// 抽取答不出的段按没读过拼说法，对齐答不出的段保持 nextBatch 给的空序列
		const results: DerivedRow[] = rows.map((row, index) => ({
			...(aligned[index] ?? row),
			unanswered:
				extractions[index]?.status === "failed" || aligned[index] === null,
		}));
		const unanswered = results.filter((row) => row.unanswered).length;
		if (unanswered > 0)
			report(`  ${unanswered} 段未能作答，记下结果，判定标准变了再问`);
		const { texts, links } = phrasePlan(
			results,
			extractions.map((one) => (one.status === "done" ? one.value : null)),
		);
		const vectors = await embed(texts, report);
		await commitBatch(client, version, staged, results, texts, vectors, links);
		done += rows.length;
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
	return { done, left };
}
