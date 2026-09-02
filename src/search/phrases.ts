/**
 * 「语料里哪些说法是用户这个词的意思」——检索的判定层。
 *
 * 检索的匹配单元是语料里去重后的**说法**（`phrase` 表：一条序列名、一个岗位名、
 * 一条部门路径、一段简历描述），不是经历段。一个查询词先在这里变成一批
 * 「命中的说法及其相关度」，`search.ts` 再沿 `experience_phrase` 走到经历段和人。
 *
 * 两步，两个模型（阈值与理由见 weights.ts）：
 *
 * 1. **召回**用向量：余弦相似度过 `RECALL_MIN` 的说法都是候选。它只保证不漏。
 * 2. **判定**用重排：交叉编码器给每个候选打相关度，过线才算命中。它负责不错。
 *
 * 重排的分数按（重排空间，查询词，说法）永久缓存在 `phrase_relevance` 里：翻页、
 * 改筛选或再次搜索同一个词时直接命中缓存。只有召回出来却没打过分的对
 * 才会出去。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { db } from "#/db";
import { embed, vectorLiteral } from "#/server/embed";
import { rerank, rerankSpaceId } from "#/server/rerank";
import { RECALL_MAX, RECALL_MIN } from "./weights";

/** 一个查询词命中的一条说法。 */
export type Admitted = { phraseId: number; relevance: number };

type Candidate = { phrase_id: number; text: string };

/**
 * 每个查询词在语料里的候选说法：向量召回，按相似度取前 `RECALL_MAX` 个。
 * 所有词一次嵌完、一条 SQL 取完，不串成 n 次往返。
 */
async function recall(texts: string[]): Promise<Map<string, Candidate[]>> {
	const vectors = await embed(texts);
	const q = sql`(values ${sql.join(
		vectors.map((v, i) => sql`(${i}::int, ${vectorLiteral(v)}::halfvec)`),
		sql`, `,
	)})`;
	const rows = await db.execute<Candidate & { ord: number }>(sql`
		with q(ord, v) as ${q}
		select q.ord, c.phrase_id, c.text
		from q cross join lateral (
			select p.id as phrase_id, p.text
			from phrase p
			where 1 - (p.embedding <=> q.v) >= ${RECALL_MIN}
			order by p.embedding <=> q.v
			limit ${RECALL_MAX}
		) c`);
	const out = new Map<string, Candidate[]>(texts.map((t) => [t, []]));
	for (const r of rows.rows)
		out
			.get(texts[r.ord] as string)
			?.push({ phrase_id: r.phrase_id, text: r.text });
	return out;
}

/**
 * 一个查询词对一批候选的相关度：能从缓存拿的拿，拿不到的打端点并写回。
 * 写回用 `on conflict do nothing`——两次并发检索同一个新词时，后到的那份
 * 分数和先到的一样，丢掉就是。
 */
async function relevanceOf(
	query: string,
	candidates: Candidate[],
): Promise<Map<number, number>> {
	const out = new Map<number, number>();
	if (candidates.length === 0) return out;
	const space = rerankSpaceId();
	const ids = candidates.map((c) => c.phrase_id);
	const cached = await db.execute<{ phrase_id: number; relevance: number }>(sql`
		select phrase_id, relevance from phrase_relevance
		where space = ${space} and query = ${query}
		and phrase_id in (${sql.join(
			ids.map((id) => sql`${id}`),
			sql`, `,
		)})`);
	for (const r of cached.rows) out.set(r.phrase_id, Number(r.relevance));

	const missing = candidates.filter((c) => !out.has(c.phrase_id));
	if (missing.length > 0) {
		const scores = await rerank(
			query,
			missing.map((c) => c.text),
		);
		for (const [i, c] of missing.entries())
			out.set(c.phrase_id, scores[i] as number);
		await db.execute(sql`
			insert into phrase_relevance (space, query, phrase_id, relevance)
			values ${sql.join(
				missing.map(
					(c, i) =>
						sql`(${space}, ${query}, ${c.phrase_id}, ${scores[i] as number})`,
				),
				sql`, `,
			)}
			on conflict do nothing`);
	}
	return out;
}

/**
 * 每个查询词命中了语料里的哪些说法（相关度不低于 `min`），按相关度从高到低。
 * 词与词之间互不影响，各自判定；同一个词出现两次只算一次。
 */
export async function admit(
	texts: string[],
	min: number,
): Promise<Map<string, Admitted[]>> {
	const unique = [...new Set(texts)];
	const out = new Map<string, Admitted[]>();
	if (unique.length === 0) return out;
	const candidates = await recall(unique);
	await Promise.all(
		unique.map(async (text) => {
			const list = candidates.get(text) ?? [];
			const scores = await relevanceOf(text, list);
			out.set(
				text,
				list
					.map((c) => ({
						phraseId: c.phrase_id,
						relevance: scores.get(c.phrase_id) as number,
					}))
					.filter((a) => a.relevance >= min)
					.sort((a, b) => b.relevance - a.relevance),
			);
		}),
	);
	return out;
}

/**
 * 命中的说法摆成一张 VALUES 表 `(term_idx, member_idx, phrase_id, relevance)`，
 * 供取数 SQL 沿 `experience_phrase` 走到经历段。一行都没有时返回 null——
 * 空的 VALUES 不是合法 SQL，而且没有命中就没有取数可做。
 */
export function admittedTable(
	rows: { termIdx: number; memberIdx: number; hit: Admitted }[],
) {
	if (rows.length === 0) return null;
	return sql`(values ${sql.join(
		rows.map(
			(r) =>
				sql`(${r.termIdx}::int, ${r.memberIdx}::int, ${r.hit.phraseId}::int, ${r.hit.relevance}::float)`,
		),
		sql`, `,
	)})`;
}
