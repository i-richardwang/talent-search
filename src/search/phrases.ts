/**
 * 查询词先按向量召回说法，再按「说法：释义」判定相关度。
 * 模型调用在快照外完成；取数快照重新召回，只消费当前候选文本的已保存分数。
 * 当前候选还有未判定的输入、或嵌入空间已经改变时，重新准备下一份计划。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { GLOSSED_ROUTES } from "#/db/schema";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import { embed, vectorLiteral } from "#/server/embed";
import { rerank, rerankSpaceId } from "#/server/rerank";
import { RECALL_MIN, RECALL_TOP } from "./weights";

/** 一个查询词命中的一条说法。 */
export type PhraseHit = { phraseId: number; relevance: number };

type Recalled = {
	text: string;
	candidates: { phraseId: number; text: string }[];
};
type PhraseMatches = { phraseHits: Map<string, PhraseHit[]> };

async function recall(
	store: DbExecutor,
	texts: string[],
	vectors: number[][],
): Promise<Recalled[]> {
	const out: Recalled[] = texts.map((text) => ({
		text,
		candidates: [],
	}));
	const q = sql`(values ${sql.join(
		vectors.map((v, i) => sql`(${i}::int, ${vectorLiteral(v)}::halfvec)`),
		sql`, `,
	)})`;
	const rows = await store.execute<{
		ord: number;
		phrase_id: number;
		text: string;
	}>(sql`
		with q(ord, v) as ${q}
		select q.ord, c.phrase_id, c.text
		from q cross join lateral (
			select p.id as phrase_id,
				case when g.gloss is null then p.text else p.text || '：' || g.gloss end as text
			from phrase p
			left join phrase_gloss g on g.text = p.text and exists (
				select 1 from experience_phrase ep where ep.phrase_id = p.id
				and ep.route in (${sql.join(
					GLOSSED_ROUTES.map((route) => sql`${route}`),
					sql`, `,
				)}))
			where 1 - (p.embedding <=> q.v) >= ${RECALL_MIN}
			order by p.embedding <=> q.v, p.id
			limit ${RECALL_TOP}
		) c`);
	for (const row of rows.rows)
		out[row.ord]?.candidates.push({
			phraseId: row.phrase_id,
			text: row.text,
		});
	return out;
}

/** 模型调用期间允许写者提交；连续变化的语料最多重新准备三次。 */
const PLAN_ATTEMPTS = 3;

export async function withMatchedPhrases<T>(
	texts: string[],
	min: number,
	use: (store: DbExecutor, matches: PhraseMatches) => Promise<T>,
): Promise<T> {
	if (texts.length === 0)
		return withCorpusSnapshot((store) => use(store, { phraseHits: new Map() }));
	rerankSpaceId();
	const unique = [...new Set(texts)];
	for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt++) {
		const { vectors, generation: embeddedIn } = await embed(unique);
		const plan = await withCorpusSnapshot(async (store, generation) =>
			generation === embeddedIn
				? { generation, recalled: await recall(store, unique, vectors) }
				: null,
		);
		if (!plan) continue;
		const scores = new Map<string, Map<string, number>>();
		await Promise.all(
			plan.recalled.map(async (r) => {
				const documents = r.candidates.map((c) => c.text);
				const values = await rerank(r.text, documents);
				scores.set(
					r.text,
					new Map(
						documents.map((text, index) => [text, values[index] as number]),
					),
				);
			}),
		);
		const done = await withCorpusSnapshot(async (store, generation) => {
			if (generation !== plan.generation) return null;
			const current = await recall(store, unique, vectors);
			const phraseHits = new Map<string, PhraseHit[]>();
			for (const r of current) {
				const hits: PhraseHit[] = [];
				for (const candidate of r.candidates) {
					const relevance = scores.get(r.text)?.get(candidate.text);
					if (relevance === undefined) return null;
					if (relevance >= min)
						hits.push({ phraseId: candidate.phraseId, relevance });
				}
				phraseHits.set(
					r.text,
					hits.sort((a, b) => b.relevance - a.relevance),
				);
			}
			return { value: await use(store, { phraseHits }) };
		});
		if (done) return done.value;
	}
	throw new Error(
		`语料连续 ${PLAN_ATTEMPTS} 次在检索期间发生变化，这次检索放弃`,
	);
}

/**
 * 召回记录通过四个等长数组参数组成 `(claim_idx, value_idx, phrase_id, relevance)` 表，
 * 供取数 SQL 关联到经历段。参数数量不随召回规模增长，相关度保留双精度。
 * `value_idx` 标识主张中命中的经历词；没有命中时返回 null，无需取数。
 */
export function phraseHitTable(
	rows: readonly { claimIdx: number; valueIdx: number; hit: PhraseHit }[],
) {
	if (rows.length === 0) return null;
	return sql`(select * from unnest(
		${sql.param(rows.map((r) => r.claimIdx))}::int[],
		${sql.param(rows.map((r) => r.valueIdx))}::int[],
		${sql.param(rows.map((r) => r.hit.phraseId))}::int[],
		${sql.param(rows.map((r) => r.hit.relevance))}::double precision[]
	))`;
}
