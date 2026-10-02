/**
 * 检索取数与词表匹配，产出事实；打分、AND 判定、排序、分面交给 rank.ts。
 *
 * 一条经历主张的各项约束作用于同一段经历；累计时长由 rank.ts 跨段求值。
 * 背景与人的条件是门槛，不产生经历证据：必须的过滤人，加分的记录满足情况。
 * 被排除否决的段不能作为背景依据。
 *
 * 模型重排在快照外完成，取事实的快照重新召回、核对空间及完整候选文本的分数。
 */

import "@tanstack/react-start/server-only";
import { inArray, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { EXTRACTED_ROUTES, employee, experience } from "#/db/schema";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import { dots } from "#/lib/format";
import { escapeLike } from "#/lib/sql";
import type { ExperienceCondition } from "./condition";
import {
	DIMENSIONS,
	type DimKey,
	type DimSource,
	dimId,
	dimPicked,
	isOrdinal,
	NOT_A_VALUE,
	type OrdinalKey,
	type Picked,
	VOCAB_KEYS,
	type VocabKey,
} from "./dimensions";
import { emptyReason } from "./empty";
import type { Vocabulary } from "./intent";
import type { KeywordField } from "./keywords";
import type { SearchFilters } from "./params";
import { type PhraseHit, phraseHitTable, withMatchedPhrases } from "./phrases";
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
	type Gate,
	type Hit,
	queryOf,
	type RankedResult,
	type ResultEmployee,
	type SearchOutcome,
	type Suggestion,
} from "./result";
import type { SearchSpec } from "./spec";
import type { NameField, NameFinding, TermFinding } from "./trace";
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
 * 发给查询理解模型的能力词和公司、学校名，至少这么多人写过才发。冷僻的写法和小公司的
 * 名字连同人数一起发出去，就能反推出是哪个人；而查询理解的端点可以在公网上。
 */
const MIN_PEOPLE_TO_SHOW = 5;

/** 一个词命中的标准能力词、一个名字匹配到的公司或学校，各最多给几个。 */
const MAX_TO_SHOW = 8;

/**
 * 经历词的命中人数、宽度与标准能力词，和搜索共用召回、相关度门槛及经历边。
 * 人数按员工去重，宽度按人才库人群占比判定，不带视图筛选。
 * 仅向模型展示至少 MIN_PEOPLE_TO_SHOW 人使用的标准能力词，最多 MAX_TO_SHOW 项。
 * 这里采用正向门槛；排除主张使用更严格的 RELEVANCE_MIN_EXCLUDE。
 */
export async function findTerms(texts: string[]): Promise<TermFinding[]> {
	const asked = [...new Set(texts)];
	if (asked.length === 0) return [];
	return withMatchedPhrases(
		asked,
		RELEVANCE_MIN,
		async (store, { phraseHits }) => {
			const out = asked.map(
				(text): TermFinding => ({ text, people: 0, wide: false, terms: [] }),
			);
			const table = phraseHitTable(
				asked.flatMap((t, i) =>
					(phraseHits.get(t) ?? []).map((hit) => ({
						claimIdx: i,
						valueIdx: 0,
						hit,
					})),
				),
			);
			if (!table) return out;
			const counts = await store.execute<{
				claim_idx: number;
				people: number;
			}>(sql`
			with q(claim_idx, value_idx, phrase_id, relevance) as ${table}
			select q.claim_idx, count(distinct e.emp_id)::int as people from q
			join experience_phrase ep on ep.phrase_id = q.phrase_id
			join experience e on e.id = ep.experience_id
			where not e.unemployed
			group by q.claim_idx`);
			const [total] = (
				await store.execute<{ n: number }>(
					sql`select count(distinct emp_id)::int as n from experience where not unemployed`,
				)
			).rows;
			for (const row of counts.rows) {
				const r = out[row.claim_idx];
				if (!r) continue;
				r.people = row.people;
				r.wide = row.people > (total?.n ?? 0) * WIDE_SHARE;
			}
			const terms = await store.execute<{
				claim_idx: number;
				name: string;
				people: number;
			}>(sql`
			with q(claim_idx, value_idx, phrase_id, relevance) as ${table},
			hit as (
				select q.claim_idx, coalesce(t.canonical, ph.text) as name,
					count(distinct e.emp_id)::int as people, max(q.relevance) as relevance
				from q
				join experience_phrase ep on ep.phrase_id = q.phrase_id and ep.route = 'skill'
				join phrase ph on ph.id = ep.phrase_id
				left join skill_term t on t.word = ph.text
				join experience e on e.id = ep.experience_id
				where not e.unemployed
				group by q.claim_idx, 2
				having count(distinct e.emp_id) >= ${MIN_PEOPLE_TO_SHOW}
			)
			select claim_idx, name, people from (
				select *, row_number() over (
					partition by claim_idx order by relevance desc, people desc, name
				) as n from hit
			) ranked where n <= ${MAX_TO_SHOW}
			order by claim_idx, n`);
			for (const row of terms.rows)
				out[row.claim_idx]?.terms.push({ name: row.name, people: row.people });
			return out;
		},
	);
}

/**
 * 这些名字各能匹配到多少人、匹配到人才库里哪些公司或学校。
 *
 * 和搜索条件用同一套匹配（`anyLike`）：名字是专有名词，按包含匹配，不用向量。
 * 公司名在公司内的任职上匹配的是部门名和部门路径，那是内部信息，只算进人数；
 * 发给模型的名字只取入职前经历的公司名，写的人少于 `MIN_PEOPLE_TO_SHOW` 的不发。
 */
export async function findNames(
	field: NameField,
	names: string[],
): Promise<NameFinding[]> {
	const asked = [...new Set(names)];
	return withCorpusSnapshot(async (store) => {
		const out: NameFinding[] = [];
		for (const name of asked) {
			const countPeople =
				field === "org"
					? sql`select count(distinct e.emp_id)::int as n from experience e
						where not e.unemployed and ${anyLike([name], [sql`e.org`, sql`e.org_path`])}`
					: sql`select count(*)::int as n from employee p
						where ${anyLike([name], [sql`p.school`])}`;
			const matched =
				field === "org"
					? sql`select e.org as name, count(distinct e.emp_id)::int as people
						from experience e
						where not e.unemployed and e.kind = 'external' and ${anyLike([name], [sql`e.org`])}
						group by e.org`
					: sql`select p.school as name, count(*)::int as people
						from employee p where ${anyLike([name], [sql`p.school`])}
						group by p.school`;
			const [people] = (await store.execute<{ n: number }>(countPeople)).rows;
			const shown = await store.execute<{ name: string; people: number }>(sql`
				select name, people from (${matched}) m
				where people >= ${MIN_PEOPLE_TO_SHOW}
				order by people desc, name limit ${MAX_TO_SHOW}`);
			out.push({ name, people: people?.n ?? 0, names: shown.rows });
		}
		return out;
	});
}

type FactRow = {
	claim_idx: number;
	/** 命中的是第几个经历词 */
	value_idx: number;
	id: number;
	route: Route;
	relevance: number;
	phrase: string | null;
	involvement: string | null;
	emp_id: string;
	end_date: string | null;
} & Pick<Fact, keyof DimSource>;

type PopulationRow = { emp_id: string } & DimSource;

/**
 * 新建没有候选人的结果字段；分面集合不共享可变状态。
 */
function noOne(): { results: []; facets: Facets; total: number } {
	return { results: [], facets: emptyFacets(), total: 0 };
}

/**
 * 名单的展示投影，两种检索路径共用。
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
 * 按贡献从大到小挑，直到剩余事实能进上限；同样行数按查询顺序稳定并列。
 * 返回时再恢复查询顺序，让界面上列出的顺序和 chips 一致。这个指标只解释
 * `FACT_MAX`，和按人数占比判断的太宽（`findTerms`）无关。
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
 * 分面与筛选共用的事实列表达式，别名对应 DimSource。
 * 外连接没有经历时保留空属性；人员属性始终从 employee 读取。
 */
const FACT_COLUMNS: Record<keyof DimSource, SQL> = {
	months: sql`e.months`,
	// 序列筛选认登记的，登记为空（入职前的段）才认模型对齐的；两对各自成对，不会
	// 一级来自登记、二级来自对齐。证据路 `seq` 不读这里，只嵌登记值。
	seqL1: sql`coalesce(nullif(e.seq_l1, ''), e.seq_inferred_l1)`,
	seqL2: sql`coalesce(nullif(e.seq_l2, ''), e.seq_inferred_l2)`,
	kind: sql`e.kind`,
	companyTag: sql`e.org_meta ->> 'company_tag'`,
	/** 经历技能的标准写法及全部父词，作为技能筛选的取值；UNION 去重。 */
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
	level: sql`p.cur_level_band`,
	levelRank: sql`p.cur_level_rank`,
	recruitment: sql`p.recruitment`,
	education: sql`p.education_level`,
	educationRank: sql`p.education_rank`,
};

/**
 * 「某档及以上」：比的是档高，条件里写的是档名，档高当场从库里查。同一档的人档高
 * 相同（同步时校验过），取哪一个人的都一样。子查询里的 `employee p` 遮住外层的 `p`，
 * 同一份 `FACT_COLUMNS` 在里面读的就是那一档的人。
 */
function atLeastCond(key: OrdinalKey, band: string): SQL {
	const rank = FACT_COLUMNS[`${key}Rank`];
	return sql`${rank} >= (select min(${rank}) from employee p where ${FACT_COLUMNS[key]} = ${band})`;
}

/** 事实列的 select 片段。两处取数共用，所以两处的列必然一致。 */
const factSelect = sql.join(
	Object.entries(FACT_COLUMNS).map(
		(entry) => sql`${entry[1]} as "${sql.raw(entry[0])}"`,
	),
	sql`, `,
);

/**
 * 维度 SQL 的集合身份或阈值表达式。one 为单值，any 为一段的取值集合；
 * 谓词由 DIMENSIONS 的匹配家族生成。
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
 * 经历词不在这里（它由相关度过滤决定，见 `phrases.ts`），累计时长也不在（它跨段，归 `rank.ts`）。
 *
 * 公司名是专有名词，永远不进向量：「字节」和「腾讯」在向量空间里是邻居，
 * 语义匹配会把竞品全匹配进来。它按这一段的公司名或部门路径模糊匹配。
 */
function segmentConds(claim: ExperienceCondition): SQL[] {
	const conds: SQL[] = [sql`not e.unemployed`];
	if (claim.org)
		conds.push(sql`(${anyLike(claim.org, [sql`e.org`, sql`e.org_path`])})`);
	const tag = dimCond("companyTag", claim.companyTag && [...claim.companyTag]);
	if (tag) conds.push(tag);
	const kind = dimCond("kind", claim.kind);
	if (kind) conds.push(kind);
	return conds;
}

/**
 * 门槛在 `employee p` 上的谓词，一条一个。
 *
 * 人的条件：词表维走维度自己的列表达式；学校名和公司名一样是专有名词，按名字
 * 模糊匹配。背景：这个人有符合范围的段（`segmentConds`），写了累计时长就把
 * 那些段的月数加起来比。被排除否决的段（`veto`）不算作背景的证据，和不算作主张的
 * 证据是同一条语义。
 */
function gateConds(gates: readonly Gate[], veto: SQL | null): SQL[] {
	return gates.flatMap((g) => {
		if (g.about === "experience") {
			const where = whereAll([
				sql`e.emp_id = p.emp_id`,
				...segmentConds(g),
				...(veto ? [sql`e.id not in (${veto})`] : []),
			]);
			return g.minMonths
				? sql`(select coalesce(sum(e.months), 0) from experience e ${where}) >= ${g.minMonths}`
				: sql`exists (select 1 from experience e ${where})`;
		}
		if ("atLeast" in g) return atLeastCond(g.field, g.atLeast);
		if (g.field === "school")
			return sql`(${anyLike(g.values, [sql`p.school`])})`;
		return dimCond(g.field, [...g.values]) ?? [];
	});
}

/**
 * URL 上的公司名 / 学校名筛选。它们没有分面，所以和必须的门槛一样在取数 SQL 里
 * 按人过滤：分面随之只数剩下的人——这正是「选了这一项之后还剩几人」该有的口径。
 * 维度那八项**不能**这样下推，因为筛选栏还要回答「再勾一项会剩几人」，那个数
 * 只有把没筛之前的完整事实拿在内存里才算得出来（`rank.ts`）。
 */
function viewConds(view: Pick<SearchFilters, "org" | "school">): SQL[] {
	const conds: SQL[] = [];
	if (view.org?.length)
		conds.push(sql`exists (
			select 1 from experience x where x.emp_id = p.emp_id and not x.unemployed
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
 * 候选里满足一条**偏好**（加分的门槛）的那些人。
 *
 * 偏好不过滤人，只改名次（`rank.ts` 各乘一次 `BOOST_WEIGHT`），所以它不能像
 * 必须那样下推到取数的谓词里；也不在内存里判——事实行上没有学校，也没有
 * 主张以外的段。所以每条偏好单独问一次库，只问候选那批人，不扫全库。
 */
async function fetchPreferred(
	store: DbExecutor,
	gate: Gate,
	veto: SQL | null,
	empIds: Iterable<string>,
): Promise<Set<string>> {
	const ids = [...new Set(empIds)];
	if (ids.length === 0) return new Set();
	const rows = await store.execute<{ emp_id: string }>(sql`
		select p.emp_id from employee p
		where p.emp_id in (${sql.join(
			ids.map((id) => sql`${id}`),
			sql`, `,
		)}) and ${sql.join(gateConds([gate], veto), sql` and `)}`);
	return new Set(rows.rows.map((r) => r.emp_id));
}

/** 事实行的公共列：主张下标、段、路、相关度、说法、人、结束日期，再加分面要读的几列。 */
const FACT_ROW = sql`e.id, e.emp_id, e.end_date, ${factSelect}`;

/**
 * 有经历词的主张：命中的说法通过 `experience_phrase` 关联到段，同一主张、同一段
 * 只留证据最强的那一次命中。
 *
 * 每条主张按经历词展开：词之间是 OR，但各自单独判定，因为「命中的是哪个词」
 * 要进证据行。一段几类都可能命中、几个词都可能命中，这里只留最强的一行：
 * 先比可信度那一档、同档比相关度——和 rank.ts 的 `stronger` 同一套比较规则，
 * 否则这里留下的和那边选出来的不是同一条证据。打分层按事实累加月份，同段两行
 * 会把 12 个月数成 24；证据行也会把同一段列两遍。去重必须在 SQL 里做完再比
 * 上限：在内存里去重的话，三个词的宽主张会把 FACT_MAX 提前触发三倍。
 *
 * 主张自己的段谓词只作用在自己的行上（`q.claim_idx = i and …`）：「入职前在大厂
 * 做过增长」限定的是增长那一段，不限定同一查询里别的主张的段。
 */
function factsSql(
	claims: readonly Claim[],
	phraseHits: Map<string, PhraseHit[]>,
	person: readonly SQL[],
): SQL | null {
	const table = phraseHitTable(
		claims.flatMap((claim, claimIdx) =>
			claim.what.flatMap((value, valueIdx) =>
				(phraseHits.get(value) ?? []).map((hit) => ({
					claimIdx,
					valueIdx,
					hit,
				})),
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
		claims.map((claim, i) => {
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
 * 命中的经历事实。超过内存上限时返回真正贡献事实行的主张，不截断结果。
 *
 * 取数不带分面维度的筛选：分面要回答「去掉这一维之后还剩几人」，它需要看到
 * 被筛掉的那些行。筛选、AND、人员打分、排序与分面都在 rank.ts 对这份事实求值。
 * 只有按人过滤的那些（必须的门槛、URL 上的公司名 / 学校名）在这里生效——它们没有分面。
 */
async function fetchFacts(
	store: DbExecutor,
	claims: readonly Claim[],
	phraseHits: Map<string, PhraseHit[]>,
	person: readonly SQL[],
): Promise<FactLoad> {
	const facts = factsSql(claims, phraseHits, person);
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
				const value = claims[claim_idx]?.what[value_idx];
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
 * 被排除的主张否决的**经历段**。这些段不再算作任何主张的证据；人本身不被排除——
 * 没了这些段还有别的证据的人照常进结果，只有这些段的人过不了 AND，自然出局。
 * 排除因此和「从经历找人」是同一个语义，不是一套针对人的黑名单。
 *
 * 一条排除的主张同样是「一段经历同时满足这几项」：「不要入职前的实习」否决的是
 * 入职前而且是实习的段。没有经历词的排除（「不要入职前的经历」）否决符合范围的
 * 每一段。时长在这里按单段判（`e.months`）：否决问的是「这一段是不是 X」，
 * 而累计是人的属性。
 *
 * **不带当前筛选。** 否决问的是「这一段是不是 X」，答案只能由这段经历自己决定。
 * 让筛选参与，「只看在职经历」就会让入职前那段实习重新算作证据，
 * 于是多加一个筛选反而放出更多本该被否决的证据。
 *
 * **门槛比正向条件高**（RELEVANCE_MIN_EXCLUDE）：正向条件可以放宽，排除词必须准。
 */
function vetoSql(
	excludes: readonly ExperienceCondition[],
	phraseHits: Map<string, PhraseHit[]>,
): SQL | null {
	const parts = excludes.flatMap((claim, i) => {
		const conds = segmentConds(claim);
		if (claim.minMonths) conds.push(sql`e.months >= ${claim.minMonths}`);
		if (!claim.what)
			return [sql`select e.id from experience e ${whereAll(conds)}`];
		const table = phraseHitTable(
			claim.what.flatMap((value, valueIdx) =>
				(phraseHits.get(value) ?? [])
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
	if (parts.length === 0) return null;
	return sql`select id from (${sql.join(
		parts.map((part) => sql`(${part})`),
		sql` union all `,
	)}) vetoed`;
}

/**
 * 每一维取值最多取几个。这是一条**读语料的上限**，不是模型契约：这几维都是
 * 个位数到两位数量级，取 100 已经是「全都要」，它挡的是脏数据把一整列不同的
 * 公司名当成档位灌进 prompt。
 */
const VOCAB_MAX = 100;

/**
 * 词表里的取值各自来自哪张表。哪几维有词表由 `VOCAB_KEYS` 说，这里按它穷尽。
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
 * 查询理解能选择的语料取值。空值与 NOT_A_VALUE 不进词表；
 * 有序维按档高排列，其余按人数排列。各维在同一语料快照中读取。
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
				group by 1 order by ${
					isOrdinal(key) ? sql`min(${FACT_COLUMNS[`${key}Rank`]}), ` : sql``
				}n desc, value limit ${VOCAB_MAX}`);
			vocab[key] = rows.rows.map((row) => row.value);
		}
		return vocab;
	});
}

/**
 * 人员查询从 employee 产生候选，关联未被否决的工作经历供筛选与分面使用。
 * 没有工作经历时保留人员及空经历属性；背景门槛在 SQL 中独立求值。
 * 这条路径不产生经历证据或语义评分。
 */
async function searchPopulation(
	store: DbExecutor,
	spec: SearchSpec,
	prefer: readonly Gate[],
	view: SearchFilters,
	limit: number,
	veto: SQL | null,
	person: readonly SQL[],
): Promise<SearchOutcome> {
	const rows = await store.execute<PopulationRow>(sql`
		select p.emp_id, ${factSelect}
		from employee p left join experience e
		  on e.emp_id = p.emp_id and not e.unemployed
		  ${veto ? sql`and e.id not in (${veto})` : sql``}
		${whereAll(person)}
		order by p.emp_id, e.id limit ${FACT_MAX + 1}`);
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
	const facts: PopulationFact[] = rows.rows.map(({ emp_id, ...dims }) => ({
		...dims,
		empId: emp_id,
	}));
	// org / school 已经在 SQL 里按人过滤过，内存里不必再过滤一次
	const inMemory = { ...view, org: undefined, school: undefined };
	const empIdsAll = facts.map((f) => f.empId);
	const preferred = await Promise.all(
		prefer.map((g) => fetchPreferred(store, g, veto, empIdsAll)),
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
 * 在同一语料快照中完成取数、排序与分面。RPC 入参由 functions.ts 校验，脚本传入领域值。
 */
export async function search(
	/** 完整查询语义来自不可变记录；filters 只描述这一次怎样查看结果。 */
	spec: SearchSpec,
	filters: SearchFilters = {},
	/** 本次返回前多少人；每次翻页重新取得同一快照内排名的完整前缀。 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	const { claims, gates, prefer, excludes } = queryOf(spec.conditions);
	// 没有正向的主张也没有门槛时，排除自己不产出候选人。只有偏好的查询
	// （「最好是硕士」）是「所有人，满足偏好的在前」，照跑。
	if (claims.length === 0 && gates.length === 0 && prefer.length === 0)
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
	// 相关度过滤（要调两个模型端点）在快照外算，取数在快照内做，见 phrases.ts。
	// 正向的和排除的经历词一起做相关度过滤：它们查的是同一批说法，相关度门槛的差别在
	// vetoSql 里，不在这里。
	return withMatchedPhrases(
		[...claims, ...excludes].flatMap((c) => c.what ?? []),
		RELEVANCE_MIN,
		async (store, { phraseHits }) => {
			const veto = vetoSql(excludes, phraseHits);
			// 门槛和 URL 上的公司名 / 学校名都按人过滤，在每一条取数 SQL 里生效
			const person = [...gateConds(gates, veto), ...viewConds(filters)];
			// 只有门槛时没有做过什么可比，名单按人排，不伪造一条主张来启动检索。
			if (claims.length === 0)
				return searchPopulation(
					store,
					spec,
					prefer,
					filters,
					limit,
					veto,
					person,
				);

			const loaded = await fetchFacts(store, claims, phraseHits, [
				...person,
				...(veto ? [sql`e.id not in (${veto})`] : []),
			]);
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
			const facts = loaded.facts;
			const candidates = facts.map((f) => f.empId);
			const preferred = await Promise.all(
				prefer.map((g) => fetchPreferred(store, g, veto, candidates)),
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

/**
 * 一个标准词连同它的其他写法、它的细分，全部展开成 `(term, word)`。
 *
 * 人数是按这一堆词一起数的：`term` 是某一个标准词，`word` 是算进它那个数里的每一种
 * 写法——它自己、并进它的写法，以及它的细分连各自的写法，一层层往下。
 */
export const UNDER = sql`
	with recursive under(term, word) as (
		select canonical, word from skill_term
		union
		select u.term, a.word from under u
		join skill_term c on c.parent = u.word
		join skill_term a on a.canonical = c.word
	)`;

/**
 * 一个标准词底下有多少人，和筛选栏「入职前技能」同一口径：写了它、它的其他写法，
 * 或它任一项细分的人，各算一次。词表里的词有可能已经不在语料里（写它的人的简历
 * 改了），那就是 0。
 */
export function peopleUnder(term: SQL | string) {
	return sql`coalesce((
		select count(distinct e.emp_id)::int
		from under u
		join phrase p on p.text = u.word
		join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
		join experience e on e.id = ep.experience_id
		where u.term = ${term} and not e.unemployed), 0)`;
}

/** 一次给几条候选。下拉是用来挑的，不是用来翻的：再多就该多敲一个字。 */
const SUGGEST_MAX = 8;

/** 关键词候选只查询所属维度，前缀匹配优先，再按人数；经历词返回标准写法且不显示人数。 */
export async function suggest(
	field: KeywordField,
	needle: string,
): Promise<Suggestion[]> {
	const q = needle.trim();
	if (!q) return [];
	const contains = `%${escapeLike(q)}%`;
	const prefix = `${escapeLike(q)}%`;

	if (field === "what") {
		// 词表里写法和标准词都认，返回的是标准词；没人写过的词不给
		const { rows } = await db.execute<{ value: string }>(sql`
			${UNDER}
			select value from (
				select a.canonical as value, ${peopleUnder(sql`a.canonical`)} as people,
					bool_or(a.word ilike ${prefix}) as lead
				from skill_term a
				where a.word ilike ${contains}
				group by a.canonical
			) t
			where people > 0
			order by lead desc, people desc, value
			limit ${SUGGEST_MAX}`);
		return rows.map((r) => ({ value: r.value, people: null }));
	}

	const source =
		field === "org"
			? sql`select org as value, emp_id from experience where not unemployed and org ilike ${contains}`
			: sql`select school as value, emp_id from employee where school ilike ${contains}`;
	const { rows } = await db.execute<{ value: string; people: number }>(sql`
		select value, count(distinct emp_id)::int as people
		from (${source}) t
		where value <> ''
		group by value
		order by (value ilike ${prefix}) desc, people desc, value
		limit ${SUGGEST_MAX}`);
	return rows;
}
