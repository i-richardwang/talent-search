/**
 * 执行外壳：把一份查询（`query.ts`）变成事实，交给 rank.ts 打分、判定、排序、算分面。
 *
 * 模型写的只是每条条件的 `where`；FROM、输出列、去重、排除的先后、累计和打分都在这里，
 * 顺序固定：
 *
 * 1. 物化命中：全部语义词一起召回、重排（快照外调模型，见 phrases.ts），按词表修正后在检索
 *    事务里建临时表 `hit`。每条条件按自己的强度取门槛：正向 `RELEVANCE_MIN`，排除
 *    `RELEVANCE_MIN_EXCLUDE`。
 * 2. 排除先行：每条排除否决的段，在下面每一条语句里都不算证据、也不算背景。
 * 3. 每条必须与加分：经历主张产出事实行，同一条主张、同一段只留相关度乘投入系数最高的
 *    一行（和 rank.ts 的 `closer` 一致）；背景与人的条件按人过滤（必须）或记成一条偏好（加分）。
 * 4. 候选与名次：rank.ts 原样消费事实行与偏好集合。
 *
 * 第 2、3 步在只读角色下执行（`server/sandbox.ts`），只读得到数据目录和 `hit`。
 * 名单要显示的姓名和经历原文在回到应用角色后按 id 取。
 *
 * 一条经历主张的各项约束作用于同一段经历；累计时长由 rank.ts 跨段求值。背景与人的条件是门槛，
 * 不产生经历证据。
 */

import "@tanstack/react-start/server-only";
import { inArray, type SQL, sql } from "drizzle-orm";
import { EXTRACTED_ROUTES, employee, experience } from "#/db/schema";
import type { DbExecutor } from "#/db/snapshot";
import type { Engagement } from "#/lib/engagement";
import { dots } from "#/lib/format";
import { escapeLike } from "#/lib/sql";
import {
	compileWhere,
	restricted,
	sandboxProblem,
	shareTemp,
	type WhereScope,
} from "#/server/sandbox";
import type { DimSource } from "./dimensions";
import { emptyReason } from "./empty";
import type { SearchFilters } from "./params";
import { type PhraseHit, withMatchedPhrases } from "./phrases";
import {
	type Claim,
	type Gate,
	hasTerms,
	type Query,
	type QueryCondition,
	type Roles,
	rolesOf,
	termValues,
} from "./query";
import { type Fact, type PopulationFact, pageHits, rank } from "./rank";
import {
	emptyFacets,
	type Facets,
	type Hit,
	type RankedResult,
	type ResultEmployee,
	type SearchOutcome,
} from "./result";
import {
	ENGAGEMENT_FACTOR,
	FACT_MAX,
	HITS_PER_CLAIM,
	RELEVANCE_MIN,
	RELEVANCE_MIN_EXCLUDE,
	RESULT_PAGE,
	type Route,
} from "./weights";

/** 一条条件在外壳语句里的样子：校验过的 `where` 片段。 */
type Compiled = { condition: QueryCondition; where: SQL };

/** 执行查询时条件不合规：记录是校验过才写进去的，走到这里是数据或代码的问题。 */
class InvalidQueryError extends Error {
	override name = "InvalidQueryError";
}

export function scopeOf(c: QueryCondition): WhereScope {
	return c.from === "person"
		? { from: "person" }
		: { from: "experience", terms: hasTerms(c) };
}

/** 条件的 `where` 经解析白名单编成 SQL 片段；不合规的给出原因。 */
async function compiledOf(
	c: QueryCondition,
): Promise<{ ok: true; compiled: Compiled } | { ok: false; problem: string }> {
	const result = await compileWhere(c.where, c.params ?? {}, scopeOf(c));
	return result.ok
		? { ok: true, compiled: { condition: c, where: result.sql } }
		: result;
}

/** 执行用：不合规的抛出，带上是哪一条、为什么。 */
async function compiled(c: QueryCondition): Promise<Compiled> {
	const result = await compiledOf(c);
	if (!result.ok)
		throw new InvalidQueryError(
			`条件「${c.label}」不能执行：${result.problem}`,
		);
	return result.compiled;
}

/** 新建没有候选人的结果字段；分面集合不共享可变状态。 */
function noOne(): { results: []; facets: Facets; total: number } {
	return { results: [], facets: emptyFacets(), total: 0 };
}

/** 名单的展示投影。 */
const RESULT_COLUMNS = {
	empId: employee.empId,
	name: employee.name,
	curDept: employee.curDept,
	curTitle: employee.curTitle,
	curLevel: employee.curLevel,
} satisfies Record<keyof ResultEmployee, unknown>;

/**
 * 从各主张的事实行数里找出造成超载的主要贡献者。
 *
 * 按贡献从大到小挑，直到剩余事实能进上限；同样行数按查询顺序稳定并列。
 * 返回时再恢复查询顺序，让界面上列出的顺序和 chips 一致。
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
 * 分面与筛选共用的事实列，别名对应 DimSource，全部读目录视图：段是 `e`，人是 `p`。
 * 外连接没有经历时经历属性为空、能力词为空数组；人员属性始终从 `p` 读取。
 */
const FACT_COLUMNS: Record<keyof DimSource, SQL> = {
	months: sql`e.months`,
	seqL1: sql`e.seq_l1`,
	seqL2: sql`e.seq_l2`,
	kind: sql`e.kind`,
	companyTag: sql`e.company_tag`,
	skills: sql`coalesce(e.skills, '{}')`,
	level: sql`coalesce(p.level_band, '')`,
	levelRank: sql`p.level_rank`,
	recruitment: sql`coalesce(p.recruitment, '')`,
	education: sql`coalesce(p.education, '')`,
	educationRank: sql`p.education_rank`,
	schoolTier: sql`coalesce(p.school_tier, '')`,
	overseas: sql`p.overseas`,
};

const factSelect = sql.join(
	Object.entries(FACT_COLUMNS).map(
		(entry) => sql`${entry[1]} as "${sql.raw(entry[0])}"`,
	),
	sql`, `,
);

function whereAll(conds: readonly SQL[]): SQL {
	return conds.length > 0
		? sql`where ${sql.join([...conds], sql` and `)}`
		: sql``;
}

/**
 * 物化命中：每条带语义词的条件，按它的强度取门槛，命中的说法经边落到段上。
 * `cond` 是条件在查询里的下标，`value_idx` 是命中的词在这条的 `termValues` 里的下标；
 * 两列和 `phrase_id` 只给外壳排序与去重用，模型写的 `where` 读不到（`catalog.ts` 的 `HIT`）。
 */
async function materializeHits(
	store: DbExecutor,
	conditions: readonly QueryCondition[],
	phraseHits: Map<string, PhraseHit[]>,
): Promise<void> {
	const rows: {
		cond: number;
		term: string;
		value: string;
		valueIdx: number;
		hit: PhraseHit;
	}[] = [];
	for (const [cond, c] of conditions.entries()) {
		if (!hasTerms(c)) continue;
		const min = c.mode === "exclude" ? RELEVANCE_MIN_EXCLUDE : RELEVANCE_MIN;
		let valueIdx = 0;
		for (const [term, values] of Object.entries(c.terms))
			for (const value of values) {
				for (const hit of phraseHits.get(value) ?? [])
					if (hit.relevance >= min)
						rows.push({ cond, term, value, valueIdx, hit });
				valueIdx++;
			}
	}
	await store.execute(sql`
		create temp table hit on commit drop as
		select q.cond, q.term, q.value, q.value_idx, e.id as experience_id, e.emp_id,
			ep.route::text as route, q.relevance,
			case when ep.route in (${sql.join(
				EXTRACTED_ROUTES.map((r) => sql`${r}`),
				sql`, `,
			)}) then ph.text end as phrase,
			ep.phrase_id, ep.engagement::text as engagement
		from unnest(
			${sql.param(rows.map((r) => r.cond))}::int[],
			${sql.param(rows.map((r) => r.term))}::text[],
			${sql.param(rows.map((r) => r.value))}::text[],
			${sql.param(rows.map((r) => r.valueIdx))}::int[],
			${sql.param(rows.map((r) => r.hit.phraseId))}::int[],
			${sql.param(rows.map((r) => r.hit.relevance))}::double precision[]
		) as q(cond, term, value, value_idx, phrase_id, relevance)
		join experience_phrase ep on ep.phrase_id = q.phrase_id
		join phrase ph on ph.id = ep.phrase_id
		join experience e on e.id = ep.experience_id
		where not e.unemployed`);
	await shareTemp(store, "hit");
}

/** 这条条件读到的段：带语义词的接上它自己的那几行命中。 */
function segmentsOf(c: Compiled, index: number): SQL {
	return hasTerms(c.condition)
		? sql`experience e join hit h on h.experience_id = e.id and h.cond = ${index}`
		: sql`experience e`;
}

/**
 * 外壳在只读角色下拼出的语句。下标都指向 `query.conditions`，`veto` 是被排除否决的段。
 */
class Shell {
	readonly veto: SQL | null;

	constructor(
		private readonly all: readonly (Compiled | null)[],
		excludes: readonly number[],
	) {
		const parts = excludes.map((i) => {
			const c = this.at(i);
			return sql`select e.id from ${segmentsOf(c, i)} where ${c.where}`;
		});
		this.veto =
			parts.length > 0
				? sql`select id from (${sql.join(
						parts.map((p) => sql`(${p})`),
						sql` union all `,
					)}) vetoed`
				: null;
	}

	at(i: number): Compiled {
		const c = this.all[i];
		if (!c) throw new Error(`第 ${i} 条条件没有编译`);
		return c;
	}

	notVetoed(): SQL[] {
		return this.veto ? [sql`e.id not in (${this.veto})`] : [];
	}

	/**
	 * 一条门槛在人 `p` 上的谓词。人的条件就是它的 `where`；背景是这个人有合格的段，
	 * 写了累计时长就把合格段的月数加起来比。被否决的段不算背景的证据。
	 */
	gate(i: number): SQL {
		const c = this.at(i);
		if (c.condition.from === "person") return c.where;
		const where = whereAll([
			sql`e.emp_id = p.emp_id`,
			c.where,
			...this.notVetoed(),
		]);
		return c.condition.minMonths
			? sql`(select coalesce(sum(e.months), 0) from experience e ${where}) >= ${c.condition.minMonths}`
			: sql`exists (select 1 from experience e ${where})`;
	}

	/**
	 * URL 上的公司、部门和学校筛选：按名字包含，在 SQL 里按人过滤；公司和部门要求有未被
	 * 否决的工作经历，学校只读员工档案。它们不是条件，不写进查询。
	 */
	view(filters: Pick<SearchFilters, "company" | "department" | "school">) {
		const like = (names: readonly string[], columns: SQL[]) =>
			sql`(${sql.join(
				names.flatMap((name) =>
					columns.map(
						(column) => sql`${column} ilike ${`%${escapeLike(name)}%`}`,
					),
				),
				sql` or `,
			)})`;
		const segment = (names: readonly string[], columns: SQL[]) =>
			sql`exists (select 1 from experience e ${whereAll([
				sql`e.emp_id = p.emp_id`,
				like(names, columns),
				...this.notVetoed(),
			])})`;
		const out: SQL[] = [];
		if (filters.company?.length)
			out.push(segment(filters.company, [sql`e.company`]));
		if (filters.department?.length)
			out.push(
				segment(filters.department, [
					sql`e.department`,
					sql`e.department_path`,
				]),
			);
		if (filters.school?.length) out.push(like(filters.school, [sql`p.school`]));
		return out;
	}

	/**
	 * 一条经历主张的事实：同一段只留最对得上的那一行命中——相关度乘投入系数最高，同强度
	 * 再比原始相关度，与 rank.ts 的 `closer` 一致。去重在 SQL 里做完再比上限，证据也不重复列段。
	 */
	facts(i: number, person: readonly SQL[]): SQL {
		const c = this.at(i);
		const strength = sql`h.relevance * case when h.route = 'skill' then
			case h.engagement ${sql.join(
				Object.entries(ENGAGEMENT_FACTOR).map(
					([engagement, factor]) =>
						sql`when ${engagement} then ${factor}::double precision`,
				),
				sql` `,
			)} else ${ENGAGEMENT_FACTOR.做过}::double precision end
			else 1 end`;
		return sql`
			select distinct on (e.id) ${i}::int as claim_idx, h.value_idx, h.route,
				h.relevance, h.phrase, h.engagement, e.id, e.emp_id,
				to_char(e.end_date, 'YYYY-MM-DD') as end_date, ${factSelect}
			from ${segmentsOf(c, i)}
			join person p on p.emp_id = e.emp_id
			${whereAll([c.where, ...this.notVetoed(), ...person])}
			order by e.id, ${strength} desc, h.relevance desc, h.value_idx, h.route,
				h.phrase_id`;
	}
}

type FactRow = {
	claim_idx: number;
	value_idx: number;
	id: number;
	route: Route;
	relevance: number;
	phrase: string | null;
	engagement: Engagement | null;
	emp_id: string;
	end_date: string | null;
} & Pick<Fact, keyof DimSource>;

type FactLoad =
	| { kind: "loaded"; facts: Fact[] }
	| { kind: "overflow"; claims: number[] };

/**
 * 命中的经历事实。超过内存上限时返回贡献事实行的主张，不截断结果。
 *
 * 取数不带分面维度的筛选：分面要回答「去掉这一维之后还剩几人」，它需要看到被筛掉的那些行。
 * 只有按人过滤的那些（必须的门槛、URL 上的公司名 / 学校名）在这里生效——它们没有分面。
 */
async function fetchFacts(
	store: DbExecutor,
	shell: Shell,
	claims: readonly { index: number; claim: Claim }[],
	person: readonly SQL[],
): Promise<FactLoad> {
	if (claims.length === 0) return { kind: "loaded", facts: [] };
	const facts = sql.join(
		claims.map(({ index }) => sql`(${shell.facts(index, person)})`),
		sql` union all `,
	);
	const rows = await store.execute<FactRow>(sql`
		select * from (${facts}) facts limit ${FACT_MAX + 1}`);
	const position = new Map(claims.map(({ index }, at) => [index, at]));
	if (rows.rows.length > FACT_MAX) {
		const counts = await store.execute<{
			claim_idx: number;
			facts: number;
		}>(sql`
			select claim_idx, count(*)::int as facts from (${facts}) facts
			group by claim_idx`);
		return {
			kind: "overflow",
			claims: overflowContributors(
				counts.rows.map((r) => ({
					claim: position.get(r.claim_idx) as number,
					facts: r.facts,
				})),
			),
		};
	}
	return {
		kind: "loaded",
		facts: rows.rows.map(
			({ emp_id, claim_idx, value_idx, end_date, ...dims }) => {
				const at = position.get(claim_idx);
				const claim = at === undefined ? undefined : claims[at]?.claim;
				const value = claim && termValues(claim)[value_idx];
				if (at === undefined || value === undefined)
					throw new Error(`取数返回了不存在的经历词 ${claim_idx}/${value_idx}`);
				return { ...dims, empId: emp_id, claim: at, value, endDate: end_date };
			},
		),
	};
}

type PopulationRow = { emp_id: string } & DimSource;

/** 人员候选及其有效工作经历；无经历时仍保留人员属性。 */
async function fetchPopulation(
	store: DbExecutor,
	shell: Shell,
	person: readonly SQL[],
): Promise<PopulationFact[] | null> {
	const rows = await store.execute<PopulationRow>(sql`
		select p.emp_id, ${factSelect}
		from person p left join experience e on e.emp_id = p.emp_id
		${shell.veto ? sql`and e.id not in (${shell.veto})` : sql``}
		${whereAll(person)}
		order by p.emp_id, e.id limit ${FACT_MAX + 1}`);
	if (rows.rows.length > FACT_MAX) return null;
	return rows.rows.map(({ emp_id, ...dims }) => ({ ...dims, empId: emp_id }));
}

/**
 * 当前候选里分别满足每条加分门槛的人，一条 SQL 读完。候选集合使用单个数组参数，
 * 参数数量不随候选人数增长。
 */
async function fetchPreferred(
	store: DbExecutor,
	shell: Shell,
	prefer: readonly number[],
	empIds: Iterable<string>,
): Promise<Set<string>[]> {
	const sets = prefer.map(() => new Set<string>());
	const ids = [...new Set(empIds)];
	if (prefer.length === 0 || ids.length === 0) return sets;
	const met = prefer.map((i) => sql`coalesce(${shell.gate(i)}, false)`);
	const rows = await store.execute<{ emp_id: string; met: boolean[] }>(sql`
		select p.emp_id, array[${sql.join(met, sql`, `)}] as met from person p
		where p.emp_id = any(${sql.param(ids)}::text[])`);
	for (const row of rows.rows)
		row.met.forEach((yes, i) => {
			if (yes) sets[i]?.add(row.emp_id);
		});
	return sets;
}

/**
 * 在同一语料快照中完成取数、排序与分面。查询已经校验过；filters 只描述这一次怎样查看结果。
 */
export async function execute(
	query: Query,
	filters: SearchFilters = {},
	/** 本次返回前多少人；每次翻页重新取得同一快照内排名的完整前缀。 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	const roles = rolesOf(query);
	const { claims, gates, prefer, excludes } = roles;
	// 没有正向的主张也没有门槛时，排除自己不产出候选人。只有偏好的查询
	// （「最好是硕士」）是「所有人，满足偏好的在前」，照跑。
	if (claims.length === 0 && gates.length === 0 && prefer.length === 0)
		return {
			order: "evidence",
			claims,
			...noOne(),
			empty: emptyReason({ query, filters, total: 0, overflow: null }),
		};
	const index = new Map(query.conditions.map((c, i) => [c, i]));
	const at = (c: QueryCondition) => index.get(c) as number;
	const all = await Promise.all(
		query.conditions.map((c) => (c.off ? null : compiled(c))),
	);
	// 正向的和排除的语义词一起召回重排：它们查的是同一批说法，门槛的差别在物化命中时分开
	return withMatchedPhrases(
		[...claims, ...excludes].flatMap(termValues),
		RELEVANCE_MIN,
		async (store, { phraseHits }) => {
			await materializeHits(store, query.conditions, phraseHits);
			const shell = new Shell(all, excludes.map(at));
			const read = await restricted(store, () =>
				evaluate(store, shell, roles, at, filters),
			);
			if (read.kind !== "ranked") return read.outcome;
			return present(store, read, claims, filters, limit, query);
		},
	);
}

type Evaluated =
	| { kind: "done"; outcome: SearchOutcome }
	| {
			kind: "ranked";
			facts: Fact[];
			ranked: ReturnType<typeof rank>;
	  };

/** 只读角色下的那一半：排除、门槛、事实、人群、偏好，然后交给 rank.ts。 */
async function evaluate(
	store: DbExecutor,
	shell: Shell,
	{ claims, gates, prefer }: Roles,
	at: (c: QueryCondition) => number,
	filters: SearchFilters,
): Promise<Evaluated> {
	// 门槛和 URL 上的公司名 / 学校名都按人过滤，在每一条取数 SQL 里生效
	const person = [
		...gates.map((g: Gate) => shell.gate(at(g))),
		...shell.view(filters),
	];
	const loaded = await fetchFacts(
		store,
		shell,
		claims.map((claim) => ({ index: at(claim), claim })),
		person,
	);
	if (loaded.kind === "overflow") {
		const contributors = new Set(loaded.claims);
		return {
			kind: "done",
			outcome: {
				order: "evidence",
				claims,
				...noOne(),
				empty: {
					kind: "overflowEvidence",
					claims: claims.filter((_, i) => contributors.has(i)),
				},
			},
		};
	}
	const facts = loaded.facts;
	// 必须经历限定候选；没有必须经历时，偏好只排序，候选来自人员。
	const population = claims.some((claim) => claim.mode === "must")
		? facts
		: await fetchPopulation(store, shell, person);
	if (population === null)
		return {
			kind: "done",
			outcome: {
				...(claims.length
					? { order: "evidence" as const, claims }
					: { order: "employee" as const, claims: [] as [] }),
				...noOne(),
				empty: { kind: "overflowPopulation" },
			},
		};
	const preferred = await fetchPreferred(
		store,
		shell,
		prefer.map(at),
		population.map((f) => f.empId),
	);
	return {
		kind: "ranked",
		facts,
		ranked: rank(facts, population, claims, filters, new Date(), preferred),
	};
}

/** 回到应用角色：名次已经定好，按 id 取名单这一页要显示的姓名和经历原文。 */
async function present(
	store: DbExecutor,
	{
		facts,
		ranked: { ranked, facets, total },
	}: Extract<Evaluated, { kind: "ranked" }>,
	claims: Claim[],
	filters: SearchFilters,
	limit: number,
	query: Query,
): Promise<SearchOutcome> {
	const empty = emptyReason({ query, filters, total, overflow: null });
	const page = ranked.slice(0, limit);
	const empIds = page.map((row) => row.empId);
	const employees =
		empIds.length === 0
			? []
			: await store
					.select(RESULT_COLUMNS)
					.from(employee)
					.where(inArray(employee.empId, empIds));
	const empById = new Map(employees.map((person) => [person.empId, person]));
	if (claims.length === 0)
		return {
			order: "employee",
			claims: [],
			facets,
			total,
			empty,
			results: page.flatMap((row) => {
				const person = empById.get(row.empId);
				return person ? [{ employee: person }] : [];
			}),
		};
	if (page.length === 0)
		return { order: "evidence", claims, results: [], facets, total, empty };

	const evidence = pageHits(
		facts,
		claims,
		filters,
		new Set(empIds),
		HITS_PER_CLAIM,
	);
	const ids = [
		...new Set([...evidence.values()].flat().map((fact) => fact.id)),
	];
	const segments = await store
		.select()
		.from(experience)
		.where(inArray(experience.id, ids));
	const segById = new Map(segments.map((segment) => [segment.id, segment]));
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
					engagement: fact.engagement,
					startDate: segment.startDate,
					endDate: segment.endDate,
					company: segment.company,
					department: segment.department,
					title: segment.title,
					seq: dots(segment.seqL1, segment.seqL2, segment.seqL3),
				},
			];
		});
		return [{ employee: person, depth: row.depth, basis: row.basis, hits }];
	});
	return { order: "evidence", claims, results, facets, total, empty };
}

/** 一条条件单独试跑的结果：满足它的有多少人，或者它为什么跑不了。停用的不跑。 */
export type ConditionProbe = {
	id: string;
	people: number | null;
	problem: string | null;
};

export type ProbeResult = {
	conditions: ConditionProbe[];
	/** 整份查询搜出多少人；有条件跑不了、或事实超过内存上限时为 null */
	total: number | null;
	/** 事实超过内存上限：哪几条太宽 */
	overflow: string[];
};

/**
 * 试跑一份查询：每条条件单独数人，再整份跑一遍数总人数。只给人数，不给人。
 *
 * 单条的人数和执行同一套规则：经历条件只算没被排除否决的段，写了累计时长的按去重后的段
 * 累计；排除数的是它否决了多少人的段；人的条件数满足它的人。每条在自己的保存点里跑，
 * 一条报错不影响别的条；数据库的错误脱敏后作为这一条的问题（`sandboxProblem`）。
 */
export async function probe(query: Query): Promise<ProbeResult> {
	const roles = rolesOf(query);
	const index = new Map(query.conditions.map((c, i) => [c, i]));
	const at = (c: QueryCondition) => index.get(c) as number;
	const checked = await Promise.all(
		query.conditions.map((c) => (c.off ? null : compiledOf(c))),
	);
	const all = checked.map((r) => (r?.ok ? r.compiled : null));
	const results: ConditionProbe[] = query.conditions.map((c, i) => {
		const r = checked[i];
		return { id: c.id, people: null, problem: r && !r.ok ? r.problem : null };
	});
	const valid = (c: QueryCondition) => all[at(c)] !== null;
	return withMatchedPhrases(
		[...roles.claims, ...roles.excludes].filter(valid).flatMap(termValues),
		RELEVANCE_MIN,
		async (store, { phraseHits }) => {
			await materializeHits(store, query.conditions, phraseHits);
			const shell = new Shell(all, roles.excludes.filter(valid).map(at));
			for (const i of query.conditions.keys()) {
				const one = all[i];
				const result = results[i];
				if (!one || !result) continue;
				try {
					result.people = await restricted(store, async () => {
						const rows = await store.execute<{ n: number }>(
							countOf(shell, one, i),
						);
						return rows.rows[0]?.n ?? 0;
					});
				} catch (error) {
					const problem = sandboxProblem(error);
					if (problem === null) throw error;
					result.problem = problem;
				}
			}
			const runnable =
				results.every((r) => r.problem === null) &&
				roles.claims.length + roles.gates.length + roles.prefer.length > 0;
			if (!runnable) return { conditions: results, total: null, overflow: [] };
			const read = await restricted(store, () =>
				evaluate(store, shell, roles, at, {}),
			);
			if (read.kind === "ranked")
				return { conditions: results, total: read.ranked.total, overflow: [] };
			const empty = read.outcome.empty;
			return {
				conditions: results,
				total: null,
				overflow:
					empty?.kind === "overflowEvidence"
						? empty.claims.map((c) => c.id)
						: [],
			};
		},
	);
}

/** 单条条件的人数语句；规则见 `probe`。 */
function countOf(shell: Shell, one: Compiled, i: number): SQL {
	const c = one.condition;
	if (c.from === "person")
		return sql`select count(*)::int as n from person p where ${one.where}`;
	const veto = c.mode === "exclude" ? [] : shell.notVetoed();
	const segments = sql`select distinct e.emp_id, e.id, e.months
		from ${segmentsOf(one, i)} ${whereAll([one.where, ...veto])}`;
	return c.minMonths
		? sql`select count(*)::int as n from (
				select emp_id from (${segments}) s group by emp_id
				having sum(months) >= ${c.minMonths}) qualified`
		: sql`select count(distinct emp_id)::int as n from (${segments}) s`;
}
