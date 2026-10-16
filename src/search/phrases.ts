/**
 * 查询词先按向量召回说法，再按「说法：释义」判定相关度。向量只排除明显无关的说法；
 * 过了 `RECALL_MIN` 的全部交给重排判断，不按条数截断：截在哪里，排在后面的人就
 * 无声地从名单上消失。重排分数按查询词和候选文本缓存，同一个词只在第一次判断全量。
 * 模型调用在快照外完成；取数快照重新召回，只消费当前候选文本的已保存分数。
 * 当前候选还有未判定的输入、或嵌入空间已经改变时，重新准备下一份计划。
 *
 * 词表里同一项的几种写法是同一件事，重排都读标准写法的释义：各写各的释义，措辞一变分数就差很远
 * （「SQL」和「sql」对「数据库」一个 0.17 一个 0.54），冷门写法的释义写偏了还会把整项带偏。
 *
 * 重排只认得字面相近，不知道「Java 开发」属于「后端开发」、「新媒体运营」比「短视频运营」宽。
 * 这些关系记在词表里（`term`），判定之后再按词表走一遍（`throughVocabulary`）。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { SHORT_ROUTES } from "#/db/schema";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import { embed, vectorLiteral } from "#/server/embed";
import { rerank, rerankSpaceId } from "#/server/rerank";
import { RECALL_MIN } from "./weights";

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
		select q.ord, p.id as phrase_id,
			case when g.gloss is null then p.text else p.text || '：' || g.gloss end as text
		from q join phrase p on 1 - (p.embedding <=> q.v) >= ${RECALL_MIN}
		left join term t on t.word = p.text
		left join lateral (
			select x.gloss from phrase_gloss x
			where x.text in (t.canonical, p.text)
			order by x.text = t.canonical desc limit 1
		) g on exists (
			select 1 from experience_phrase ep where ep.phrase_id = p.id
			and ep.route in (${sql.join(
				SHORT_ROUTES.map((route) => sql`${route}`),
				sql`, `,
			)}))`);
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
			return {
				value: await use(store, {
					phraseHits: await throughVocabulary(store, phraseHits),
				}),
			};
		});
		if (done) return done.value;
	}
	throw new Error(
		`语料连续 ${PLAN_ATTEMPTS} 次在检索期间发生变化，这次检索放弃`,
	);
}

/**
 * 按词表修正一个查询词的命中，两个方向用的是同一句话：写了细的人符合宽的要求，反过来不成立。
 *
 * 两个方向都从要找的词在词表里的位置出发：它在词表里就是它，不在词表里就用最对得上的命中词。
 * 重排分不出宽细，「媒体运营」对「短视频运营」也给高分，所以别的命中词和要找的谁宽谁细不知道，
 * 它们只算自己和自己的其他写法。
 *
 * - 往上挡：这个位置往上的上级比要找的宽，连同它们的写法不算命中。搜「短视频运营」时只写了
 *   「新媒体运营」的人，没法确认做过短视频。别的分支上一个子词得分高过它的上级，不说明那个
 *   上级比要找的宽：搜「数据库」时「SQL Server」略高于「SQL」，「SQL」照样算命中。
 * - 往下带：这个位置下面的细词（一层层往下）和它们的写法都算命中，相关度沿用这个位置的。
 *   搜「后端开发」时写了「Java 开发」的人也在名单上，证据仍是他自己的原话。别的命中词下面的细词
 *   不跟着带：搜「短视频运营」命中了「媒体运营」，不等于写了「公众号运营」的人做过短视频。
 *
 * 一项的几种写法是同一件事。要找的词就是其中一种写法时，整项按最对得上的那种写法算。
 * 别的命中项沿用标准写法（写的人最多的那个）的相关度，不沿用其中最高的：冷门写法的释义写偏了
 * （「算法开发岗」写成解决推荐问题），不能让写了「算法工程师」的人都算做过推荐。每条说法自己判得的
 * 分照样算它自己。被挡掉的项连同它的写法不算命中；不在词表里的说法原样保留。同一条说法几处得分取最高的。
 */
async function throughVocabulary(
	store: DbExecutor,
	phraseHits: Map<string, PhraseHit[]>,
): Promise<Map<string, PhraseHit[]>> {
	const texts = [...phraseHits.keys()];
	const rows = texts.flatMap((text, ord) =>
		(phraseHits.get(text) ?? []).map((hit) => ({ ord, hit })),
	);
	if (rows.length === 0) return phraseHits;
	const { rows: corrected } = await store.execute<{
		ord: number;
		phrase_id: number;
		relevance: number;
	}>(sql`
		with recursive hit(ord, phrase_id, relevance) as (select * from unnest(
			${sql.param(rows.map((r) => r.ord))}::int[],
			${sql.param(rows.map((r) => r.hit.phraseId))}::int[],
			${sql.param(rows.map((r) => r.hit.relevance))}::double precision[]
		)),
		matched as (
			select h.ord, t.canonical as term,
				max(h.relevance) filter (where t.word = t.canonical) as relevance,
				max(h.relevance) as best
			from hit h join phrase p on p.id = h.phrase_id
			join term t on t.word = p.text
			group by h.ord, t.canonical
		),
		query(ord, term) as (
			select q.ord, t.canonical from unnest(
				${sql.param(texts.map((_, ord) => ord))}::int[],
				${sql.param(texts)}::text[]
			) as q(ord, text) join term t on t.word = q.text
		),
		anchor(ord, term, relevance) as (
			select q.ord, q.term, m.best from query q
			join matched m on m.ord = q.ord and m.term = q.term
			union all
			select m.ord, m.term, m.relevance from matched m
			where not exists (select 1 from query q where q.ord = m.ord)
				and m.relevance = (select max(x.relevance) from matched x where x.ord = m.ord)
		),
		broader(ord, term) as (
			select q.ord, t.parent from (
				select ord, term from query union select ord, term from anchor
			) q join term t on t.word = q.term where t.parent is not null
			union
			select b.ord, t.parent from broader b
			join term t on t.word = b.term where t.parent is not null
		),
		kept as (
			select m.ord, m.term, m.relevance from matched m
			where m.relevance is not null and not exists (select 1 from broader b
				where b.ord = m.ord and b.term = m.term)
		),
		down(ord, term, relevance) as (
			select ord, term, relevance from anchor
			union
			select d.ord, c.word, d.relevance from down d
			join term c on c.parent = d.term
		),
		through as (
			select d.ord, p.id as phrase_id, d.relevance
			from (select * from kept union select * from down) d
			join term a on a.canonical = d.term
			join phrase p on p.text = a.word
		),
		standing as (
			select h.* from hit h join phrase p on p.id = h.phrase_id
			left join term t on t.word = p.text
			where t.word is null or not exists (select 1 from broader b
				where b.ord = h.ord and b.term = t.canonical)
		)
		select ord, phrase_id, max(relevance) as relevance
		from (select * from through union all select * from standing) all_hits
		group by ord, phrase_id`);
	const out = new Map<string, PhraseHit[]>(texts.map((text) => [text, []]));
	for (const row of corrected)
		out.get(texts[row.ord] as string)?.push({
			phraseId: row.phrase_id,
			relevance: row.relevance,
		});
	for (const hits of out.values())
		hits.sort((a, b) => b.relevance - a.relevance);
	return out;
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
