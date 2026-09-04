/**
 * 检索的取数层：把几条要求变成「哪些经历段以多高的相似度命中了哪条要求」
 * 这一份事实，交给 `rank.ts` 去打分、排序、算分面。
 *
 * 这个文件里没有任何权重、没有 AND 判定、没有分面口径——它只回答「命中了什么」。
 * 「怎么找到人」和「找到之后怎么排」分别演进；取数方式变化时，排名逻辑不动。
 *
 * 命中的判定是**语义**的，而且不在这个文件里：一个查询词在语料里对应哪些说法、
 * 各自相关度多少，由 `phrases.ts` 回答（向量召回 + 重排判定）；这里拿到那批
 * 「命中的说法」，沿 `experience_phrase` 走到经历段和人。「算法」因此找得到
 * 岗位写着「深度学习工程师」的段，不需要谁替库补同义词。
 */

import "@tanstack/react-start/server-only";
import { inArray, type SQL, sql } from "drizzle-orm";
import { type DbExecutor, withCorpusSnapshot } from "#/db";
import { employee, experience } from "#/db/schema";
import { seqLabel } from "#/lib/format";
import {
	DIM_KEYS,
	DIMENSIONS,
	type DimKey,
	type DimSource,
	dimId,
	dimPicked,
	type Picked,
	VOCAB_KEYS,
	type VocabKey,
} from "./dimensions";
import { emptyReason } from "./empty";
import type { Vocabulary } from "./intent";
import { narrowsPopulation, sanitizeLimit } from "./params";
import { activeChips, parseChips } from "./parse";
import { type Admitted, admit, admittedTable } from "./phrases";
import {
	type Fact,
	type PopulationFact,
	pageHits,
	rank,
	rankPopulation,
} from "./rank";
import {
	emptyFacets,
	type Hit,
	type RankedResult,
	type SearchFilters,
	type SearchOutcome,
	type TermPlan,
} from "./result";
import type { SearchScope, SearchSpec } from "./spec";
import {
	FACT_MAX,
	HITS_PER_TERM,
	RELEVANCE_MIN,
	RELEVANCE_MIN_EXCLUDE,
	RESULT_PAGE,
	ROUTE_ORDER,
	ROUTE_WEIGHTS,
	type Route,
	WIDE_SHARE,
} from "./weights";

/**
 * 公司名 / 学校名条件里的 `%` `_` `\` 是 ILIKE 的元字符，必须先转义成字面量。
 *
 * 不转义的话「%%」两个字符就让每一行恒真；「客户_经理」里的下划线会悄悄变成
 * 「任意一个字」。反斜杠是 Postgres 的默认转义符，不必额外写 escape。
 */
function escapeLike(term: string) {
	return term.replace(/[\\%_]/g, "\\$&");
}

function like(term: string) {
	return sql`${`%${escapeLike(term)}%`}`;
}

function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

/**
 * 这些词里，哪些在语料里命中的**人**占比超过了 `WIDE_SHARE`——也就是**太宽**。
 *
 * 单位是人，不是经历段。尺子的读数必须和它标签上的单位一致：这把尺支撑的
 * 承诺是「几乎筛不掉人」，而按段量的话，一个囤了九段命中经历的人会被数成
 * 九个——段占比很高、名单上却只多他一个人的词，根本不宽。
 *
 * 宽是语料的事实，不是能预先列举的判断：同一个词在两份语料里的覆盖面可以差
 * 一个数量级。理解落库前拿它给新解析出的词量宽（`server/turn.ts` 的
 * benchWide，超标的可见地停用）。只探语料、不带筛选——宽不宽只由词和语料决定。
 *
 * 命中口径必须和这些词**自己**的检索口径相同（这里按 `RELEVANCE_MIN` 量，
 * 所以只能量按同一条线进门的词），否则量出来的宽和搜出来的宽不是一回事：
 * 排除词按 `RELEVANCE_MIN_EXCLUDE` 判，拿这把尺去量它，读数天然偏大。
 * 谁该被量由调用方决定（`server/turn.ts` 的 benchWide）。
 */
export async function probeWide(
	texts: string[],
	store?: DbExecutor,
): Promise<Set<string>> {
	if (texts.length === 0) return new Set();
	if (!store)
		return withCorpusSnapshot((snapshot) => probeWide(texts, snapshot));
	const admitted = await admit(texts, RELEVANCE_MIN, store);
	const rows = texts.flatMap((t, i) =>
		(admitted.get(t) ?? []).map((hit) => ({
			termIdx: i,
			memberIdx: 0,
			hit,
		})),
	);
	const table = admittedTable(rows);
	if (!table) return new Set();
	const wide = await store.execute<{ term_idx: number }>(sql`
		with total as (select count(distinct emp_id)::float as n from experience),
		q(term_idx, member_idx, phrase_id, relevance) as ${table}
		select q.term_idx from q
		join experience_phrase ep on ep.phrase_id = q.phrase_id
		join experience e on e.id = ep.experience_id, total
		group by q.term_idx, total.n
		having count(distinct e.emp_id) > total.n * ${WIDE_SHARE}`);
	return new Set(wide.rows.map((row) => texts[row.term_idx] as string));
}

type FactRow = {
	term_idx: number;
	member_idx: number;
	id: number;
	route: Route;
	relevance: number;
	emp_id: string;
	end_date: string | null;
} & DimSource;

type PopulationRow = { emp_id: string } & DimSource;

type FactLoad =
	| { kind: "loaded"; facts: Fact[] }
	| { kind: "overflow"; termIndexes: number[] };

/**
 * 从各要求的事实行数里找出造成超载的主要贡献者。
 *
 * 按贡献从大到小摘，直到剩余事实能进保险丝；同样行数按查询顺序稳定并列。
 * 返回时再恢复查询顺序，让界面上的点名顺序和 chips 一致。这把尺只解释
 * `FACT_MAX`，不借用按人数占比计算的 `probeWide`。
 */
export function overflowContributors(
	counts: readonly { termIdx: number; facts: number }[],
	limit: number = FACT_MAX,
): number[] {
	let remaining = counts.reduce((sum, c) => sum + c.facts, 0);
	if (remaining <= limit) return [];
	const selected: number[] = [];
	for (const count of [...counts].sort(
		(a, b) => b.facts - a.facts || a.termIdx - b.termIdx,
	)) {
		selected.push(count.termIdx);
		remaining -= count.facts;
		if (remaining <= limit) break;
	}
	return selected.sort((a, b) => a - b);
}

/**
 * 一段经历上供分面用的那几列，别名直接取 JS 里的字段名。
 *
 * 取回来的行**就是** `DimSource`，所以没有第二段「把 company_tag 抄成
 * companyTag」的映射——那种映射抄错一个字段不会报错，只会让这一维在内存里
 * 恒空，而屏幕上只是少一栏候选。`Record<keyof DimSource, SQL>` 让漏一列直接红。
 */
const FACT_COLUMNS: Record<keyof DimSource, SQL> = {
	months: sql`e.months`,
	seqL1: sql`e.seq_l1`,
	seqL2: sql`e.seq_l2`,
	kind: sql`e.kind`,
	companyTag: sql`e.org_meta ->> 'company_tag'`,
	level: sql`p.cur_level`,
	recruitment: sql`p.recruitment`,
	education: sql`p.education_level`,
};

/** 事实列的 select 片段。两处取数共用，形状因此不可能分家。 */
const factSelect = sql.join(
	Object.entries(FACT_COLUMNS).map(
		(entry) => sql`${entry[1]} as "${sql.raw(entry[0])}"`,
	),
	sql`, `,
);

/**
 * 每一维拿来比较的那个表达式，由上面的事实列拼出来——集合维给的是它的**身份**
 * （和 `dimensions.ts` 里 `id()` 算出来的必须是同一个字符串），阈值维给的是被
 * 比较的那个量。
 *
 * 谓词本身不写在这里，它由维度自己的 `match` 家族推出来（见 `dimCond`）：漏一维
 * 会被 `Record` 拦住，写歪一维会被「同一个条件下推还是在内存里筛」那条检索测试
 * 拦住。
 */
const DIM_COLUMN: Record<DimKey, SQL> = {
	// 序列的身份是两列拼出来的，分隔符和 `dimensions.ts` 的 `id()` 必须是同一个
	seq: sql`${FACT_COLUMNS.seqL1} || chr(1) || ${FACT_COLUMNS.seqL2}`,
	minMonths: FACT_COLUMNS.months,
	kind: FACT_COLUMNS.kind,
	level: FACT_COLUMNS.level,
	companyTag: FACT_COLUMNS.companyTag,
	recruitment: FACT_COLUMNS.recruitment,
	education: FACT_COLUMNS.education,
};

/** 一维的下推谓词。两个家族各写一次，和维度有几个无关。 */
function dimCond<K extends DimKey>(key: K, picked: Picked[K]): SQL | null {
	const column = DIM_COLUMN[key];
	if (DIMENSIONS[key].match === "atLeast")
		return sql`${column} >= ${picked as number}`;
	const ids = dimPicked(key, picked).map((value) => dimId(key, value));
	return ids.length > 0
		? sql`${column} in (${sql.join(
				ids.map((id) => sql`${id}`),
				sql`, `,
			)})`
		: null;
}

/**
 * 跟人走的精确条件（公司名 / 学校名）。它们是专有名词，永远不进向量：
 * 「字节」和「腾讯」在向量空间里是邻居，语义匹配会把竞品全捞进来。
 * 在取数里就按人裁掉，分面随之只数剩下的人——这正是「选了这一项之后
 * 还剩几人」该有的口径。
 *
 * 维度那七项在这里同样下推：它们来自那句原话，是问题的一部分，不会在这次
 * 结果页上再变。URL 上的筛选**不能**这样下推，因为筛选栏还要回答「再勾一项
 * 会剩几人」，那个数只有把没筛之前的完整事实端在手里才算得出来（`rank.ts`）。
 */
function searchScope(
	f: SearchScope,
	view: Pick<SearchFilters, "org" | "school">,
): SQL {
	const conds: SQL[] = [];
	for (const key of DIM_KEYS) {
		if (f[key] === undefined) continue;
		const cond = dimCond(key, f[key]);
		if (cond) conds.push(cond);
	}
	// 范围里的和 URL 上的各自成条件、AND 到一起：两者生命周期不同，但都要满足。
	for (const value of [f.org, view.org])
		if (value)
			conds.push(sql`exists (
			select 1 from experience x where x.emp_id = p.emp_id
			and (x.org ilike ${like(value)} or x.org_path ilike ${like(value)}))`);
	for (const value of [f.school, view.school])
		if (value) conds.push(sql`p.school ilike ${like(value)}`);
	return conds.length > 0 ? sql`where ${sql.join(conds, sql` and `)}` : sql``;
}

/**
 * 同一要求、同一经历段只留证据最硬的那一次命中。
 *
 * 每条要求按说法展开：说法之间是 OR，但各自单独判定，因为「命中的是哪个说法」
 * 要进证据行。一段几路都可能命中、几个说法都可能命中，这里按
 * `路权重 × 相关度` 只留最硬的一行。打分层按事实累加月份（rank.ts 的
 * termValue），同段两行会把 12 个月数成 24；证据行也会把同一段列两遍。
 * 去重必须在 SQL 里做完再过保险丝：在内存里去重的话，三个说法的宽词会把
 * FACT_MAX 提前引爆三倍。
 */
function canonicalFacts(
	table: SQL,
	scope: SearchScope,
	view: Pick<SearchFilters, "org" | "school">,
) {
	const routeWeight = sql`case ep.route ${sql.join(
		ROUTE_ORDER.map((r) => sql`when ${r} then ${ROUTE_WEIGHTS[r]}::float`),
		sql` `,
	)} end`;
	const routeOrder = sql`case ep.route ${sql.join(
		ROUTE_ORDER.map((route, index) => sql`when ${route} then ${index}`),
		sql` `,
	)} end`;
	return sql`
		with q(term_idx, member_idx, phrase_id, relevance) as ${table}
		select distinct on (q.term_idx, e.id)
			q.term_idx, q.member_idx, e.id, ep.route, q.relevance,
			e.emp_id, e.end_date, ${factSelect}
		from q
		join experience_phrase ep on ep.phrase_id = q.phrase_id
		join experience e on e.id = ep.experience_id
		join employee p on p.emp_id = e.emp_id
		${searchScope(scope, view)}
		order by q.term_idx, e.id, (${routeWeight}) * q.relevance desc,
			q.member_idx, ${routeOrder}`;
}

/**
 * 命中的经历事实。超过内存保险丝时返回真正贡献事实行的要求，不截断结果。
 *
 * 取数不带分面维度的筛选：分面要回答「摘掉这一维之后还剩几人」，它需要看到
 * 被筛掉的那些行。筛选、AND、人员打分、排序与分面都在 rank.ts 对这份事实求值。
 * 只有跟人走的精确条件（searchScope）在这里生效——它们没有分面。
 */
async function fetchFacts(
	store: DbExecutor,
	terms: TermPlan[],
	admitted: Map<string, Admitted[]>,
	scope: SearchScope,
	view: Pick<SearchFilters, "org" | "school">,
): Promise<FactLoad> {
	const table = admittedTable(
		terms.flatMap((t, termIdx) =>
			t.members.flatMap((m, memberIdx) =>
				(admitted.get(m) ?? []).map((hit) => ({ termIdx, memberIdx, hit })),
			),
		),
	);
	if (!table) return { kind: "loaded", facts: [] };
	const rows = await store.execute<FactRow>(sql`
		select * from (${canonicalFacts(table, scope, view)}) facts
		limit ${FACT_MAX + 1}`);

	if (rows.rows.length > FACT_MAX) {
		const counts = await store.execute<{ term_idx: number; facts: number }>(sql`
			select term_idx, count(*)::int as facts
			from (${canonicalFacts(table, scope, view)}) facts
			group by term_idx`);
		return {
			kind: "overflow",
			termIndexes: overflowContributors(
				counts.rows.map((r) => ({ termIdx: r.term_idx, facts: r.facts })),
			),
		};
	}

	return {
		kind: "loaded",
		facts: rows.rows.map(
			({ emp_id, term_idx, member_idx, end_date, ...dims }) => ({
				...dims,
				empId: emp_id,
				termIdx: term_idx,
				memberIdx: member_idx,
				relevance: Number(dims.relevance),
				endDate: end_date,
			}),
		),
	};
}

/**
 * 被排除词否决的**经历段**。这些段丧失为任何要求作证的资格；人不被判决——
 * 没了这些段还有别的证据的人照常进结果，只有这些段的人过不了 AND，自然出局。
 * 排除因此和「从经历找人」是同一个语义，不是一套针对人的黑名单。
 *
 * **不带当前筛选。** 否决问的是「这一段是不是 X」，答案只能由这段经历自己决定。
 * 让筛选参与，「只看在职经历」就会让入职前那段实习重新有资格作证，
 * 于是收窄一个筛选反而放出更多本来站不住的证据。
 *
 * **门槛比进门高**（RELEVANCE_MIN_EXCLUDE）：进门的词可以扩，赶人的词必须准。
 */
async function fetchVetoed(
	store: DbExecutor,
	texts: string[],
	admitted: Map<string, Admitted[]>,
): Promise<Set<number>> {
	if (texts.length === 0) return new Set();
	const table = admittedTable(
		texts.flatMap((t, i) =>
			(admitted.get(t) ?? [])
				.filter((hit) => hit.relevance >= RELEVANCE_MIN_EXCLUDE)
				.map((hit) => ({ termIdx: i, memberIdx: 0, hit })),
		),
	);
	if (!table) return new Set();
	const rows = await store.execute<{ id: number }>(sql`
		with q(term_idx, member_idx, phrase_id, relevance) as ${table}
		select distinct ep.experience_id as id
		from q join experience_phrase ep on ep.phrase_id = q.phrase_id`);
	return new Set(rows.rows.map((r) => r.id));
}

/**
 * 每一维取值最多取几个。这是一条**读语料的上限**，不是模型契约：这几维都是
 * 个位数到两位数量级，取 100 已经是「全都要」，它挡的是脏数据把一整列不同的
 * 公司名当成档位灌进 prompt。
 */
const VOCAB_MAX = 100;

/**
 * 词表里的取值各自住在哪张表上。哪几维有词表由 `VOCAB_KEYS` 说，这里按它穷尽。
 *
 * **取值表达式不重写**——和取数、下推谓词用的是同一份 `FACT_COLUMNS`，公司档
 * 哪天从 `org_meta` 挪成一列，改一处。
 */
const VOCAB_SOURCE: Record<VocabKey, SQL> = {
	companyTag: sql`experience e`,
	level: sql`employee p`,
	recruitment: sql`employee p`,
	education: sql`employee p`,
};

/**
 * 查询理解能用的筛选词汇表——**语料里真实存在的取值**。
 *
 * 模型只能从这里挑，不许凭常识造一个「一线大厂」或「P8」出来：造出来的值
 * 筛不到任何人，而界面上那一维会显示成一个选中了却空着的筛选。语料就是词典。
 * 空串与「未知」不是取值。
 */
export async function vocabulary(store?: DbExecutor): Promise<Vocabulary> {
	if (store) return vocabularyFrom(store);
	return withCorpusSnapshot((snapshot) => vocabularyFrom(snapshot));
}

async function vocabularyFrom(store: DbExecutor): Promise<Vocabulary> {
	const rows = await store.execute<Record<VocabKey, string[]>>(sql`
		select ${sql.join(
			VOCAB_KEYS.map(
				(key) => sql`array(select v from (
				select ${FACT_COLUMNS[key]} as v, count(*) as n
				from ${VOCAB_SOURCE[key]} group by 1
			) c where v is not null and v not in ('', '未知')
			order by n desc, v limit ${VOCAB_MAX}) as "${sql.raw(key)}"`,
			),
			sql`, `,
		)}`);
	const row = rows.rows[0];
	const vocab = {} as Vocabulary;
	for (const key of VOCAB_KEYS) vocab[key] = row?.[key] ?? [];
	return vocab;
}

/**
 * 无语义要求时，每段符合查询范围的经历就是一条人口事实。它没有 route、相关度
 * 或证据段身份，不参与语义打分与证据展示；只用于人员筛选和分面计数。
 */
async function searchScopeOnly(
	store: DbExecutor,
	spec: SearchSpec,
	view: SearchFilters,
	limit: number,
): Promise<SearchOutcome> {
	const scope = spec.scope;
	const rows = await store.execute<PopulationRow>(sql`
		select e.emp_id, ${factSelect}
		from experience e join employee p on p.emp_id = e.emp_id
		${searchScope(scope, view)}
		order by e.id limit ${FACT_MAX + 1}`);
	if (rows.rows.length > FACT_MAX)
		return {
			order: "employee",
			terms: [],
			results: [],
			facets: emptyFacets(),
			total: 0,
			empty: emptyReason({
				spec,
				filters: view,
				terms: [],
				total: 0,
				withoutStrong: 0,
				overflow: { kind: "overflowPopulation" },
			}),
		};
	const facts: PopulationFact[] = rows.rows.map(({ emp_id, ...dims }) => ({
		...dims,
		empId: emp_id,
	}));
	const scopedView = {
		...view,
		org: undefined,
		school: undefined,
		strong: undefined,
	};
	const { empIds, facets, total } = rankPopulation(facts, scopedView);
	const pageIds = empIds.slice(0, limit);
	const employees =
		pageIds.length === 0
			? []
			: await store
					.select({
						empId: employee.empId,
						name: employee.name,
						curDept: employee.curDept,
						curTitle: employee.curTitle,
						curLevel: employee.curLevel,
					})
					.from(employee)
					.where(inArray(employee.empId, pageIds));
	const byId = new Map(employees.map((row) => [row.empId, row]));
	return {
		order: "employee",
		terms: [],
		results: pageIds.map((empId) => ({
			employee: required(byId.get(empId), `结构化结果缺少员工 ${empId}`),
		})),
		facets,
		total,
		empty: emptyReason({
			spec,
			filters: view,
			terms: [],
			total,
			withoutStrong: 0,
			overflow: null,
		}),
	};
}

export async function search(
	/** 完整查询语义来自不可变记录；filters 只描述这一次怎样查看结果。 */
	spec: SearchSpec,
	filters: SearchFilters = {},
	/**
	 * 要多少人。翻页靠把它调大重查，而不是靠 offset 续拉。
	 *
	 * offset 分页在这里是错的：排序键是算出来的分数，第二页的语义得是「同一次
	 * 排序里的第 51 到 100 名」，而 offset 只保证「再跑一次排序，跳过前 50」。
	 * 两次跑之间只要有一条经历落库，就会有人重复出现或整个消失，而界面上看不出来。
	 * 重拉一遍前 n 个总是自洽的。
	 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	// 停用的 chip 在这里就消失了，此后整条链路都看不见它——检索、打分、分面、
	// 证据行一个都不必知道「停用」这回事。这是它能只花一个字段的原因。
	const active = activeChips(parseChips(spec.evidence));
	const terms: TermPlan[] = active.flatMap((c) =>
		c.mode === "exclude"
			? []
			: [{ term: c.term, members: [c.term, ...(c.alts ?? [])], mode: c.mode }],
	);
	const vetoTexts = active.flatMap((c) =>
		c.mode === "exclude" ? [c.term, ...(c.alts ?? [])] : [],
	);
	// 结构化范围本身就是完整的候选定义，不需要伪造一个向量词来启动检索。
	if (terms.length === 0 && narrowsPopulation(spec.scope))
		return withCorpusSnapshot((store) =>
			searchScopeOnly(store, spec, filters, sanitizeLimit(limit)),
		);
	// 没有正向证据也没有结构化范围时，排除词自己不产出候选人。
	if (terms.length === 0)
		return {
			order: "relevance",
			terms: [],
			results: [],
			facets: emptyFacets(),
			total: 0,
			empty: emptyReason({
				spec,
				filters,
				terms,
				total: 0,
				withoutStrong: 0,
				overflow: null,
			}),
		};

	return withCorpusSnapshot(async (store) => {
		const positiveTexts = terms.flatMap((term) => term.members);
		const admitted = await admit(
			[...positiveTexts, ...vetoTexts],
			RELEVANCE_MIN,
			store,
		);
		const vetoed = await fetchVetoed(store, vetoTexts, admitted);
		const loaded = await fetchFacts(
			store,
			terms,
			admitted,
			spec.scope,
			filters,
		);
		if (loaded.kind === "overflow") {
			const contributors = new Set(loaded.termIndexes);
			return {
				order: "relevance",
				terms,
				results: [],
				facets: emptyFacets(),
				total: 0,
				empty: emptyReason({
					spec,
					filters,
					terms,
					total: 0,
					withoutStrong: 0,
					overflow: {
						kind: "overflowEvidence",
						terms: terms
							.filter((_, index) => contributors.has(index))
							.map((term) => term.term),
					},
				}),
			};
		}
		const facts = vetoed.size
			? loaded.facts.filter((fact) => !vetoed.has(fact.id))
			: loaded.facts;

		const { ranked, facets, total } = rank(facts, terms, filters, new Date());
		const empty = emptyReason({
			spec,
			filters,
			terms,
			total,
			withoutStrong: facets.strong.off,
			overflow: null,
		});
		const page = ranked.slice(0, sanitizeLimit(limit));
		if (page.length === 0)
			return {
				order: "relevance",
				terms,
				results: [],
				facets,
				total,
				empty,
			};

		const empIds = page.map((row) => row.empId);
		const evidence = pageHits(facts, filters, new Set(empIds), HITS_PER_TERM);

		// 名次确定后按 id 读取展示原文；命中判定只产生事实，不承担内容读取。
		const ids = [
			...new Set([...evidence.values()].flat().map((fact) => fact.id)),
		];
		const segments = await store
			.select()
			.from(experience)
			.where(inArray(experience.id, ids));
		const employees = await store
			.select({
				empId: employee.empId,
				name: employee.name,
				curDept: employee.curDept,
				curTitle: employee.curTitle,
				curLevel: employee.curLevel,
			})
			.from(employee)
			.where(inArray(employee.empId, empIds));

		const segById = new Map(segments.map((segment) => [segment.id, segment]));
		const empById = new Map(employees.map((person) => [person.empId, person]));

		const results: RankedResult[] = [];
		for (const row of page) {
			const emp = required(
				empById.get(row.empId),
				`相关度结果缺少员工 ${row.empId}`,
			);
			const hits: Hit[] = [];
			const personEvidence = required(
				evidence.get(row.empId),
				`相关度结果缺少员工 ${row.empId} 的证据`,
			);
			for (const fact of personEvidence) {
				const segment = required(
					segById.get(fact.id),
					`证据结果缺少经历段 ${fact.id}`,
				);
				const plan = required(
					terms[fact.termIdx],
					`证据结果引用了未知要求 ${fact.termIdx}`,
				);
				hits.push({
					experienceId: segment.id,
					term: plan.term,
					member: required(
						plan.members[fact.memberIdx],
						`证据结果引用了未知说法 ${fact.memberIdx}`,
					),
					route: fact.route,
					relevance: fact.relevance,
					kind: segment.kind,
					startDate: segment.startDate,
					endDate: segment.endDate,
					org: segment.org,
					title: segment.title,
					seq: seqLabel(segment.seqL1, segment.seqL2, segment.seqL3),
					months: segment.months,
				});
			}
			results.push({
				employee: emp,
				score: row.score,
				basis: row.basis,
				hits,
			});
		}
		return {
			order: "relevance",
			terms,
			results,
			facets,
			total,
			empty,
		};
	});
}
