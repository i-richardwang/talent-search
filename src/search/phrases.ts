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
 *
 * **两次快照，模型调用夹在中间。** 快照（`#/db` 的 `withCorpusSnapshot`）占着
 * 池里的一条连接，所以一次慢端点调用不许发生在快照内。于是这里把一次准入
 * 拆成三段：嵌入在快照外 → 第一次快照做召回和读缓存 → 重排在快照外 →
 * 调用方的那次快照（第二次）核对嵌入空间还是不是同一个，是就接着取数。
 * 计划里带的是 phrase id，换过嵌入空间它们就指向别的说法了，所以核对不能省，
 * 只能重算（`withAdmission`）。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { type DbExecutor, withCorpusSnapshot } from "#/db";
import { embed, vectorLiteral } from "#/server/embed";
import { rerank, rerankSpaceId } from "#/server/rerank";
import { RECALL_MAX, RECALL_MIN } from "./weights";

/** 一个查询词命中的一条说法。 */
export type Admitted = { phraseId: number; relevance: number };

/**
 * 一个查询词在这一版语料里的候选说法与它们的分数。分数表的键集合最终**就是**
 * 候选集合（缓存里读到的 + 这次打出来的），命中名单直接由它得出，不必再拿
 * 候选去查一次分数——查不到该怎么办这个问题因此不存在。
 */
type Recalled = {
	text: string;
	candidates: { phraseId: number; text: string }[];
	scores: Map<number, number>;
};

/**
 * 每个查询词在语料里的候选说法：向量召回，按相似度取前 `RECALL_MAX` 个。
 * 所有词一条 SQL 取完，不串成 n 次往返。向量是快照外嵌好的。
 */
async function recall(
	store: DbExecutor,
	texts: string[],
	vectors: number[][],
): Promise<Recalled[]> {
	const out: Recalled[] = texts.map((text) => ({
		text,
		candidates: [],
		scores: new Map(),
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
			select p.id as phrase_id, p.text
			from phrase p
			where 1 - (p.embedding <=> q.v) >= ${RECALL_MIN}
			order by p.embedding <=> q.v
			limit ${RECALL_MAX}
		) c`);
	for (const row of rows.rows)
		out[row.ord]?.candidates.push({
			phraseId: row.phrase_id,
			text: row.text,
		});
	return out;
}

/** 这些「查询词 × 说法」以前打过分吗。一条 SQL 读完全部。 */
async function cachedScores(
	store: DbExecutor,
	space: string,
	recalled: Recalled[],
) {
	const pairs = recalled.flatMap((r, ord) =>
		r.candidates.map((candidate) => ({ ord, query: r.text, candidate })),
	);
	if (pairs.length === 0) return;
	const cached = await store.execute<{
		ord: number;
		phrase_id: number;
		relevance: number;
	}>(sql`
		with q(ord, query, phrase_id) as (values ${sql.join(
			pairs.map(
				({ ord, query, candidate }) =>
					sql`(${ord}::int, ${query}, ${candidate.phraseId}::int)`,
			),
			sql`, `,
		)})
		select q.ord, q.phrase_id, r.relevance
		from q join phrase_relevance r
			on r.space = ${space} and r.query = q.query and r.phrase_id = q.phrase_id`);
	for (const row of cached.rows)
		recalled[row.ord]?.scores.set(row.phrase_id, row.relevance);
}

/** 这次新打出来的分。等进了快照、确认还是同一个嵌入空间，才写回缓存。 */
type FreshScore = { query: string; phraseId: number; relevance: number };

/** 一次准入的完整计划：它站在哪一版语料上，各词命中了什么，欠着哪些缓存写。 */
type Plan = {
	generation: string;
	admitted: Map<string, Admitted[]>;
	fresh: FreshScore[];
};

/**
 * 召回 + 判定，两个模型端点都在快照外打。
 *
 * 返回的计划带着它站的那一版语料：里面的 phrase id 只在那一版里有意义。
 */
async function planAdmission(
	texts: string[],
	min: number,
	space: string,
): Promise<Plan> {
	const unique = [...new Set(texts)];
	const vectors = await embed(unique);
	const { generation, recalled } = await withCorpusSnapshot(
		async (store, generation) => {
			const recalled = await recall(store, unique, vectors);
			await cachedScores(store, space, recalled);
			return { generation, recalled };
		},
	);

	const fresh: FreshScore[] = [];
	await Promise.all(
		recalled.map(async (r) => {
			const missing = r.candidates.filter(
				(candidate) => !r.scores.has(candidate.phraseId),
			);
			if (missing.length === 0) return;
			const values = await rerank(
				r.text,
				missing.map((candidate) => candidate.text),
			);
			missing.forEach((candidate, index) => {
				const relevance = values[index] as number;
				r.scores.set(candidate.phraseId, relevance);
				fresh.push({ query: r.text, phraseId: candidate.phraseId, relevance });
			});
		}),
	);

	return {
		generation,
		admitted: new Map(
			recalled.map((r) => [
				r.text,
				[...r.scores]
					.filter(([, relevance]) => relevance >= min)
					.map(([phraseId, relevance]) => ({ phraseId, relevance }))
					.sort((a, b) => b.relevance - a.relevance),
			]),
		),
		fresh,
	};
}

/**
 * 写回重排缓存。`on conflict do nothing`：同一个重排空间对同一对文本的分数是
 * 确定的，并发检索算出来的是同一个数，后到者可丢。
 */
async function cacheScores(
	store: DbExecutor,
	space: string,
	fresh: FreshScore[],
) {
	if (fresh.length === 0) return;
	await store.execute(sql`
		insert into phrase_relevance (space, query, phrase_id, relevance)
		values ${sql.join(
			fresh.map(
				(row) =>
					sql`(${space}, ${row.query}, ${row.phraseId}, ${row.relevance})`,
			),
			sql`, `,
		)}
		on conflict do nothing`);
}

/**
 * 一次准入连着一次快照内的取数，最多重来这么多次。
 *
 * 换嵌入空间是一件难得发生的事，一次检索连撞三回不再是巧合，
 * 而是某处不停地在换——继续重试只会把它磨成一串白打的端点调用。
 */
const PLAN_ATTEMPTS = 3;

/**
 * 在同一个嵌入空间上完成「准入 + 取数」。准入在快照外算（要打两个模型端点），
 * 取数在快照内做。
 *
 * 两段之间嵌入空间可能被换掉、说法表整张重来，而计划里的 phrase id 是旧的：
 * 照着取数就是拿旧 id 去指新说法，得到的是一份看起来完全正常的错名单。所以进
 * 快照第一件事是核对代号，对不上就整个重算——重排缓存也在核对之后才写，旧 id
 * 的分数不该落进新空间的缓存里。派生的增量提交不改 id，不触发这条。
 */
export async function withAdmission<T>(
	texts: string[],
	min: number,
	use: (store: DbExecutor, admitted: Map<string, Admitted[]>) => Promise<T>,
): Promise<T> {
	// 一个词都没有就没有召回，计划里也就没有任何指向某一版语料的 id：直接进语料锁。
	if (texts.length === 0)
		return withCorpusSnapshot((store) => use(store, new Map()));
	// 重排端点没配就在这里抛，不进语料快照：没有判定这一步，召回出来的候选里
	// 一半是「前端」对「后端」这种反义，装作能用等于给一份错名单。
	const space = rerankSpaceId();
	for (let attempt = 0; attempt < PLAN_ATTEMPTS; attempt++) {
		const plan = await planAdmission(texts, min, space);
		const done = await withCorpusSnapshot(async (store, generation) => {
			if (generation !== plan.generation) return null;
			await cacheScores(store, space, plan.fresh);
			return { value: await use(store, plan.admitted) };
		});
		if (done) return done.value;
	}
	throw new Error(
		`嵌入空间连续 ${PLAN_ATTEMPTS} 次在检索期间被换掉，这次检索放弃`,
	);
}

/**
 * 命中的说法摆成一张 VALUES 表 `(term_idx, member_idx, phrase_id, relevance, weight)`，
 * 供取数 SQL 沿 `experience_phrase` 走到经历段。`weight` 是这个说法的权重
 * （`MEMBER_TIER_WEIGHTS`），只给「同一段几个说法都命中时留哪一个」的排序用；
 * 不打分的调用方传 1。一行都没有时返回 null——空的 VALUES 不是合法 SQL，
 * 而且没有命中就没有取数可做。
 */
export function admittedTable(
	rows: { termIdx: number; memberIdx: number; hit: Admitted; weight: number }[],
) {
	if (rows.length === 0) return null;
	return sql`(values ${sql.join(
		rows.map(
			(r) =>
				sql`(${r.termIdx}::int, ${r.memberIdx}::int, ${r.hit.phraseId}::int, ${r.hit.relevance}::float, ${r.weight}::float)`,
		),
		sql`, `,
	)})`;
}
