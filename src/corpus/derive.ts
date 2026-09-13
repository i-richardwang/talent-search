/**
 * 派生：给还没派生到当前版本的段问模型、嵌入、连边。语料里凡是模型算出来的
 * 东西都从这里来。
 *
 * 一段的派生结果有三样：抽出来的能力词与做过的事（`extract.ts`）、对齐到的公司
 * 序列（`align.ts`）、六路说法的向量与边（`phrase` / `experience_phrase`）。它们
 * 依赖的东西合起来是一个**版本**（`identity`）：抽取和对齐的提示词与模型、嵌入
 * 空间。段上记着它派生到了哪一版，和当前版本不等的段就是这一轮的活。改一次
 * 提示词等于所有段待派生；缓存表（`embedding_cache` / `completion_cache`）让
 * 答案没变的那部分几乎不花钱。
 *
 * **一批一批地做，每批一笔短事务。** 一批几百段：模型调用在事务外（论证见
 * `src/db/index.ts`），算完了再开一笔事务把说法、边和段上的版本一起写进去。
 * 进程中途没了，已提交的批留下，没提交的批下次重来；读者随时看到的都是整批
 * 的结果。一轮有时间预算，用完就退出，下一轮接着——它是后台任务，不是一次
 * 要跑到底的脚本。
 *
 * 说法表只增不改：向量是文本的属性，段没了、边没了，说法留着不碍事，而它的
 * id 稳定意味着重排分数的缓存（`phrase_relevance`）跟着稳定。唯一清它的时刻
 * 是换嵌入空间：旧向量在新空间里没有意义，整张表连同边和分数一起作废，所有段
 * 待派生。
 */

import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { EMBED_DIM, type Route } from "#/db/schema";
import { chatConfigured, chatEndpoint, extractModel } from "#/server/chat";
import { embedEndpoint, embedSpace } from "#/server/embed";
import { align, alignIdentity, type SeqPair, seqTree } from "./align";
import { embed, probe } from "./embed";
import { EMPTY, type Extraction, extract, extractIdentity } from "./extract";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import { routeTexts } from "./route-texts";
import type { CorpusClient, CorpusSession } from "./session";
import { read as readVocabulary } from "./vocabulary";
import { apply, mapping } from "./vocabulary-rules";

/** 查询侧核对嵌入空间时重新嵌的那一串字。改它等于让已有语料的 canary 失效。 */
const CANARY_TEXT = "talent-search embedding canary";

/** 一批多少段。 */
const BATCH = 200;

/** 说法一条语句写多少行：一行带一个一千多维的向量，几百行已经是几兆的语句。 */
const PHRASE_ROWS_PER_STATEMENT = 500;

/** 库里的一段：原始的一半加 id。 */
type StoredRow = ExperienceRow & { id: number };

/** 一段经历指向一条说法的边。 */
type Link = {
	experienceId: number;
	route: Route;
	text: string;
	involvement: string | null;
};

/**
 * 这一批段的六路说法与边。抽取的两路和原文四路进同一张说法表：一个能力词
 * 恰好和某个岗位名是同一串字时只嵌一次，两条边各指向它。做过的事的说法是
 * 领域，参与方式落在边的第四列，其余路那一列是空。
 */
export function phrasePlan(
	rows: StoredRow[],
	extractions: Extraction[],
): { texts: string[]; links: Link[] } {
	const links: Link[] = [];
	for (const [index, row] of rows.entries()) {
		const experienceId = row.id;
		const extraction = extractions[index] ?? EMPTY;
		for (const [route, text] of routeTexts({
			kind: row.kind,
			org: row.org,
			orgPath: row.org_path,
			title: row.title,
			seqL1: row.seq_l1,
			seqL2: row.seq_l2,
			seqL3: row.seq_l3,
			description: row.description,
		}))
			links.push({ experienceId, route, text, involvement: null });
		for (const skill of extraction.skills)
			links.push({
				experienceId,
				route: "skill",
				text: skill,
				involvement: null,
			});
		for (const { involvement, domain } of extraction.did)
			links.push({ experienceId, route: "did", text: domain, involvement });
	}
	return { texts: [...new Set(links.map((link) => link.text))], links };
}

/**
 * 确认库里的嵌入空间就是配置的这一个；不是就换：清说法、清版本、写新身份证。
 * 返回 canary 向量给身份证用。
 */
async function ensureSpace(client: CorpusClient, report: Report) {
	const space = embedSpace();
	const canary = await probe(CANARY_TEXT);
	report(
		`  嵌入空间 ${space.spaceId} · ${space.model} @ ${embedEndpoint()}，${EMBED_DIM} 维`,
	);
	const { rows } = await client.query<{ space_id: string; model: string }>(
		"select space_id, model from embedding_space",
	);
	const current = rows[0];
	if (
		current &&
		current.space_id === space.spaceId &&
		current.model === space.model
	)
		return;

	await client.query("begin");
	try {
		if (current) {
			report(
				`  嵌入空间从 ${current.space_id} · ${current.model} 换过来了：` +
					"说法、边与重排分数全部作废，所有段重新派生",
			);
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
): Promise<StoredRow[]> {
	const { rows } = await client.query<
		Omit<StoredRow, "seq_inferred_l1" | "seq_inferred_l2">
	>(
		`select id, emp_id, kind, start_date::text, end_date::text, org, org_path,
			org_meta, title, seq_l1, seq_l2, seq_l3, level, description, months
		 from experience
		 where derived_identity is distinct from $1
		 order by id
		 limit ${BATCH}`,
		[version],
	);
	// 对齐的两列是这一轮要重新算的：上一版对到的不算数，对不上的就是空
	return rows.map((row) => ({
		...row,
		seq_inferred_l1: "",
		seq_inferred_l2: "",
	}));
}

/** 一批的结果落库：说法只增，边先删后写，段上记版本。 */
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
		await client.query(
			`update experience e
			 set seq_inferred_l1 = r.l1, seq_inferred_l2 = r.l2,
				derived_identity = $4, derived_at = now()
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
 * 连接与锁由调用方给（`session.ts`），说过的话交给 `report`。
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
	const aliases = mapping(await readVocabulary(client));
	const total = await pending(client, version);
	if (chatConfigured())
		report(
			`  抽取端点 ${extractModel()} @ ${chatEndpoint()}，序列树 ${tree.length} 对`,
		);
	else
		report(
			"  未配置抽取端点（EXTRACT_BASE_URL / EXTRACT_MODEL），" +
				"能力词与做过的事两路为空，入职前经历不对齐序列",
		);
	report(`  待派生 ${total} 段`);

	let done = 0;
	while (done < total && Date.now() < deadline) {
		const rows = await nextBatch(client, version);
		if (rows.length === 0) break;
		report("");
		report(`第 ${done + 1}–${done + rows.length} 段…`);

		let extractions: Extraction[] = rows.map(() => EMPTY);
		let aligned = rows;
		if (chatConfigured()) {
			extractions = (await extract(rows, report)).map((extraction) =>
				apply(aliases, extraction ?? EMPTY),
			);
			aligned = await align(rows, tree, report);
		}
		const { texts, links } = phrasePlan(aligned, extractions);
		const vectors = await embed(texts, report);
		await commitBatch(client, version, aligned, texts, vectors, links);
		done += rows.length;
		report(`  已派生 ${done}/${total} 段`);
	}
	const left = total - done;
	report("");
	report(
		left > 0 ? `这一轮到此为止，还剩 ${left} 段下一轮接着` : "全部派生完毕",
	);
	return { done, left };
}
