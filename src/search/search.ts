/**
 * 检索的取数层：把几条条件变成「哪些经历段以多高的相似度命中了哪条主张」
 * 这一份事实，交给 `rank.ts` 去打分、排序、算分面。
 *
 * 这个文件里没有任何权重、没有 AND 判定、没有分面口径——它只回答「命中了什么」。
 * 「怎么找到人」和「找到之后怎么排」分别演进；取数方式变化时，排名逻辑不动。
 *
 * 一条经历主张（`condition.ts`）的每一项都作用在**同一段经历**上：经历词由
 * `phrases.ts` 判定（向量召回 + 重排），这里拿到那批「命中的说法」沿
 * `experience_phrase` 走到经历段；公司名、公司档、经历来源是那一段上的谓词，
 * 在同一条 SQL 里裁掉不满足的段。没有经历词的主张（「待过字节」）不比文本，
 * 落在范围里的段本身就是事实。累计时长不在这里判——它是跨段的，归 `rank.ts`。
 * 人的条件是 `employee` 上的谓词，必须的按人裁，偏好的另问一次谁满足。
 *
 * 取数**站在一个语料快照上**，但准入不在快照里：判定要打两个模型端点，而快照占着
 * 池里的一条连接，占着它等模型等于让一次端点抖动耗光连接池。所以这里
 * 每一条取数路径都从 `withAdmission` 进去——它在快照外算好命中的说法，进快照
 * 时核对嵌入空间还是不是同一个（论证在 `phrases.ts` 和 `#/db`）。
 */

import "@tanstack/react-start/server-only";
import { inArray, type SQL, sql } from "drizzle-orm";
import { EXTRACTED_ROUTES, employee, experience } from "#/db/schema";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import { dots } from "#/lib/format";
import { escapeLike } from "#/lib/sql";
import type { ExperienceCondition, PersonCondition } from "./condition";
import {
	DIMENSIONS,
	type DimKey,
	type DimSource,
	dimId,
	dimPicked,
	NOT_A_VALUE,
	type Picked,
	VOCAB_KEYS,
	type VocabKey,
} from "./dimensions";
import { emptyReason } from "./empty";
import type { Vocabulary } from "./intent";
import type { SearchFilters } from "./params";
import { type Admitted, admittedTable, withAdmission } from "./phrases";
import {
	type Fact,
	type PopulationFact,
	pageHits,
	rank,
	rankPopulation,
} from "./rank";
import {
	type Claim,
	emptyFacets,
	type Facets,
	type Hit,
	type Query,
	queryOf,
	type RankedResult,
	type ResultEmployee,
	type SearchOutcome,
} from "./result";
import type { SearchSpec } from "./spec";
import {
	FACT_MAX,
	HITS_PER_CLAIM,
	RELEVANCE_MIN,
	RELEVANCE_MIN_EXCLUDE,
	RESULT_PAGE,
	ROUTE_ORDER,
	ROUTE_STRENGTH,
	type Route,
	strengthRank,
	WIDE_SHARE,
} from "./weights";

function like(term: string) {
	return sql`${`%${escapeLike(term)}%`}`;
}

/** 这几列里任一列含这几个名字里任一个。 */
function anyLike(names: readonly string[], columns: SQL[]) {
	return sql.join(
		names.flatMap((name) =>
			columns.map((column) => sql`${column} ilike ${like(name)}`),
		),
		sql` or `,
	);
}

/**
 * 这些词里，哪些在语料里命中的**人**占比超过了 `WIDE_SHARE`——也就是**太宽**。
 *
 * 单位是人，不是经历段。指标的读数必须和它标签上的单位一致：这个指标支撑的
 * 承诺是「几乎筛不掉人」，而按段量的话，一个囤了九段命中经历的人会被数成
 * 九个——段占比很高、名单上却只多他一个人的词，根本不宽。
 *
 * 宽是语料的事实，不是能预先列举的判断：同一个词在两份语料里的覆盖面可以差
 * 一个数量级。理解落库前拿它给新解析出的词量宽（`server/turn.ts` 的
 * benchWide，超标的可见地停用）。只探语料、不带筛选——宽不宽只由词和语料决定。
 *
 * 命中口径必须和这些词**自己**的检索口径相同（这里按 `RELEVANCE_MIN` 量，
 * 所以只能量按同一条阈值线通过的词），否则量出来的宽和搜出来的宽不是一回事：
 * 排除词按 `RELEVANCE_MIN_EXCLUDE` 判，拿这个指标去量它，读数天然偏大。
 * 谁该被量由调用方决定（`server/turn.ts` 的 benchWide）。
 *
 * 宽只有这一个口径。「一个词在语料里有几千种说法」不是宽：短语上向量分不开
 * 「客服」和「相关」，两者过线的说法一样多，说法的条数说不出词好不好。
 */
export async function probeWide(texts: string[]): Promise<Set<string>> {
	if (texts.length === 0) return new Set();
	return withAdmission(texts, RELEVANCE_MIN, async (store, { admitted }) => {
		const table = admittedTable(
			texts.flatMap((t, i) =>
				(admitted.get(t) ?? []).map((hit) => ({
					claimIdx: i,
					valueIdx: 0,
					hit,
				})),
			),
		);
		if (!table) return new Set<string>();
		const wide = await store.execute<{ claim_idx: number }>(sql`
			with total as (select count(distinct emp_id)::float as n from experience),
			q(claim_idx, value_idx, phrase_id, relevance) as ${table}
			select q.claim_idx from q
			join experience_phrase ep on ep.phrase_id = q.phrase_id
			join experience e on e.id = ep.experience_id, total
			group by q.claim_idx, total.n
			having count(distinct e.emp_id) > total.n * ${WIDE_SHARE}`);
		return new Set(wide.rows.map((row) => texts[row.claim_idx] as string));
	});
}

type FactRow = {
	claim_idx: number;
	/** 命中的是第几个经历词；不比文本的主张为 null */
	value_idx: number | null;
	id: number;
	route: Route | null;
	relevance: number;
	phrase: string | null;
	involvement: string | null;
	emp_id: string;
	end_date: string | null;
} & DimSource;

type PopulationRow = { id: number; emp_id: string } & DimSource;

/**
 * 一份没有人的结果的公共部分：没有人、没有候选、总数为零，只差一句「为什么」。
 *
 * 它出现在三个地方（一条条件都没解析出来、取数撞上上限的两条路），各写一遍
 * 的话，`Facets` 或 `SearchOutcome` 上加一个字段就会有一处忘了跟上，而少一个
 * 字段的空结果在屏幕上和别的空结果长得一模一样。分面必须现造一个：它是可变的。
 */
function noOne(): { results: []; facets: Facets; total: number } {
	return { results: [], facets: emptyFacets(), total: 0 };
}

/**
 * 去掉被排除否决的那些段。语义检索和只有人的条件两条路共用这一步——
 * 「命中排除词的段丧失作证资格」对人口事实同样成立：一段被否决了，它就不能
 * 再算作这个人落在范围里的凭据。各写一份的话，「只写范围加一个排除词」
 * 会安静地当那个排除词不存在。
 */
function keepUnvetoed<F extends { id: number }>(
	facts: F[],
	vetoed: Set<number>,
): F[] {
	return vetoed.size === 0 ? facts : facts.filter((f) => !vetoed.has(f.id));
}

/**
 * 结果列表要画的那几列。列的集合由 `result.ts` 的 `ResultEmployee` 说了算，
 * 这里按它取——两条路径各抄一份的话，加一列就会有一条路径少画一样东西。
 */
const RESULT_COLUMNS = {
	empId: employee.empId,
	name: employee.name,
	curDept: employee.curDept,
	curTitle: employee.curTitle,
	curLevel: employee.curLevel,
} satisfies Record<keyof ResultEmployee, unknown>;

type FactLoad =
	| { kind: "loaded"; facts: Fact[] }
	| { kind: "overflow"; claims: number[] };

/**
 * 从各主张的事实行数里找出造成超载的主要贡献者。
 *
 * 按贡献从大到小摘，直到剩余事实能进上限；同样行数按查询顺序稳定并列。
 * 返回时再恢复查询顺序，让界面上的点名顺序和 chips 一致。这个指标只解释
 * `FACT_MAX`，不借用按人数占比计算的 `probeWide`。
 */
export function overflowContributors(
	counts: readonly { claim: number; facts: number }[],
	limit: number = FACT_MAX,
): number[] {
	let remaining = counts.reduce((sum, c) => sum + c.facts, 0);
	if (remaining <= limit) return [];
	const selected: number[] = [];
	for (const count of [...counts].sort(
		(a, b) => b.facts - a.facts || a.claim - b.claim,
	)) {
		selected.push(count.claim);
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
	// 序列筛选认登记的，登记为空（入职前的段）才认模型对齐的；两对各自成对，不会
	// 一级来自登记、二级来自对齐。证据路 `seq` 不读这里，只嵌登记值。
	seqL1: sql`coalesce(nullif(e.seq_l1, ''), e.seq_inferred_l1)`,
	seqL2: sql`coalesce(nullif(e.seq_l2, ''), e.seq_inferred_l2)`,
	kind: sql`e.kind`,
	companyTag: sql`e.org_meta ->> 'company_tag'`,
	/*
	 * 一段的能力词是一列，不是一个值。段上的边是简历里的原话，筛选栏里的一项是标准词：
	 * 列里放的是每个词的标准写法（`skill_term.canonical`，没进表的词就是它自己），和它
	 * 往上的每一层更宽的词（`skill_term.parent`）。点「团队管理」要看到写了「人员管理」
	 * 的人，点「数据分析」要看到写了「销售数据分析」的人，点细的只看到细的；别名自己
	 * 不成为一项。往上走用 union 而不是 union all：词表不成环由整理任务保证，这里不再为它多一道。
	 */
	skills: sql`array(
		with recursive up(word) as (
			select coalesce(t.canonical, ph.text)
			from experience_phrase ep join phrase ph on ph.id = ep.phrase_id
			left join skill_term t on t.word = ph.text
			where ep.experience_id = e.id and ep.route = 'skill'
			union
			select t.parent from up join skill_term t on t.word = up.word
			where t.parent is not null
		)
		select word from up order by word)`,
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
 * 比较的那个量。一段一个值的写 `one`，一段一列值的（能力词）写 `any`：内存里
 * `values()` 本来就返回一列，SQL 这边得说清楚列在哪一层。
 *
 * 谓词本身不写在这里，它由维度自己的 `match` 家族推出来（见 `dimCond`）：漏一维
 * 会被 `Record` 拦住，写歪一维会被「同一个条件下推还是在内存里筛」那条检索测试
 * 拦住。
 */
const DIM_COLUMN: Record<DimKey, { one: SQL } | { any: SQL }> = {
	// 序列的身份是两列拼出来的，分隔符和 `dimensions.ts` 的 `id()` 必须是同一个
	seq: { one: sql`${FACT_COLUMNS.seqL1} || chr(1) || ${FACT_COLUMNS.seqL2}` },
	minMonths: { one: FACT_COLUMNS.months },
	kind: { one: FACT_COLUMNS.kind },
	level: { one: FACT_COLUMNS.level },
	companyTag: { one: FACT_COLUMNS.companyTag },
	skill: { any: FACT_COLUMNS.skills },
	recruitment: { one: FACT_COLUMNS.recruitment },
	education: { one: FACT_COLUMNS.education },
};

/** 一维的下推谓词。两个家族各写一次，和维度有几个无关。 */
function dimCond<K extends DimKey>(key: K, picked: Picked[K]): SQL | null {
	const column = DIM_COLUMN[key];
	if (DIMENSIONS[key].match === "atLeast") {
		// 阈值比的是一个量，一列值没有「至少」可言；声明成 any 是声明错了
		if ("any" in column) throw new Error(`${key} 是阈值维，列不能是 any`);
		return sql`${column.one} >= ${picked as number}`;
	}
	const ids = dimPicked(picked).map((value) => sql`${dimId(key, value)}`);
	if (ids.length === 0) return null;
	return "any" in column
		? sql`${column.any} && array[${sql.join(ids, sql`, `)}]::text[]`
		: sql`${column.one} in (${sql.join(ids, sql`, `)})`;
}

/**
 * 一条经历主张在**那一段经历**上的谓词：公司名、公司档、经历来源，一项一条。
 * 经历词不在这里（它由准入回答），累计时长也不在（它跨段，归 `rank.ts`）。
 *
 * 公司名是专有名词，永远不进向量：「字节」和「腾讯」在向量空间里是邻居，
 * 语义匹配会把竞品全匹配进来。它按这一段的公司名或部门路径模糊匹配。
 */
function segmentConds(claim: ExperienceCondition): SQL[] {
	const conds: SQL[] = [];
	if (claim.org)
		conds.push(sql`(${anyLike(claim.org, [sql`e.org`, sql`e.org_path`])})`);
	const tag = dimCond("companyTag", claim.companyTag && [...claim.companyTag]);
	if (tag) conds.push(tag);
	const kind = dimCond("kind", claim.kind);
	if (kind) conds.push(kind);
	return conds;
}

/**
 * 人的条件在 `employee p` 上的谓词，一条一个。词表维走维度自己的列表达式；
 * 学校名和公司名一样是专有名词，按名字模糊匹配。
 */
function personConds(conditions: readonly PersonCondition[]): SQL[] {
	return conditions.flatMap((c) => {
		if (c.field === "school")
			return [sql`(${anyLike(c.values, [sql`p.school`])})`];
		return dimCond(c.field, [...c.values]) ?? [];
	});
}

/**
 * URL 上的公司名 / 学校名筛选。它们没有分面，所以和人的必须条件一样在取数里
 * 按人裁掉：分面随之只数剩下的人——这正是「选了这一项之后还剩几人」该有的口径。
 * 维度那八项**不能**这样下推，因为筛选栏还要回答「再勾一项会剩几人」，那个数
 * 只有把没筛之前的完整事实端在手里才算得出来（`rank.ts`）。
 */
function viewConds(view: Pick<SearchFilters, "org" | "school">): SQL[] {
	const conds: SQL[] = [];
	if (view.org?.length)
		conds.push(sql`exists (
			select 1 from experience x where x.emp_id = p.emp_id
			and (${anyLike(view.org, [sql`x.org`, sql`x.org_path`])}))`);
	if (view.school?.length)
		conds.push(sql`(${anyLike(view.school, [sql`p.school`])})`);
	return conds;
}

function whereAll(conds: readonly SQL[]): SQL {
	return conds.length > 0
		? sql`where ${sql.join([...conds], sql` and `)}`
		: sql``;
}

/**
 * 候选里满足一条**人的偏好**的那些人。
 *
 * 偏好不裁人，只改名次（`rank.ts` 各乘一次 `BOOST_WEIGHT`），所以它不能像
 * 必须那样下推到取数的谓词里；也不在内存里判——事实行上没有学校。所以每条
 * 偏好单独问一次库，只问候选那批人，不扫全库。
 */
async function fetchPreferred(
	store: DbExecutor,
	condition: PersonCondition,
	empIds: Iterable<string>,
): Promise<Set<string>> {
	const ids = [...new Set(empIds)];
	if (ids.length === 0) return new Set();
	const rows = await store.execute<{ emp_id: string }>(sql`
		select p.emp_id from employee p
		where p.emp_id in (${sql.join(
			ids.map((id) => sql`${id}`),
			sql`, `,
		)}) and ${sql.join(personConds([condition]), sql` and `)}`);
	return new Set(rows.rows.map((r) => r.emp_id));
}

/** 事实行的公共列：主张下标、段、路、相关度、说法、人、结束日期，再加分面要读的几列。 */
const FACT_ROW = sql`e.id, e.emp_id, e.end_date, ${factSelect}`;

/**
 * 有经历词的主张：命中的说法沿 `experience_phrase` 走到段，同一主张、同一段
 * 只留证据最强的那一次命中。
 *
 * 每条主张按经历词展开：词之间是 OR，但各自单独判定，因为「命中的是哪个词」
 * 要进证据行。一段几类都可能命中、几个词都可能命中，这里只留最强的一行：
 * 先比可信度那一档、同档比相关度——和 rank.ts 的 `stronger` 同一个口径，
 * 否则这里留下的和那边选出来的不是同一条证据。打分层按事实累加月份，同段两行
 * 会把 12 个月数成 24；证据行也会把同一段列两遍。去重必须在 SQL 里做完再过
 * 上限：在内存里去重的话，三个词的宽主张会把 FACT_MAX 提前触发三倍。
 *
 * 主张自己的段谓词只作用在自己的行上（`q.claim_idx = i and …`）：「入职前在大厂
 * 做过增长」裁的是增长那一段，不裁同一查询里别的主张的段。
 */
function textualFacts(
	claims: readonly (readonly [number, Claim])[],
	admitted: Map<string, Admitted[]>,
	person: readonly SQL[],
): SQL | null {
	const table = admittedTable(
		claims.flatMap(([claimIdx, claim]) =>
			(claim.what ?? []).flatMap((value, valueIdx) =>
				(admitted.get(value) ?? []).map((hit) => ({ claimIdx, valueIdx, hit })),
			),
		),
	);
	if (!table) return null;
	const strength = sql`case ep.route ${sql.join(
		ROUTE_ORDER.map(
			(r) => sql`when ${r} then ${strengthRank(ROUTE_STRENGTH[r])}`,
		),
		sql` `,
	)} end`;
	const routeOrder = sql`case ep.route ${sql.join(
		ROUTE_ORDER.map((route, index) => sql`when ${route} then ${index}`),
		sql` `,
	)} end`;
	const own = sql.join(
		claims.map(([i, claim]) => {
			const conds = segmentConds(claim);
			return conds.length > 0
				? sql`(q.claim_idx = ${i} and ${sql.join(conds, sql` and `)})`
				: sql`q.claim_idx = ${i}`;
		}),
		sql` or `,
	);
	return sql`
		with q(claim_idx, value_idx, phrase_id, relevance) as ${table}
		select distinct on (q.claim_idx, e.id)
			q.claim_idx, q.value_idx, ep.route::text as route, q.relevance,
			case when ep.route in (${sql.join(
				EXTRACTED_ROUTES.map((r) => sql`${r}`),
				sql`, `,
			)}) then ph.text end as phrase,
			ep.involvement, ${FACT_ROW}
		from q
		join experience_phrase ep on ep.phrase_id = q.phrase_id
		join phrase ph on ph.id = ep.phrase_id
		join experience e on e.id = ep.experience_id
		join employee p on p.emp_id = e.emp_id
		${whereAll([sql`(${own})`, ...person])}
		order by q.claim_idx, e.id, ${strength}, q.relevance desc,
			q.value_idx, ${routeOrder}`;
}

/**
 * 没有经历词的主张（「待过字节」「只看入职前的经历」）：不比文本，落在范围里的
 * 每一段就是一条事实，相关度恒为 1、没有路。它和有词的主张走同一份打分与分面。
 */
function plainFacts(
	claims: readonly (readonly [number, Claim])[],
	person: readonly SQL[],
): SQL[] {
	return claims.map(
		([i, claim]) => sql`
		select ${i}::int as claim_idx, null::int as value_idx, null::text as route,
			1::float as relevance, null::text as phrase, null::text as involvement, ${FACT_ROW}
		from experience e join employee p on p.emp_id = e.emp_id
		${whereAll([...segmentConds(claim), ...person])}`,
	);
}

/** 全部主张的事实，一条 SQL。一条主张都没有事实可取时为 null。 */
function factsSql(
	claims: readonly Claim[],
	admitted: Map<string, Admitted[]>,
	person: readonly SQL[],
): SQL | null {
	const indexed = claims.map((claim, i) => [i, claim] as const);
	const textual = textualFacts(
		indexed.filter(([, claim]) => claim.what),
		admitted,
		person,
	);
	const parts = [
		...(textual ? [textual] : []),
		...plainFacts(
			indexed.filter(([, claim]) => !claim.what),
			person,
		),
	];
	if (parts.length === 0) return null;
	return sql.join(
		parts.map((part) => sql`(${part})`),
		sql` union all `,
	);
}

/**
 * 命中的经历事实。超过内存上限时返回真正贡献事实行的主张，不截断结果。
 *
 * 取数不带分面维度的筛选：分面要回答「去掉这一维之后还剩几人」，它需要看到
 * 被筛掉的那些行。筛选、AND、人员打分、排序与分面都在 rank.ts 对这份事实求值。
 * 只有按人裁的那些（人的必须条件、URL 上的公司名 / 学校名）在这里生效——它们没有分面。
 */
async function fetchFacts(
	store: DbExecutor,
	claims: readonly Claim[],
	admitted: Map<string, Admitted[]>,
	person: readonly SQL[],
): Promise<FactLoad> {
	const facts = factsSql(claims, admitted, person);
	if (!facts) return { kind: "loaded", facts: [] };
	const rows = await store.execute<FactRow>(sql`
		select * from (${facts}) facts
		limit ${FACT_MAX + 1}`);

	if (rows.rows.length > FACT_MAX) {
		const counts = await store.execute<{
			claim_idx: number;
			facts: number;
		}>(sql`
			select claim_idx, count(*)::int as facts
			from (${facts}) facts
			group by claim_idx`);
		return {
			kind: "overflow",
			claims: overflowContributors(
				counts.rows.map((r) => ({ claim: r.claim_idx, facts: r.facts })),
			),
		};
	}

	return {
		kind: "loaded",
		facts: rows.rows.map(
			({ emp_id, claim_idx, value_idx, end_date, ...dims }) => {
				const value =
					value_idx === null ? null : claims[claim_idx]?.what?.[value_idx];
				if (value === undefined)
					throw new Error(`取数返回了不存在的经历词 ${claim_idx}/${value_idx}`);
				return {
					...dims,
					empId: emp_id,
					claim: claim_idx,
					value,
					endDate: end_date,
				};
			},
		),
	};
}

/**
 * 被排除的主张否决的**经历段**。这些段丧失为任何主张作证的资格；人不被判决——
 * 没了这些段还有别的证据的人照常进结果，只有这些段的人过不了 AND，自然出局。
 * 排除因此和「从经历找人」是同一个语义，不是一套针对人的黑名单。
 *
 * 一条排除的主张同样是「一段经历同时满足这几项」：「不要入职前的实习」否决的是
 * 入职前而且是实习的段。没有经历词的排除（「不要入职前的经历」）否决落在范围里的
 * 每一段。时长在这里按单段判（`e.months`）：否决问的是「这一段是不是 X」，
 * 而累计是人的属性。
 *
 * **不带当前筛选。** 否决问的是「这一段是不是 X」，答案只能由这段经历自己决定。
 * 让筛选参与，「只看在职经历」就会让入职前那段实习重新有资格作证，
 * 于是收窄一个筛选反而放出更多本来站不住的证据。
 *
 * **门槛比正向条件高**（RELEVANCE_MIN_EXCLUDE）：正向条件可以放宽，排除词必须准。
 */
async function fetchVetoed(
	store: DbExecutor,
	excludes: readonly ExperienceCondition[],
	admitted: Map<string, Admitted[]>,
): Promise<Set<number>> {
	const parts = excludes.flatMap((claim, i) => {
		const conds = segmentConds(claim);
		if (claim.minMonths) conds.push(sql`e.months >= ${claim.minMonths}`);
		if (!claim.what)
			return [sql`select e.id from experience e ${whereAll(conds)}`];
		const table = admittedTable(
			claim.what.flatMap((value, valueIdx) =>
				(admitted.get(value) ?? [])
					.filter((hit) => hit.relevance >= RELEVANCE_MIN_EXCLUDE)
					.map((hit) => ({ claimIdx: i, valueIdx, hit })),
			),
		);
		if (!table) return [];
		return [
			sql`
			with q(claim_idx, value_idx, phrase_id, relevance) as ${table}
			select e.id from q
			join experience_phrase ep on ep.phrase_id = q.phrase_id
			join experience e on e.id = ep.experience_id
			${whereAll(conds)}`,
		];
	});
	if (parts.length === 0) return new Set();
	const rows = await store.execute<{ id: number }>(sql`
		select distinct id from (${sql.join(
			parts.map((part) => sql`(${part})`),
			sql` union all `,
		)}) vetoed`);
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
 * 模型只能从这里挑，不能凭常识造一个「一线大厂」或「P8」出来：造出来的值
 * 筛不到任何人，而界面上那一维会显示成一个选中了却空着的筛选。语料就是词典。
 *
 * 「哪些串不算这一维的取值」（空串、`NOT_A_VALUE`）不在这里判断，它是维度
 * 自己的声明：词表、内存判定、URL 清洗三处各写一份的话，模型能挑一个内存
 * 谓词当场否掉的值，而屏幕上是一个选中了却空着的筛选。
 *
 * 一维一条 SQL：四条小查询在同一次快照里跑完，换来的是每一维的取值原样成行，
 * 不必把四个数组拼进一行再逐维拆开。
 */
export async function vocabulary(): Promise<Vocabulary> {
	return withCorpusSnapshot(async (store) => {
		const vocab = {} as Vocabulary;
		for (const key of VOCAB_KEYS) {
			const column = FACT_COLUMNS[key];
			const rows = await store.execute<{ value: string }>(sql`
				select ${column} as value, count(*) as n
				from ${VOCAB_SOURCE[key]}
				where ${column} is not null and ${column} not in (${sql.join(
					["", ...NOT_A_VALUE].map((v) => sql`${v}`),
					sql`, `,
				)})
				group by 1 order by n desc, value limit ${VOCAB_MAX}`);
			vocab[key] = rows.rows.map((row) => row.value);
		}
		return vocab;
	});
}

/**
 * 没有经历主张、只有人的条件时，过了条件的人每段经历就是一条人口事实。它没有
 * route、相关度或证据段身份，不参与语义打分与证据展示；只用于人员筛选和分面计数。
 *
 * 排除的主张在这条路上同样否决证据段：一段被否决就不再算这个人的凭据，只有
 * 这一段的人自然出局。两条路径共用 `keepUnvetoed`——各写一份的话，「只写人的
 * 条件加一条排除」会安静地当排除不存在。
 */
async function searchPopulation(
	store: DbExecutor,
	spec: SearchSpec,
	q: Query,
	view: SearchFilters,
	limit: number,
	vetoed: Set<number>,
	person: readonly SQL[],
): Promise<SearchOutcome> {
	const rows = await store.execute<PopulationRow>(sql`
		select e.id, e.emp_id, ${factSelect}
		from experience e join employee p on p.emp_id = e.emp_id
		${whereAll(person)}
		order by e.id limit ${FACT_MAX + 1}`);
	if (rows.rows.length > FACT_MAX)
		return {
			order: "employee",
			claims: [],
			...noOne(),
			empty: emptyReason({
				spec,
				filters: view,
				total: 0,
				overflow: { kind: "overflowPopulation" },
			}),
		};
	const facts: PopulationFact[] = keepUnvetoed(rows.rows, vetoed).map(
		({ id: _id, emp_id, ...dims }) => ({ ...dims, empId: emp_id }),
	);
	// org / school 已经在 SQL 里按人裁过，内存里那一遍不必再裁一次
	const inMemory = { ...view, org: undefined, school: undefined };
	const empIdsAll = facts.map((f) => f.empId);
	const preferred = await Promise.all(
		q.prefer.map((c) => fetchPreferred(store, c, empIdsAll)),
	);
	const { empIds, facets, total } = rankPopulation(facts, inMemory, preferred);
	const pageIds = empIds.slice(0, limit);
	const employees =
		pageIds.length === 0
			? []
			: await store
					.select(RESULT_COLUMNS)
					.from(employee)
					.where(inArray(employee.empId, pageIds));
	const byId = new Map(employees.map((row) => [row.empId, row]));
	return {
		order: "employee",
		claims: [],
		results: pageIds.flatMap((empId) => {
			const person = byId.get(empId);
			return person ? [{ employee: person }] : [];
		}),
		facets,
		total,
		empty: emptyReason({
			spec,
			filters: view,
			total,
			overflow: null,
		}),
	};
}

/**
 * 一次检索的取数与排名。`limit` 与 `filters` 都当作**可信入参**：跨进程那一跳
 * 的收窄在 `server/functions.ts` 做完了（`sanitizeFilters` / `sanitizeLimit`），
 * 脚本传的是常量。同一件事收两遍的话，两份口径迟早不一样，而不一样的那一份
 * 不会报错。
 */
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
	const q = queryOf(spec.conditions);
	const { claims, excludes, must, prefer } = q;
	// 没有正向的主张也没有人的条件时，排除自己不产出候选人。只有偏好的查询
	// （「最好是硕士」）是「所有人，满足偏好的在前」，照跑。
	if (claims.length === 0 && must.length === 0 && prefer.length === 0)
		return {
			order: "evidence",
			claims,
			...noOne(),
			empty: emptyReason({
				spec,
				filters,
				total: 0,
				overflow: null,
			}),
		};
	// 人的必须条件和 URL 上的公司名 / 学校名都按人裁，在每一条取数 SQL 里生效
	const person = [...personConds(must), ...viewConds(filters)];

	// 准入（要打两个模型端点）在快照外算，取数在快照内做，见 phrases.ts。
	// 正向的和排除的经历词一起进准入：它们查的是同一批说法，判定线的差别在
	// fetchVetoed 里，不在这里。
	return withAdmission(
		[...claims, ...excludes].flatMap((c) => c.what ?? []),
		RELEVANCE_MIN,
		async (store, { admitted }) => {
			const vetoed = await fetchVetoed(store, excludes, admitted);
			// 只有人的条件时没有语义证据可言，不必伪造一条主张来启动检索。
			if (claims.length === 0)
				return searchPopulation(store, spec, q, filters, limit, vetoed, person);

			const loaded = await fetchFacts(store, claims, admitted, person);
			if (loaded.kind === "overflow") {
				const contributors = new Set(loaded.claims);
				return {
					order: "evidence",
					claims,
					...noOne(),
					empty: emptyReason({
						spec,
						filters,
						total: 0,
						overflow: {
							kind: "overflowEvidence",
							claims: claims.filter((_, index) => contributors.has(index)),
						},
					}),
				};
			}
			const facts = keepUnvetoed(loaded.facts, vetoed);
			const candidates = facts.map((f) => f.empId);
			const preferred = await Promise.all(
				prefer.map((c) => fetchPreferred(store, c, candidates)),
			);

			const { ranked, facets, total } = rank(
				facts,
				claims,
				filters,
				new Date(),
				preferred,
			);
			const empty = emptyReason({
				spec,
				filters,
				total,
				overflow: null,
			});
			const page = ranked.slice(0, limit);
			if (page.length === 0)
				return {
					order: "evidence",
					claims,
					results: [],
					facets,
					total,
					empty,
				};

			const empIds = page.map((row) => row.empId);
			const evidence = pageHits(
				facts,
				claims,
				filters,
				new Set(empIds),
				HITS_PER_CLAIM,
			);

			// 名次确定后按 id 读取展示原文；命中判定只产生事实，不承担内容读取。
			const ids = [
				...new Set([...evidence.values()].flat().map((fact) => fact.id)),
			];
			const segments = await store
				.select()
				.from(experience)
				.where(inArray(experience.id, ids));
			const employees = await store
				.select(RESULT_COLUMNS)
				.from(employee)
				.where(inArray(employee.empId, empIds));

			const segById = new Map(segments.map((segment) => [segment.id, segment]));
			const empById = new Map(
				employees.map((person) => [person.empId, person]),
			);

			// 名次已经定好，回表只是按 id 把要画的原文取回来：这一页就是取得回来的
			// 那些行，取数和定名次读的是同一次快照里的同一批 id。
			const results: RankedResult[] = page.flatMap((row) => {
				const person = empById.get(row.empId);
				if (!person) return [];
				const hits = (evidence.get(row.empId) ?? []).flatMap<Hit>((fact) => {
					const segment = segById.get(fact.id);
					if (!segment) return [];
					return [
						{
							experienceId: segment.id,
							claim: fact.claim,
							value: fact.value,
							route: fact.route,
							relevance: fact.relevance,
							phrase: fact.phrase,
							involvement: fact.involvement,
							startDate: segment.startDate,
							endDate: segment.endDate,
							org: segment.org,
							title: segment.title,
							seq: dots(segment.seqL1, segment.seqL2, segment.seqL3),
						},
					];
				});
				return [
					{
						employee: person,
						strength: row.strength,
						depth: row.depth,
						basis: row.basis,
						hits,
					},
				];
			});
			return {
				order: "evidence",
				claims,
				results,
				facets,
				total,
				empty,
			};
		},
	);
}
