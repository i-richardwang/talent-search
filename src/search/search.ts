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
import { db } from "#/db";
import { employee, experience } from "#/db/schema";
import { seqLabel } from "#/lib/format";
import type { Vocabulary } from "./intent";
import { sanitizeLimit } from "./params";
import { activeChips, parseQuery } from "./parse";
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
	type Overview,
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
 * 命中口径和检索完全相同（同一个 `admit`），否则量出来的宽和搜出来的宽不是一回事。
 */
export async function probeWide(texts: string[]): Promise<Set<string>> {
	if (texts.length === 0) return new Set();
	const admitted = await admit(texts, RELEVANCE_MIN);
	const rows = texts.flatMap((t, i) =>
		(admitted.get(t) ?? []).map((hit) => ({ termIdx: i, memberIdx: 0, hit })),
	);
	const table = admittedTable(rows);
	if (!table) return new Set();
	const wide = await db.execute<{ term_idx: number }>(sql`
		with total as (select count(distinct emp_id)::float as n from experience),
		q(term_idx, member_idx, phrase_id, relevance) as ${table}
		select q.term_idx from q
		join experience_phrase ep on ep.phrase_id = q.phrase_id
		join experience e on e.id = ep.experience_id, total
		group by q.term_idx, total.n
		having count(distinct e.emp_id) > total.n * ${WIDE_SHARE}`);
	return new Set(wide.rows.map((r) => texts[r.term_idx] as string));
}

type FactRow = {
	term_idx: number;
	member_idx: number;
	id: number;
	route: Route;
	relevance: number;
	emp_id: string;
	months: number;
	end_date: string | null;
	seq_l1: string;
	seq_l2: string;
	kind: "internal" | "external";
	company_tag: string | null;
	level: string;
	recruitment: string;
	education: string;
};

type PopulationRow = Pick<
	FactRow,
	| "emp_id"
	| "months"
	| "seq_l1"
	| "seq_l2"
	| "kind"
	| "company_tag"
	| "level"
	| "recruitment"
	| "education"
>;

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
 * 跟人走的精确条件（公司名 / 学校名）。它们是专有名词，永远不进向量：
 * 「字节」和「腾讯」在向量空间里是邻居，语义匹配会把竞品全捞进来。
 * 在取数里就按人裁掉，分面随之只数剩下的人——这正是「选了这一项之后
 * 还剩几人」该有的口径。
 */
function searchScope(
	f: SearchScope,
	view: Pick<SearchFilters, "org" | "school">,
): SQL {
	const conds: SQL[] = [];
	if (f.kind) conds.push(sql`e.kind = ${f.kind}`);
	if (f.minMonths) conds.push(sql`e.months >= ${f.minMonths}`);
	if (f.companyTag)
		conds.push(sql`e.org_meta ->> 'company_tag' = ${f.companyTag}`);
	if (f.level) conds.push(sql`p.cur_level = ${f.level}`);
	if (f.recruitment) conds.push(sql`p.recruitment = ${f.recruitment}`);
	if (f.education) conds.push(sql`p.education_level = ${f.education}`);
	if (f.org)
		conds.push(sql`exists (
			select 1 from experience x where x.emp_id = p.emp_id
			and (x.org ilike ${like(f.org)} or x.org_path ilike ${like(f.org)}))`);
	if (f.school) conds.push(sql`p.school ilike ${like(f.school)}`);
	if (view.org)
		conds.push(sql`exists (
			select 1 from experience x where x.emp_id = p.emp_id
			and (x.org ilike ${like(view.org)} or x.org_path ilike ${like(view.org)}))`);
	if (view.school) conds.push(sql`p.school ilike ${like(view.school)}`);
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
			e.emp_id, e.months, e.end_date, e.seq_l1, e.seq_l2, e.kind,
			e.org_meta ->> 'company_tag' as company_tag,
			p.cur_level as level, p.recruitment, p.education_level as education
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
	const rows = await db.execute<FactRow>(sql`
		select * from (${canonicalFacts(table, scope, view)}) facts
		limit ${FACT_MAX + 1}`);

	if (rows.rows.length > FACT_MAX) {
		const counts = await db.execute<{ term_idx: number; facts: number }>(sql`
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
		facts: rows.rows.map((r) => ({
			id: r.id,
			empId: r.emp_id,
			termIdx: r.term_idx,
			memberIdx: r.member_idx,
			route: r.route,
			relevance: Number(r.relevance),
			months: r.months,
			endDate: r.end_date,
			seqL1: r.seq_l1,
			seqL2: r.seq_l2,
			companyTag: r.company_tag,
			kind: r.kind,
			level: r.level,
			recruitment: r.recruitment,
			education: r.education,
		})),
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
async function fetchVetoed(texts: string[]): Promise<Set<number>> {
	if (texts.length === 0) return new Set();
	const admitted = await admit(texts, RELEVANCE_MIN_EXCLUDE);
	const table = admittedTable(
		texts.flatMap((t, i) =>
			(admitted.get(t) ?? []).map((hit) => ({ termIdx: i, memberIdx: 0, hit })),
		),
	);
	if (!table) return new Set();
	const rows = await db.execute<{ id: number }>(sql`
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
 * 查询理解能用的筛选词汇表——**语料里真实存在的取值**。
 *
 * 模型只能从这里挑，不许凭常识造一个「一线大厂」或「P8」出来：造出来的值
 * 筛不到任何人，而界面上那一维会显示成一个选中了却空着的筛选。语料就是词典。
 * 空串与「未知」不是取值。
 */
export async function vocabulary(): Promise<Vocabulary> {
	const column = async (expr: SQL, from: SQL) => {
		const rows = await db.execute<{ v: string }>(sql`
			select v from (select ${expr} as v, count(*) as n from ${from} group by 1) c
			where v is not null and v not in ('', '未知')
			order by n desc, v limit ${VOCAB_MAX}`);
		return rows.rows.map((r) => r.v);
	};
	const [companyTags, levels, recruitments, educations] = await Promise.all([
		column(sql`org_meta ->> 'company_tag'`, sql`experience`),
		column(sql`cur_level`, sql`employee`),
		column(sql`recruitment`, sql`employee`),
		column(sql`education_level`, sql`employee`),
	]);
	return { companyTags, levels, recruitments, educations };
}

/** 零态的词汇表最多给几个。一屏之内扫得完，再多就成了要读的正文。 */
const OVERVIEW_SEQS = 12;

/**
 * 语料概览：库有多大，以及这个库认识哪些词（见 result.ts 的 `Overview`）。
 *
 * 词汇表取二级序列，但**只留能原样当概念词用的那些**：`parseQuery` 会把
 * 「安全与风险合规」按连接词「与」切成两个词，于是点一下得到的查询和屏幕上
 * 写的那个词不是同一回事。零态的全部作用是给人一个可靠的起点，给出一个
 * 点下去就变形的起点比不给更糟，所以这里拿 `parseQuery` 自己做一次体检，
 * 过不了的直接不出现。
 */
export async function overview(): Promise<Overview> {
	const [scale, seqs] = await Promise.all([
		db.execute<{ people: number; segments: number }>(sql`
			select count(distinct emp_id)::int as people, count(*)::int as segments
			from experience`),
		// 多取一些再筛：体检刷掉几个之后仍然要能凑满一屏
		db.execute<{ seq_l2: string }>(sql`
			select seq_l2, count(distinct emp_id) as n from experience
			where seq_l2 <> '' group by seq_l2
			order by n desc limit ${OVERVIEW_SEQS * 3}`),
	]);
	const clean = seqs.rows
		.map((r) => r.seq_l2)
		.filter((name) => {
			const terms = parseQuery(name);
			return terms.length === 1 && terms[0] === name;
		});
	return {
		people: scale.rows[0]?.people ?? 0,
		segments: scale.rows[0]?.segments ?? 0,
		seqs: clean.slice(0, OVERVIEW_SEQS),
	};
}

/**
 * 无语义要求时，每段符合查询范围的经历就是一条人口事实。它没有 route、相关度
 * 或证据段身份，不参与语义打分与证据展示；只用于人员筛选和分面计数。
 */
async function searchScopeOnly(
	scope: SearchScope,
	view: SearchFilters,
	limit: number,
): Promise<SearchOutcome> {
	const rows = await db.execute<PopulationRow>(sql`
		select e.emp_id, e.months, e.seq_l1, e.seq_l2, e.kind,
			e.org_meta ->> 'company_tag' as company_tag,
			p.cur_level as level, p.recruitment, p.education_level as education
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
			overflow: { kind: "population" },
		};
	const facts: PopulationFact[] = rows.rows.map((row) => ({
		empId: row.emp_id,
		months: row.months,
		seqL1: row.seq_l1,
		seqL2: row.seq_l2,
		companyTag: row.company_tag,
		kind: row.kind,
		level: row.level,
		recruitment: row.recruitment,
		education: row.education,
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
			: await db
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
		results: pageIds.flatMap((empId) => {
			const person = byId.get(empId);
			return person ? [{ employee: person }] : [];
		}),
		facets,
		total,
		overflow: null,
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
	const active = activeChips(spec.evidence);
	const terms: TermPlan[] = active.flatMap((c) =>
		c.mode === "exclude"
			? []
			: [{ term: c.term, members: [c.term, ...(c.alts ?? [])], mode: c.mode }],
	);
	const vetoTexts = active.flatMap((c) =>
		c.mode === "exclude" ? [c.term, ...(c.alts ?? [])] : [],
	);
	// 结构化范围本身就是完整的候选定义，不需要伪造一个向量词来启动检索。
	if (terms.length === 0 && Object.keys(spec.scope).length > 0)
		return searchScopeOnly(spec.scope, filters, sanitizeLimit(limit));
	// 没有正向证据也没有结构化范围时，排除词自己不产出候选人。
	if (terms.length === 0)
		return {
			order: "relevance",
			terms: [],
			results: [],
			facets: emptyFacets(),
			total: 0,
			overflow: null,
		};

	// 正向要求的判定与否决段集合互不依赖，同时发出去
	const [admitted, vetoed] = await Promise.all([
		admit(
			terms.flatMap((t) => t.members),
			RELEVANCE_MIN,
		),
		fetchVetoed(vetoTexts),
	]);
	const loaded = await fetchFacts(terms, admitted, spec.scope, filters);
	if (loaded.kind === "overflow") {
		const contributors = new Set(loaded.termIndexes);
		return {
			order: "relevance",
			terms,
			results: [],
			facets: emptyFacets(),
			total: 0,
			overflow: {
				kind: "evidence",
				terms: terms
					.filter((_, index) => contributors.has(index))
					.map((term) => term.term),
			},
		};
	}
	const facts = vetoed.size
		? loaded.facts.filter((f) => !vetoed.has(f.id))
		: loaded.facts;

	const { ranked, facets, total } = rank(facts, terms, filters, new Date());
	const page = ranked.slice(0, sanitizeLimit(limit));
	if (page.length === 0)
		return {
			order: "relevance",
			terms,
			results: [],
			facets,
			total,
			overflow: null,
		};

	const empIds = page.map((r) => r.empId);
	const evidence = pageHits(facts, filters, new Set(empIds), HITS_PER_TERM);

	// 名次确定后按 id 读取展示原文；命中判定只产生事实，不承担内容读取。
	const ids = [...new Set([...evidence.values()].flat().map((f) => f.id))];
	const [segments, employees] = await Promise.all([
		db.select().from(experience).where(inArray(experience.id, ids)),
		db
			.select({
				empId: employee.empId,
				name: employee.name,
				curDept: employee.curDept,
				curTitle: employee.curTitle,
				curLevel: employee.curLevel,
			})
			.from(employee)
			.where(inArray(employee.empId, empIds)),
	]);

	const segById = new Map(segments.map((s) => [s.id, s]));
	const empById = new Map(employees.map((e) => [e.empId, e]));

	const results: RankedResult[] = [];
	for (const row of page) {
		const emp = empById.get(row.empId);
		if (!emp) continue;
		const hits: Hit[] = [];
		for (const f of evidence.get(row.empId) ?? []) {
			const s = segById.get(f.id);
			const plan = terms[f.termIdx];
			if (!s || !plan) continue;
			hits.push({
				experienceId: s.id,
				term: plan.term,
				member: plan.members[f.memberIdx] ?? plan.term,
				route: f.route,
				relevance: f.relevance,
				kind: s.kind,
				startDate: s.startDate,
				endDate: s.endDate,
				org: s.org,
				title: s.title,
				seq: seqLabel(s.seqL1, s.seqL2, s.seqL3),
				months: s.months,
			});
		}
		results.push({ employee: emp, score: row.score, basis: row.basis, hits });
	}
	return {
		order: "relevance",
		terms,
		results,
		facets,
		total,
		overflow: null,
	};
}
