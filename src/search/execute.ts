/**
 * 执行外壳：把一份查询（`query.ts`）变成事实，交给 rank.ts 打分、判定、排序、算分面。
 *
 * 模型写的只是每条条件的 `where`；FROM、输出列、去重、累计和打分都在这里。每条条件各读各的
 * 原始数据，谁也不改别的条件读到什么，所以先算哪条结果都一样：
 *
 * 1. 物化命中：每条「做过什么」按字面对得上的段是它的候选段，在检索事务里建成临时表 `hit`——
 *    写了正则的按字面捞说法（phrases.ts）、经边落到段上，没写正则的是全部的段，哪些在范围里由
 *    它的 `where` 定。写了判据的条件，候选段算不算是读过那一段之后的结论（`verdict.ts`、
 *    `server/judged.ts`）：判成不算的不进 `hit`；还没确认过的留在 `hit` 里，是候选，不是证据。
 *    没写判据的都算。命中说的就是 `hit` 里的行，证据只是其中算数的那些。
 * 2. 每条条件在一个人身上成不成立：经历主张产出事实行，同一条主张、同一段只留投入最深的一行；
 *    背景与人的条件按人过滤（必须）或记成一条偏好（加分）；排除是这个人没有任何一段算数的命中。
 * 3. 名单与候选：一段在一条判据下只有三种状态——算、不算、还没确认，人也就三种：每条必须和
 *    排除都确定成立的在名单上；有一条确定不成立的出局；其余是候选，查询理解接下来读的就是他们
 *    还没确认的段，从职级高的人读起。条件互不影响，所以「没确认过的段都按对这个人有利的算
 *    （主张上的算数，排除上的不算）」找出的正好是名单上的人加候选。候选人没确认完时名单还不
 *    完整，结果上写明已经完整确认到哪一档职级（`Incomplete`）。
 *
 * 第 2 步在只读角色下执行（`server/sandbox.ts`），只读得到数据目录和 `hit`。
 * 名单要显示的姓名和经历原文在回到应用角色后按 id 取。
 *
 * 一条经历主张的各项约束作用于同一段经历；累计时长由 rank.ts 跨段求值。背景、排除与人的条件
 * 是门槛，不产生经历证据。
 */

import "@tanstack/react-start/server-only";
import { inArray, type SQL, sql } from "drizzle-orm";
import { experience, personCard } from "#/db/schema";
import { chainScope, type DbExecutor } from "#/db/snapshot";
import type { Engagement } from "#/lib/engagement";
import { dots } from "#/lib/format";
import { escapeLike } from "#/lib/sql";
import {
	compileWhere,
	restricted,
	sandboxProblem,
	shareTemp,
} from "#/server/sandbox";
import type { DimSource } from "./dimensions";
import {
	type EmptyReason,
	emptyReason,
	type Incomplete,
	inactiveReason,
	type Overflow,
} from "./empty";
import type { SearchFilters } from "./params";
import { type MatchedPhrases, withMatchedPhrases } from "./phrases";
import {
	type Claim,
	type Exclusion,
	type Query,
	type QueryCondition,
	type Roles,
	rolesOf,
	seeks,
} from "./query";
import {
	engagementWeight,
	type Fact,
	order,
	type PopulationFact,
	pageEvidence,
	type Ranked,
	rank,
} from "./rank";
import {
	type Evidence,
	emptyFacets,
	type Facets,
	type RankedResult,
	type ResultPerson,
	type SearchOutcome,
} from "./result";
import { criterionKey, SEGMENT_CONTENT } from "./verdict";
import {
	ENGAGEMENT_FACTOR,
	FACT_MAX,
	RESULT_PAGE,
	type Route,
} from "./weights";

/** 一条条件在外壳语句里的样子：校验过的 `where` 片段。 */
type Compiled = { condition: QueryCondition; where: SQL };

/** 执行查询时条件不合规：记录是校验过才写进去的，走到这里是数据或代码的问题。 */
class InvalidQueryError extends Error {
	override name = "InvalidQueryError";
}

/** 一条条件的 `where` 经解析白名单编成 SQL 片段，按它的 FROM 核对能读的关系；不合规的给出原因。 */
export function compileCondition(c: QueryCondition) {
	return compileWhere(
		c.where,
		c.params ?? {},
		c.from === "person"
			? { from: "person" }
			: { from: "experience", seeks: seeks(c) },
	);
}

async function compiledOf(
	c: QueryCondition,
): Promise<{ ok: true; compiled: Compiled } | { ok: false; problem: string }> {
	const result = await compileCondition(c);
	return result.ok
		? { ok: true, compiled: { condition: c, where: result.sql } }
		: result;
}

/**
 * 这几列里任一列含这几个名字里任一个。名字是专有名词，按包含匹配，和 `compile.ts` 编出的谓词
 * 同一种写法。
 */
export function anyLike(
	names: readonly string[],
	columns: readonly SQL[],
): SQL {
	return sql`(${sql.join(
		names.flatMap((name) =>
			columns.map((column) => sql`${column} ilike ${`%${escapeLike(name)}%`}`),
		),
		sql` or `,
	)})`;
}

/** 一段经历 `e` 在哪的名字含其中一个：外部按公司名，公司内按末级部门名或部门路径。 */
export function placeLike(
	field: "company" | "department",
	names: readonly string[],
): SQL {
	return anyLike(
		names,
		field === "company"
			? [sql`e.company`]
			: [sql`e.department`, sql`e.department_path`],
	);
}

/** 新建没有候选人的结果字段；分面集合不共享可变状态。 */
function noOne(): { results: []; facets: Facets; total: number } {
	return { results: [], facets: emptyFacets(), total: 0 };
}

/** 名单的展示投影。 */
const RESULT_COLUMNS = {
	personId: personCard.personId,
	empId: personCard.empId,
	accessKey: personCard.accessKey,
	talentType: personCard.talentType,
	recentCompany: personCard.recentCompany,
	recentTitle: personCard.recentTitle,
	name: personCard.name,
	curDept: personCard.curDept,
	curTitle: personCard.curTitle,
	curLevel: personCard.curLevel,
} satisfies Record<keyof ResultPerson, unknown>;

/**
 * 从各主张的事实行数里找出造成超载的主要贡献者。
 *
 * 按贡献从大到小挑，直到剩余事实能进上限；同样行数按查询顺序稳定并列。
 * 返回时再恢复查询顺序，让界面上列出的顺序和 chips 一致。
 */
export function overflowContributors(
	counts: readonly { claim: number; facts: number }[],
	limit: number,
): number[] {
	let remaining = counts.reduce((sum, c) => sum + c.facts, 0);
	if (remaining <= limit) return [];
	const selected: number[] = [];
	for (const count of counts.toSorted(
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
	talentType: sql`p.talent_type`,
	pools: sql`p.pools`,
	months: sql`e.months`,
	seqL1: sql`e.seq_l1`,
	seqL2: sql`e.seq_l2`,
	kind: sql`e.kind`,
	companyTag: sql`e.company_tag`,
	mainIndustries: sql`coalesce(e.main_industries, '{}')`,
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
 * 物化命中：每条写了「做过什么」的条件的候选段。写了正则的是捞到的说法经边落到的段；没写正则
 * 的是全部的段，各按它登记的那条说法（公司内的任职、外部的岗位名）记一行。`fits` 是这一段
 * 算不算：写了判据的接上查询理解在这次找人任务里（`rootTurnId`）对这一段的结论，还没确认过的
 * 为空，判成不算的不进表；不属于任何一次任务的查询没有结论。没写判据的都算。`cond` 是条件在
 * 查询里的下标，它和 `fits`、`phrase_id` 只给外壳用，模型写的 `where` 读不到（`catalog.ts` 的
 * `HIT`）。`phrase` 只有技能这类说法有：别的说法的文字就在段上，证据行从段上取。
 */
async function materializeHits(
	store: DbExecutor,
	conditions: readonly QueryCondition[],
	matched: ReadonlyMap<number, MatchedPhrases>,
	rootTurnId: string | null,
): Promise<void> {
	const edges: { cond: number; phraseId: number }[] = [];
	const whole: number[] = [];
	const criteria: { cond: number; key: string | null }[] = [];
	for (const [cond, phrases] of matched) {
		const seek = conditions[cond]?.seek;
		if (!seek || !("phraseIds" in phrases)) continue;
		criteria.push({
			cond,
			key: seek.criterion ? criterionKey(seek.criterion) : null,
		});
		if (seek.patterns.length === 0) whole.push(cond);
		for (const phraseId of phrases.phraseIds) edges.push({ cond, phraseId });
	}
	await store.execute(sql`
		create temp table hit on commit drop as
		with caught as (
			select q.cond, ep.experience_id, ep.route::text as route,
				case when ep.route = 'skill' then ph.text end as phrase,
				ep.phrase_id, ep.engagement::text as engagement
			from unnest(
				${sql.param(edges.map((r) => r.cond))}::int[],
				${sql.param(edges.map((r) => r.phraseId))}::int[]
			) as q(cond, phrase_id)
			join experience_phrase ep on ep.phrase_id = q.phrase_id
			join phrase ph on ph.id = ep.phrase_id
			union all
			select w.cond, e.id,
				case e.kind when 'internal' then 'role' else 'title' end,
				null::text, null::int, null::text
			from unnest(${sql.param(whole)}::int[]) as w(cond)
			cross join experience e
		)
		select k.cond, e.id as experience_id, e.person_id, k.route,
			case when c.criterion_key is null then true else v.fits end as fits,
			v.match_score, k.phrase, k.phrase_id, k.engagement
		from caught k
		join unnest(
			${sql.param(criteria.map((c) => c.cond))}::int[],
			${sql.param(criteria.map((c) => c.key))}::text[]
		) as c(cond, criterion_key) on c.cond = k.cond
		join experience e on e.id = k.experience_id
		left join experience_verdict v
			on v.root_turn_id = ${rootTurnId}::text
			and v.criterion_key = c.criterion_key and v.content = ${SEGMENT_CONTENT}
		where not e.unemployed and v.fits is distinct from false`);
	await shareTemp(store, "hit");
}

/** 这条条件读到的段：写了「做过什么」的只读它自己的候选段（`hit` 里它那几行）。 */
function segmentsOf(c: Compiled, index: number): SQL {
	return seeks(c.condition)
		? sql`experience e join hit h on h.experience_id = e.id and h.cond = ${index}`
		: sql`experience e`;
}

/** 候选段里算数的，也就是证据：确认过算的，和没写判据的条件捞到的。 */
const COUNTED = sql`h.fits`;

/** 候选段里还没确认过的。 */
const UNCONFIRMED = sql`h.fits is null`;

/** 外壳在只读角色下拼出的语句。下标都指向 `query.conditions`。 */
class Shell {
	private readonly index: Map<QueryCondition, number>;
	private readonly all: readonly (Compiled | null)[];

	constructor(query: Query, all: readonly (Compiled | null)[]) {
		this.index = new Map(query.conditions.map((c, i) => [c, i]));
		this.all = all;
	}

	/** 一条条件在 `query.conditions` 里的下标。 */
	at(c: QueryCondition): number {
		return this.index.get(c) as number;
	}

	compiled(i: number): Compiled {
		const c = this.all[i];
		if (!c) throw new Error(`第 ${i} 条条件没有编译`);
		return c;
	}

	/**
	 * 一条门槛在人 `p` 上的谓词。人的条件就是它的 `where`；背景是这个人有合格的段，
	 * 写了累计时长就把合格段的月数加起来比；排除是这个人没有任何一段算数的命中——还没确认过的
	 * 段不算数，它拦不拦得住这个人要确认过才知道（`unconfirmed`）。
	 */
	gate(i: number): SQL {
		const c = this.compiled(i);
		const { condition } = c;
		if (condition.from === "person") return c.where;
		const own = sql`e.person_id = p.person_id`;
		if (condition.mode === "exclude")
			return sql`not exists (select 1 from ${segmentsOf(c, i)} ${whereAll([
				own,
				c.where,
				...(seeks(condition) ? [COUNTED] : []),
			])})`;
		const where = whereAll([own, c.where]);
		return condition.minMonths
			? sql`(select coalesce(sum(e.months), 0) from experience e ${where}) >= ${condition.minMonths}`
			: sql`exists (select 1 from experience e ${where})`;
	}

	/** 一条排除上还没确认过的段，只算过得了 `person` 的人。 */
	unconfirmed(i: number, person: readonly SQL[]): SQL {
		const c = this.compiled(i);
		return sql`
			select distinct ${i}::int as cond, e.id, e.person_id
			from ${segmentsOf(c, i)}
			join person p on p.person_id = e.person_id
			${whereAll([c.where, UNCONFIRMED, ...person])}`;
	}

	/**
	 * URL 上的公司、部门和学校筛选：按名字包含，在 SQL 里按人过滤；公司和部门要求有对得上的
	 * 工作经历，学校只读员工档案。它们不是条件，不写进查询。
	 */
	view(filters: Pick<SearchFilters, "company" | "department" | "school">) {
		const segment = (
			field: "company" | "department",
			names: readonly string[],
		) =>
			sql`exists (select 1 from experience e ${whereAll([
				sql`e.person_id = p.person_id`,
				placeLike(field, names),
			])})`;
		const out: SQL[] = [];
		if (filters.company?.length) out.push(segment("company", filters.company));
		if (filters.department?.length)
			out.push(segment("department", filters.department));
		if (filters.school?.length)
			out.push(anyLike(filters.school, [sql`p.school`]));
		return out;
	}

	/**
	 * 一条经历主张的事实：同一段只留投入最深的那一行命中（一段在一条主张上算不算只有一个
	 * 结论）；投入相同时短说法在整段原文前面，证据行写得出捞到的是哪一句。去重在 SQL 里做完
	 * 再比上限，证据也不重复列段。
	 */
	facts(i: number, person: readonly SQL[]): SQL {
		const c = this.compiled(i);
		const engagement = sql`case when h.route = 'skill' then
			case h.engagement ${sql.join(
				Object.entries(ENGAGEMENT_FACTOR).map(
					([engagement, factor]) =>
						sql`when ${engagement} then ${factor}::double precision`,
				),
				sql` `,
			)} else ${ENGAGEMENT_FACTOR.做过}::double precision end
			else 1 end`;
		return sql`
			select distinct on (e.id) ${i}::int as cond, h.route,
				h.fits, h.match_score as "matchScore", h.phrase, h.engagement, e.id, e.person_id,
				to_char(e.end_date, 'YYYY-MM-DD') as end_date, ${factSelect}
			from ${segmentsOf(c, i)}
			join person p on p.person_id = e.person_id
			${whereAll([c.where, ...person])}
			order by e.id, ${engagement} desc,
				(h.route = 'description'), h.route, h.phrase_id`;
	}
}

type FactRow = {
	cond: number;
	id: number;
	route: Route;
	/** 还没确认过的段为空 */
	fits: true | null;
	matchScore: Fact["matchScore"];
	phrase: string | null;
	engagement: Engagement | null;
	person_id: string;
	end_date: string | null;
} & Pick<Fact, keyof DimSource>;

type FactLoad =
	| { kind: "loaded"; facts: Fact[]; unconfirmed: Fact[] }
	| { kind: "overflow"; claims: number[] };

/**
 * 主张候选段上的经历事实：算数的（`facts`，即证据）和还没确认过的（`unconfirmed`）分开给，没确认
 * 过的只用来算谁是候选。超过内存上限时返回贡献事实行的主张，不截断结果。
 *
 * 取数不带分面维度的筛选：分面要回答「去掉这一维之后还剩几人」，它需要看到被筛掉的那些行。
 * 只有按人过滤的那些（必须的门槛、URL 上的公司名 / 学校名）在这里生效——它们没有分面。
 */
async function fetchFacts(
	store: DbExecutor,
	shell: Shell,
	claims: readonly number[],
	person: readonly SQL[],
): Promise<FactLoad> {
	if (claims.length === 0)
		return { kind: "loaded", facts: [], unconfirmed: [] };
	const facts = sql.join(
		claims.map((index) => sql`(${shell.facts(index, person)})`),
		sql` union all `,
	);
	const rows = await store.execute<FactRow>(sql`
		select * from (${facts}) facts limit ${FACT_MAX + 1}`);
	const position = new Map(claims.map((index, at) => [index, at]));
	if (rows.rows.length > FACT_MAX) {
		const counts = await store.execute<{ cond: number; facts: number }>(sql`
			select cond, count(*)::int as facts from (${facts}) facts
			group by cond`);
		return {
			kind: "overflow",
			claims: overflowContributors(
				counts.rows.map((r) => ({
					claim: position.get(r.cond) as number,
					facts: r.facts,
				})),
				FACT_MAX,
			),
		};
	}
	const counted: Fact[] = [];
	const unconfirmed: Fact[] = [];
	for (const { person_id, cond, end_date, fits, ...dims } of rows.rows) {
		const at = position.get(cond);
		if (at === undefined) throw new Error(`取数返回了不存在的主张 ${cond}`);
		const fact = { ...dims, personId: person_id, claim: at, endDate: end_date };
		(fits ? counted : unconfirmed).push(fact);
	}
	return { kind: "loaded", facts: counted, unconfirmed };
}

type PopulationRow = { person_id: string } & DimSource;

/** 人员候选及其有效工作经历；无经历时仍保留人员属性。 */
async function fetchPopulation(
	store: DbExecutor,
	person: readonly SQL[],
): Promise<PopulationFact[] | null> {
	const rows = await store.execute<PopulationRow>(sql`
		select p.person_id, ${factSelect}
		from person p left join experience e on e.person_id = p.person_id
		${whereAll(person)}
		order by p.person_id, e.id limit ${FACT_MAX + 1}`);
	if (rows.rows.length > FACT_MAX) return null;
	return rows.rows.map(({ person_id, ...dims }) => ({
		...dims,
		personId: person_id,
	}));
}

/**
 * 当前候选里分别满足每条加分门槛的人，一条 SQL 读完。候选集合使用单个数组参数，
 * 参数数量不随候选人数增长。
 */
async function fetchPreferred(
	store: DbExecutor,
	shell: Shell,
	prefer: readonly number[],
	personIds: Iterable<string>,
): Promise<Set<string>[]> {
	const sets = prefer.map(() => new Set<string>());
	const ids = [...new Set(personIds)];
	if (prefer.length === 0 || ids.length === 0) return sets;
	const met = prefer.map((i) => sql`coalesce(${shell.gate(i)}, false)`);
	const rows = await store.execute<{ person_id: string; met: boolean[] }>(sql`
		select p.person_id, array[${sql.join(met, sql`, `)}] as met from person p
		where p.person_id = any(${sql.param(ids)}::text[])`);
	for (const row of rows.rows)
		row.met.forEach((yes, i) => {
			if (yes) sets[i]?.add(row.person_id);
		});
	return sets;
}

/**
 * 候选人：没确认过的段都按对他有利的算（主张上的算数，排除上的不算）会在名单上的人，连同
 * 职级归入的档。名单上的人都在里面。
 */
type Candidate = {
	external: boolean;
	personId: string;
	level: string;
	levelRank: number | null;
};

/** 候选人没确认过的一段：哪一条条件（下标）上的哪一段，是谁的。 */
type Unconfirmed = { cond: number; id: number; personId: string };

/**
 * 排除条件上还没确认过的段：`personIds` 这些候选人在哪条排除上还有段没确认。`excludes` 是写了
 * 判据的那几条，只有它们才有没确认过的段。超过 `FACT_MAX` 行时为 null，这几条太宽。
 */
async function fetchUnconfirmedExclusions(
	store: DbExecutor,
	shell: Shell,
	excludes: readonly Exclusion[],
	personIds: string[],
): Promise<Unconfirmed[] | null> {
	if (excludes.length === 0 || personIds.length === 0) return [];
	// 候选人已经过了门槛，这里只按人圈
	const eligible = [sql`p.person_id = any(${sql.param(personIds)}::text[])`];
	const pending = sql.join(
		excludes.map((c) => sql`(${shell.unconfirmed(shell.at(c), eligible)})`),
		sql` union all `,
	);
	const { rows } = await store.execute<{
		cond: number;
		id: number;
		person_id: string;
	}>(sql`select * from (${pending}) pending limit ${FACT_MAX + 1}`);
	if (rows.length > FACT_MAX) return null;
	return rows.map((row) => ({
		cond: row.cond,
		id: row.id,
		personId: row.person_id,
	}));
}

/**
 * 决定谁在名单上的那些没确认过的段：必须和排除的条件上的。加分的条件只影响名次，它们没确认完
 * 不算名单不完整。
 */
function deciding(
	query: Query,
	unconfirmed: readonly Unconfirmed[],
): Unconfirmed[] {
	return unconfirmed.filter((u) => query.conditions[u.cond]?.mode !== "boost");
}

/** 一个候选人的档高；没有职级的人排在最低一档之下。 */
function heightOf(candidate: Candidate | undefined): number {
	return candidate?.levelRank ?? Number.NEGATIVE_INFINITY;
}

/** 职级高的在前；同一档、都没有职级的不分先后。 */
function higherFirst(a: Candidate | undefined, b: Candidate | undefined) {
	const [x, y] = [heightOf(a), heightOf(b)];
	return x === y ? 0 : y - x;
}

/**
 * 候选人没确认完时，名单完整确认到了哪里：候选人里比「还有段没确认的人」职级都高的那几档中
 * 最低的一档。
 */
function incompleteOf(
	candidates: readonly Candidate[],
	unconfirmed: readonly Unconfirmed[],
): Incomplete | undefined {
	if (unconfirmed.length === 0) return undefined;
	if (candidates.some((c) => c.external)) return { above: null, mixed: true };
	const byId = new Map(candidates.map((c) => [c.personId, c]));
	let top = Number.NEGATIVE_INFINITY;
	for (const u of unconfirmed)
		top = Math.max(top, heightOf(byId.get(u.personId)));
	let above: Candidate | null = null;
	for (const c of candidates)
		if (heightOf(c) > top && (!above || heightOf(c) < heightOf(above)))
			above = c;
	return { above: above?.level || null };
}

/**
 * 在同一语料快照中完成取数、排序与分面。查询已经校验过；filters 只描述这一次怎样查看结果。
 * 名单上只有确认过的经历算数的人；候选人没确认完时结果带 `incomplete`。
 */
export async function execute(
	query: Query,
	/** 这份查询属于哪一次找人任务（链头的 id）：确认过的经历只认这次任务里的。不属于任何任务的为 null。 */
	rootTurnId: string | null,
	filters: SearchFilters = {},
	/** 本次返回前多少人；每次翻页重新取得同一快照内排名的完整前缀。 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	const roles = rolesOf(query);
	const { claims } = roles;
	return prepared(query, rootTurnId, async (store, ready, problems) => {
		for (const [i, problem] of problems.entries())
			if (problem !== null)
				throw new InvalidQueryError(
					`条件「${query.conditions[i]?.label}」不能执行：${problem}`,
				);
		if (active(roles) === 0)
			return {
				order: "evidence" as const,
				claims,
				...noOne(),
				empty: inactiveReason(query),
			};
		const found = await restricted(store, () =>
			evaluate(store, new Shell(query, ready), roles, filters),
		);
		if (found.kind === "overflowEvidence")
			return { order: "evidence", claims, ...noOne(), empty: found };
		if (found.kind === "overflowPopulation")
			return {
				...(claims.length > 0
					? { order: "evidence" as const, claims }
					: { order: "person" as const, claims: [] as [] }),
				...noOne(),
				empty: found,
			};
		const incomplete = incompleteOf(
			found.candidates,
			deciding(query, found.unconfirmed),
		);
		const empty = await emptyReason({
			filters,
			total: found.ranked.total,
			incomplete,
			nobody: () => nobodyOf(store, ready, query),
		});
		return present(store, found, claims, filters, limit, { incomplete, empty });
	});
}

/**
 * 名单空了时，必须条件里单独一条就没有人的那几条（`Unmet`）：和 `probe` 单条数人是同一条路，
 * 对得上的段都确认过不算的条件也数成没有人。
 */
async function nobodyOf(
	store: DbExecutor,
	ready: readonly (Compiled | null)[],
	query: Query,
): Promise<string[]> {
	const musts = ready.map((one, i) =>
		query.conditions[i]?.mode === "must" ? one : null,
	);
	const counts = await eachSelected<number>(
		store,
		musts,
		sql`count(distinct s.person_id)::int`,
	);
	return query.conditions.flatMap((c, i) => {
		const n = counts[i];
		return n && "value" in n && n.value === 0 ? [c.id] : [];
	});
}

type Evaluated =
	| Overflow
	| {
			kind: "ranked";
			/** 名单上的人算数的事实：名单、分面和证据只读它 */
			facts: Fact[];
			/** 候选排序所依据的全部段，包含尚未确认的经历。 */
			candidateFacts: Fact[];
			ranked: ReturnType<typeof rank>;
			/**
			 * 候选人，按没确认过的段都对他有利时的名次。查询理解接下来读的就是这些人没确认过的段。
			 */
			candidates: Candidate[];
			/** 候选人在主张和排除上还没确认过的段 */
			unconfirmed: Unconfirmed[];
	  };

/** 启用的条件有几条。一条都没有就没有名单可出。 */
function active({ claims, gates, prefer, excludes }: Roles): number {
	return claims.length + gates.length + prefer.length + excludes.length;
}

/** 只读角色下的那一半：门槛、事实、人群、偏好，然后交给 rank.ts。 */
async function evaluate(
	store: DbExecutor,
	shell: Shell,
	{ claims, gates, prefer, excludes }: Roles,
	filters: SearchFilters,
): Promise<Evaluated> {
	// 门槛、排除和 URL 上的公司名 / 学校名都按人过滤，在每一条取数 SQL 里生效
	const person = [
		...[...gates, ...excludes].map((c) => shell.gate(shell.at(c))),
		...shell.view(filters),
	];
	const conds = claims.map((claim) => shell.at(claim));
	const loaded = await fetchFacts(store, shell, conds, person);
	if (loaded.kind === "overflow") {
		const contributors = new Set(loaded.claims);
		return {
			kind: "overflowEvidence",
			conditions: claims.filter((_, i) => contributors.has(i)),
		};
	}
	const all = [...loaded.facts, ...loaded.unconfirmed];
	// 必须经历限定候选；没有必须经历时，偏好只排序，候选来自人员。
	const people = claims.some((claim) => claim.mode === "must")
		? undefined
		: await fetchPopulation(store, person);
	if (people === null) return { kind: "overflowPopulation" };
	const preferred = await fetchPreferred(
		store,
		shell,
		prefer.map((c) => shell.at(c)),
		(people ?? all).map((f) => f.personId),
	);
	const now = new Date();
	const judgedExcludes = excludes.filter((c) => c.seek?.criterion);
	// 要确认的是可能上名单的人。按不加筛选的名次取：分面列的是筛选以外的取值，那些人也要确认
	const eligible =
		judgedExcludes.length > 0
			? order(
					all,
					people ?? all,
					claims,
					{},
					now,
					preferred,
					engagementWeight,
				).map((row) => row.personId)
			: [];
	const onExclusions = await fetchUnconfirmedExclusions(
		store,
		shell,
		judgedExcludes,
		eligible,
	);
	if (onExclusions === null)
		return { kind: "overflowEvidence", conditions: judgedExcludes };
	// 在排除上还有段没确认的人不上名单：他该不该排除还不知道
	const undecided = new Set(onExclusions.map((u) => u.personId));
	const decided = <T extends { personId: string }>(rows: T[]) =>
		rows.filter((row) => !undecided.has(row.personId));
	const facts = decided(loaded.facts);
	const ranked = rank(
		facts,
		people ? decided(people) : facts,
		claims,
		filters,
		now,
		preferred,
	);
	// 没有还没确认的段时候选人就是名单上的人，不用再排一遍
	const hoped =
		loaded.unconfirmed.length > 0 || undecided.size > 0
			? order(
					all,
					people ?? all,
					claims,
					filters,
					now,
					preferred,
					engagementWeight,
				)
			: ranked.ranked;
	const among = new Set(hoped.map((row) => row.personId));
	const levels = new Map<string, PopulationFact>();
	for (const row of people ?? all)
		if (!levels.has(row.personId)) levels.set(row.personId, row);
	return {
		kind: "ranked",
		candidateFacts: all,
		facts,
		ranked,
		candidates: hoped.map(({ personId }) => ({
			personId,
			external: levels.get(personId)?.talentType === "外部候选人",
			level: levels.get(personId)?.level ?? "",
			levelRank: levels.get(personId)?.levelRank ?? null,
		})),
		unconfirmed: [
			...loaded.unconfirmed.map((fact) => ({
				cond: conds[fact.claim] as number,
				id: fact.id,
				personId: fact.personId,
			})),
			...onExclusions,
		].filter((u) => among.has(u.personId)),
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
	{
		incomplete,
		empty,
	}: {
		/** 候选人没确认完时确认到了哪里 */
		incomplete: Incomplete | undefined;
		empty: EmptyReason | null;
	},
): Promise<SearchOutcome> {
	const counted = { facets, total, ...(incomplete && { incomplete }) };
	const page = ranked.slice(0, limit);
	const personIds = page.map((row) => row.personId);
	const people =
		personIds.length === 0
			? []
			: await store
					.select(RESULT_COLUMNS)
					.from(personCard)
					.where(inArray(personCard.personId, personIds));
	const personById = new Map(people.map((person) => [person.personId, person]));
	if (claims.length === 0)
		return {
			order: "person",
			claims: [],
			...counted,
			empty,
			results: page.flatMap((row) => {
				const person = personById.get(row.personId);
				return person ? [{ person }] : [];
			}),
		};
	if (page.length === 0)
		return { order: "evidence", claims, results: [], ...counted, empty };

	const kept = pageEvidence(facts, claims, filters, new Set(personIds));
	const ids = [...new Set([...kept.values()].flat().map((fact) => fact.id))];
	const segments = await store
		.select()
		.from(experience)
		.where(inArray(experience.id, ids));
	const segById = new Map(segments.map((segment) => [segment.id, segment]));
	const results: RankedResult[] = page.flatMap((row) => {
		const person = personById.get(row.personId);
		if (!person) return [];
		const evidence = (kept.get(row.personId) ?? []).flatMap<Evidence>(
			(fact) => {
				const segment = segById.get(fact.id);
				if (!segment) return [];
				return [
					{
						experienceId: segment.id,
						kind: segment.kind,
						claim: fact.claim,
						route: fact.route,
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
			},
		);
		return [
			{
				person,
				depth: row.depth,
				basis: row.basis,
				evidence,
			},
		];
	});
	return { order: "evidence", claims, results, ...counted, empty };
}

/** 一条条件单独试跑的结果：它选中多少人，或者它为什么跑不了。停用的不跑。 */
type ConditionProbe = {
	id: string;
	/**
	 * 这条单独选中的人数。写了「做过什么」的是字面和 `where` 对得上的人，含还没确认过的，不含
	 * 判成不算的：多少人真的算，要这一条的每个候选都确认过才知道，而读经历只读整份条件的候选。
	 * 排除数的也是这些人：它最多会拦下谁。
	 */
	people: number | null;
	problem: string | null;
};

type ProbeResult = {
	conditions: ConditionProbe[];
	/** 名单上的人数；有条件跑不了、或事实超过内存上限时为 null */
	total: number | null;
	/** 候选人数：要是还没确认过的段都算数，名单上会有多少人；名单出不来时为 null */
	candidates: number | null;
	/**
	 * 候选人在写了判据的条件上还没确认过的段，职级高的人在前，同一档按名次。先给必须和排除的
	 * 条件上的，它们都确认完了才轮到加分的：必须的条件判成不算的人不是候选，他们加分的段不用看。
	 */
	unconfirmed: { condition: QueryCondition; experienceId: number }[];
	/** 事实超过内存上限：哪几条太宽 */
	overflow: string[];
};

/**
 * 试跑一份查询：每条条件单独数人，再整份跑一遍数名单上的人，列出候选人还没确认过的段。
 *
 * 单条的人数：经历条件数选中的段是谁的，写了累计时长的按去重后的段累计；人的条件数满足它的人
 * （`selectedOf`）。
 */
export async function probe(
	query: Query,
	rootTurnId: string,
): Promise<ProbeResult> {
	const roles = rolesOf(query);
	return prepared(query, rootTurnId, async (store, ready, problems) => {
		const counts = await eachSelected<number>(
			store,
			ready,
			sql`count(distinct s.person_id)::int`,
		);
		const results: ConditionProbe[] = query.conditions.map((c, i) => {
			const n = counts[i];
			return {
				id: c.id,
				people: n && "value" in n ? n.value : null,
				problem: problems[i] ?? (n && "problem" in n ? n.problem : null),
			};
		});
		const none = {
			total: null,
			candidates: null,
			unconfirmed: [],
			overflow: [],
		};
		const runnable =
			results.every((r) => r.problem === null) && active(roles) > 0;
		if (!runnable) return { conditions: results, ...none };
		const found = await restricted(store, () =>
			evaluate(store, new Shell(query, ready), roles, {}),
		);
		if (found.kind !== "ranked")
			return {
				conditions: results,
				...none,
				overflow:
					found.kind === "overflowEvidence"
						? found.conditions.map((c) => c.id)
						: [],
			};
		const byId = new Map(found.candidates.map((c) => [c.personId, c]));
		const order = new Map(found.candidates.map((c, at) => [c.personId, at]));
		const first = deciding(query, found.unconfirmed);
		const pending = (first.length > 0 ? first : found.unconfirmed).sort(
			(a, b) =>
				higherFirst(byId.get(a.personId), byId.get(b.personId)) ||
				(order.get(a.personId) ?? 0) - (order.get(b.personId) ?? 0) ||
				a.cond - b.cond ||
				a.id - b.id,
		);
		// 先维持各自队内的顺序，再把两侧的段交替交给批次装配器。
		const outside = pending.filter((u) => byId.get(u.personId)?.external);
		const inside = pending.filter((u) => !byId.get(u.personId)?.external);
		let firstQueue = inside,
			secondQueue = outside;
		if (inside.length && outside.length) {
			// 一轮只剩一个名额时，下轮从此前确认较少的一侧开始；否定结论也占用过额度。
			const keys = [
				...new Set(
					pending
						.map((u) => query.conditions[u.cond]?.seek?.criterion)
						.filter((s): s is string => !!s)
						.map(criterionKey),
				),
			];
			const balance = await store.execute<{ outside_first: boolean }>(sql`select
				count(*) filter(where p.talent_type='在职员工')>count(*) filter(where p.talent_type='外部候选人') as outside_first
				from experience_verdict v join experience e on v.content=${SEGMENT_CONTENT} join person_card p using(person_id)
				where v.root_turn_id=${rootTurnId} and v.criterion_key=any(${sql.param(keys)}::text[])`);
			if (balance.rows[0]?.outside_first) {
				firstQueue = outside;
				secondQueue = inside;
			}
		}
		const ordered: typeof pending = [];
		for (let i = 0; i < Math.max(firstQueue.length, secondQueue.length); i++) {
			const a = firstQueue[i],
				b = secondQueue[i];
			if (a) ordered.push(a);
			if (b) ordered.push(b);
		}
		// 同一快照里，同一判据只需确认某段一次，多个条件共享这份结论和额度。
		const seen = new Map<string, Set<number>>();
		const unconfirmed: ProbeResult["unconfirmed"] = [];
		for (const { cond, id } of ordered) {
			const condition = query.conditions[cond];
			const criterion = condition?.seek?.criterion;
			if (!criterion) continue;
			const ids = seen.get(criterion) ?? new Set<number>();
			if (ids.has(id)) continue;
			ids.add(id);
			seen.set(criterion, ids);
			unconfirmed.push({ condition, experienceId: id });
		}
		return {
			conditions: results,
			total: found.ranked.total,
			candidates: found.candidates.length,
			unconfirmed,
			overflow: [],
		};
	});
}

/** 在同一快照内读取入围名单或候选人及其经历，离开回调后才可调用模型。 */
export async function withSearchFacts<T>(
	query: Query,
	rootTurnId: string | null,
	read: (
		store: DbExecutor,
		snapshot: {
			ranked: Ranked[];
			facts: Fact[];
			candidates: Candidate[];
			candidateFacts: Fact[];
		},
	) => Promise<T>,
): Promise<T | null> {
	const roles = rolesOf(query);
	return prepared(query, rootTurnId, async (store, ready, problems) => {
		if (problems.some((p) => p !== null) || !active(roles)) return null;
		const found = await restricted(store, () =>
			evaluate(store, new Shell(query, ready), roles, {}),
		);
		if (found.kind !== "ranked") return null;
		const { ranked, facts, candidates, candidateFacts } = found;
		return read(store, {
			ranked: ranked.ranked,
			facts,
			candidates,
			candidateFacts,
		});
	});
}

/** 一条条件选中了谁：经历条件是段（`人员编号:段 id`），人的条件是人员编号，按字面排好。 */
type ConditionSelection = {
	id: string;
	selected: string[] | null;
	problem: string | null;
};

/**
 * 每条条件单独跑，列出它选中的段或人：和 `probe` 同一条路、同一份语句，`probe` 数人，这里列出
 * 来。验收脚本拿它比两条条件是不是同一个要求。它给的是人和段的标识，只给验收用。
 */
export async function selection(query: Query): Promise<ConditionSelection[]> {
	return prepared(query, null, async (store, ready, problems) => {
		const lists = await eachSelected<string[]>(
			store,
			ready,
			sql`coalesce(array_agg(concat_ws(':', s.person_id, s.id)), '{}')`,
		);
		return query.conditions.map((c, i) => {
			const n = lists[i];
			return {
				id: c.id,
				selected: n && "value" in n ? n.value.sort() : null,
				problem: problems[i] ?? (n && "problem" in n ? n.problem : null),
			};
		});
	});
}

/**
 * `execute`、`probe` 和 `selection` 的前半段：编译每条条件，在检索事务里物化命中，再交给
 * `run`。`ready` 按条件下标给出能跑的条件；停用的、编不出的、正则写不对的是 null，后两种的
 * 原因在 `problems`。
 */
async function prepared<T>(
	query: Query,
	rootTurnId: string | null,
	run: (
		store: DbExecutor,
		ready: readonly (Compiled | null)[],
		problems: readonly (string | null)[],
	) => Promise<T>,
): Promise<T> {
	const checked = await Promise.all(
		query.conditions.map((c) => (c.off ? null : compiledOf(c))),
	);
	const compiled = checked.map((r) => (r?.ok ? r.compiled : null));
	const problems = checked.map((r) => (r && !r.ok ? r.problem : null));
	const seeking = compiled.flatMap((c, i) =>
		c && seeks(c.condition) ? [{ index: i, seek: c.condition.seek }] : [],
	);
	return withMatchedPhrases(
		chainScope(rootTurnId),
		seeking.map((s) => s.seek),
		async (store, perSeek) => {
			const matched = new Map(
				seeking.map((s, at) => [s.index, perSeek[at] as MatchedPhrases]),
			);
			for (const [i, one] of matched)
				if ("problem" in one) problems[i] = one.problem;
			const ready = compiled.map((c, i) => (problems[i] === null ? c : null));
			await materializeHits(store, query.conditions, matched, rootTurnId);
			return run(store, ready, problems);
		},
	);
}

/**
 * 每条条件单独在只读角色里跑一遍 `select <aggregate> from (selectedOf) s`，按条件的下标；
 * `ready` 里是 null 的不跑。每条在自己的保存点里跑，一条报错不影响别的条；数据库的错误脱敏后
 * 作为这一条的问题（`sandboxProblem`）。
 */
async function eachSelected<T>(
	store: DbExecutor,
	ready: readonly (Compiled | null)[],
	aggregate: SQL,
): Promise<({ value: T } | { problem: string } | null)[]> {
	const out: ({ value: T } | { problem: string } | null)[] = [];
	for (const [i, one] of ready.entries()) {
		if (!one) {
			out.push(null);
			continue;
		}
		try {
			const value = await restricted(store, async () => {
				const { rows } = await store.execute<{ v: T }>(
					sql`select ${aggregate} as v from (${selectedOf(one, i)}) s`,
				);
				return rows[0]?.v as T;
			});
			out.push({ value });
		} catch (error) {
			const problem = sandboxProblem(error);
			if (problem === null) throw error;
			out.push({ problem });
		}
	}
	return out;
}

/**
 * 一条条件选中了什么，`person_id, id` 的行；规则见 `probe`。经历条件是选中的段，写了「做过什么」
 * 的是候选的段，写了累计时长的只留累计够了的人的段；人的条件是满足它的人，id 为 null。
 */
function selectedOf(one: Compiled, i: number): SQL {
	const c = one.condition;
	if (c.from === "person")
		return sql`select p.person_id, null::int as id from person p where ${one.where}`;
	const segments = sql`select distinct e.person_id, e.id, e.months
		from ${segmentsOf(one, i)} ${whereAll([one.where])}`;
	return c.minMonths
		? sql`with s as (${segments})
			select s.person_id, s.id from s
			where s.person_id in (
				select person_id from s group by person_id having sum(months) >= ${c.minMonths})`
		: sql`select s.person_id, s.id from (${segments}) s`;
}
