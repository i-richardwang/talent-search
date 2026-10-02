/**
 * 为待处理经历段抽取说法、对齐序列、嵌入并连边。
 * 模型调用在事务外；成功段按批提交说法、边和派生版本，失败段下一轮重试。
 * 每轮按 id 向后处理，时间预算耗尽后退出；标准混用期间检索拒绝读取。
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
import { type Phrasing, phrasesOf } from "./route-texts";
import type { CorpusClient, CorpusSession } from "./session";

/** 查询侧核对嵌入空间时重新嵌的那一串字。改它等于让已有语料的 canary 失效。 */
const CANARY_TEXT = "talent-search embedding canary";

/** 一批多少段。 */
const BATCH = 200;

/** 说法一条语句写多少行：一行带一个一千多维的向量，几百行已经是几兆的语句。 */
const PHRASE_ROWS_PER_STATEMENT = 500;

/** 库里的一段：原始的一半加 id。 */
type StoredRow = ExperienceRow & { id: number };

/** 一段经历指向一条说法的边。 */
type Link = Phrasing & { experienceId: number };

/**
 * 这一批段的说法与边（拼法见 `route-texts.ts`）。六路进同一张说法表：一个能力词
 * 恰好和某个岗位名是同一串字时只嵌一次，两条边各指向它。做过的事的说法是
 * 领域，参与方式存在边的第四列，其余类那一列是空。
 *
 * `extractions` 按段对齐：null 是这一段没有抽取（未配置或无需调用），它的
 * 自述证据退回整段原文。
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
				org: row.org,
				orgPath: row.org_path,
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

/** 核验当前空间的端点输出；换空间时清空说法和派生版本。 */
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
			report("  向量模型已更换，既有结果全部作废，所有段重新派生");
			await client.query("truncate phrase restart identity cascade");
			await client.query("update experience set derived_identity = null");
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

/** 公司内任职段登记过的序列树，从库里取。 */
export async function currentTree(client: CorpusClient): Promise<SeqPair[]> {
	const { rows } = await client.query<{ seq_l1: string; seq_l2: string }>(
		"select distinct seq_l1, seq_l2 from experience where kind = 'internal'",
	);
	return seqTree(rows.map((row) => ({ kind: "internal", ...row })));
}

/** 当前的派生版本。抽取和对齐没配端点时它们不在版本里：配上了就该重新派生。 */
export function identity(tree: SeqPair[]): string {
	const space = embedSpace();
	const parts = [space.spaceId, space.model];
	if (chatConfigured()) parts.push(extractIdentity(), alignIdentity(tree));
	return createHash("sha256").update(parts.join("")).digest("hex");
}

/** 还不是这一版的段有多少。 */
export async function pending(client: CorpusClient, version: string) {
	const { rows } = await client.query<{ n: string }>(
		"select count(*) as n from experience where derived_identity is distinct from $1",
		[version],
	);
	return Number(rows[0]?.n ?? 0);
}

async function nextBatch(
	client: CorpusClient,
	version: string,
	afterId: number,
): Promise<StoredRow[]> {
	const { rows } = await client.query<
		Omit<StoredRow, "seq_inferred_l1" | "seq_inferred_l2">
	>(
		`select id, emp_id, kind, unemployed, start_date::text, end_date::text, org, org_path,
			org_meta, title, seq_l1, seq_l2, seq_l3, level, description, months
		 from experience
		 where derived_identity is distinct from $1 and id > $2
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

/** 清除全表孤立说法，避免占用召回名额。同步删除段与派生重写边都可能留下孤立说法。 */
export async function prunePhrases(client: CorpusClient): Promise<void> {
	await client.query(
		`delete from phrase p
		 where not exists (
			select 1 from experience_phrase ep where ep.phrase_id = p.id)`,
	);
}

/** 一批的结果落库：边先删后写，段上记版本，没有边指向的说法行跟着清掉。 */
async function commitBatch(
	client: CorpusClient,
	version: string,
	rows: StoredRow[],
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
		await client.query(
			"delete from experience_phrase where experience_id = any($1::int[])",
			[ids],
		);
		await client.query(
			`insert into experience_phrase (experience_id, route, phrase_id, involvement)
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
		await client.query(
			`update experience e
			 set seq_inferred_l1 = r.l1, seq_inferred_l2 = r.l2,
				derived_identity = $4
			 from unnest($1::int[], $2::text[], $3::text[]) as r(id, l1, l2)
			 where e.id = r.id`,
			[
				ids,
				rows.map((row) => row.seq_inferred_l1),
				rows.map((row) => row.seq_inferred_l2),
				version,
			],
		);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}

/** 一轮派生做完之后：做了几段，还剩几段。 */
type DeriveOutcome = { done: number; left: number };

/**
 * 一轮派生：待派生的段一批一批地做，直到做完或时间预算用完。
 *
 * 连接与锁由调用方给（`session.ts`），输出写到 `report`。
 */
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
	const total = await pending(client, version);
	if (!chatConfigured())
		report("  未配置语义模型，自述按整段原文处理，入职前经历不推断序列");
	report(`  待派生 ${total} 段`);

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
		const ready: StoredRow[] = [];
		const readings: (Extraction | null)[] = [];
		for (const [index, row] of aligned.entries()) {
			const extraction = extractions[index];
			if (!row || !extraction || extraction.status === "failed") continue;
			ready.push(row);
			readings.push(extraction.status === "done" ? extraction.value : null);
		}
		if (ready.length !== rows.length)
			report(
				`  ${rows.length - ready.length} 段未能作答，保留待派生，下一轮重试`,
			);
		const { texts, links } = phrasePlan(ready, readings);
		const vectors = await embed(texts, report);
		if (ready.length > 0)
			await commitBatch(client, version, ready, texts, vectors, links);
		done += ready.length;
		report(`  已派生 ${done}/${total} 段`);
	}
	const left = await pending(client, version);
	report("");
	report(
		left > 0 ? `这一轮到此为止，还剩 ${left} 段下一轮接着` : "全部派生完毕",
	);
	return { done, left };
}
