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
import { type DbExecutor, db } from "#/db";
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
async function recall(
	store: DbExecutor,
	texts: string[],
): Promise<Map<string, Candidate[]>> {
	const vectors = await embed(texts, store);
	const q = sql`(values ${sql.join(
		vectors.map((v, i) => sql`(${i}::int, ${vectorLiteral(v)}::halfvec)`),
		sql`, `,
	)})`;
	const rows = await store.execute<Candidate & { ord: number }>(sql`
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
 * 每个查询词命中了语料里的哪些说法（相关度不低于 `min`），按相关度从高到低。
 * 所有词的缓存一次读完，缺失部分并行重排后一次写回；同一个词只算一次。
 * 写回用 `on conflict do nothing`：并发检索得到的是同一确定分数，后到者可丢。
 */
export async function admit(
	texts: string[],
	min: number,
	store: DbExecutor = db,
): Promise<Map<string, Admitted[]>> {
	const unique = [...new Set(texts)];
	const out = new Map<string, Admitted[]>();
	if (unique.length === 0) return out;
	const candidates = await recall(store, unique);
	const scores = new Map(
		unique.map((text) => [text, new Map<number, number>()]),
	);
	const pairs = unique.flatMap((text, ord) =>
		(candidates.get(text) ?? []).map((candidate) => ({
			ord,
			text,
			candidate,
		})),
	);
	const space = rerankSpaceId();
	if (pairs.length > 0) {
		const cached = await store.execute<{
			ord: number;
			phrase_id: number;
			relevance: number;
		}>(sql`
			with q(ord, query, phrase_id) as (values ${sql.join(
				pairs.map(
					({ ord, text, candidate }) =>
						sql`(${ord}::int, ${text}, ${candidate.phrase_id}::int)`,
				),
				sql`, `,
			)})
			select q.ord, q.phrase_id, r.relevance
			from q join phrase_relevance r
				on r.space = ${space} and r.query = q.query and r.phrase_id = q.phrase_id`);
		for (const row of cached.rows)
			scores
				.get(unique[row.ord] as string)
				?.set(row.phrase_id, Number(row.relevance));
	}

	const missing = unique.map((text) => ({
		text,
		candidates: (candidates.get(text) ?? []).filter(
			(candidate) => !scores.get(text)?.has(candidate.phrase_id),
		),
	}));
	const ranked = await Promise.all(
		missing.map(async ({ text, candidates: list }) => ({
			text,
			candidates: list,
			scores:
				list.length === 0
					? []
					: await rerank(
							text,
							list.map((candidate) => candidate.text),
						),
		})),
	);
	const fresh = ranked.flatMap(({ text, candidates: list, scores: values }) =>
		list.map((candidate, index) => ({
			text,
			phraseId: candidate.phrase_id,
			relevance: values[index] as number,
		})),
	);
	for (const row of fresh)
		scores.get(row.text)?.set(row.phraseId, row.relevance);
	if (fresh.length > 0)
		await store.execute(sql`
			insert into phrase_relevance (space, query, phrase_id, relevance)
			values ${sql.join(
				fresh.map(
					(row) =>
						sql`(${space}, ${row.text}, ${row.phraseId}, ${row.relevance})`,
				),
				sql`, `,
			)}
			on conflict do nothing`);

	for (const text of unique) {
		const relevance = scores.get(text);
		if (!relevance) throw new Error(`查询词「${text}」缺少重排结果集`);
		out.set(
			text,
			(candidates.get(text) ?? [])
				.map((candidate) => {
					const score = relevance.get(candidate.phrase_id);
					if (score === undefined)
						throw new Error(`说法 ${candidate.phrase_id} 缺少重排分数`);
					return { phraseId: candidate.phrase_id, relevance: score };
				})
				.filter((hit) => hit.relevance >= min)
				.sort((a, b) => b.relevance - a.relevance),
		);
	}
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
