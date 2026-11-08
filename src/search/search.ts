/**
 * 检索入口与词表匹配：查经历词、查名字、词表、关键词候选，以及按一份记录检索（`search`）。
 * 取数、去重和打分在执行外壳（`execute.ts`）与 rank.ts，这里不按条件类型手写取数。
 *
 * 模型重排在快照外完成，取事实的快照重新召回、核对空间及完整候选文本的分数。
 */

import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { SHORT_ROUTES } from "#/db/schema";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import { escapeLike } from "#/lib/sql";
import { catalogSchema, rankOf } from "./catalog";
import type { NameField } from "./condition-label";
import { NOT_A_VALUE, VOCAB_KEYS, type VocabKey } from "./dimensions";
import { execute } from "./execute";
import type { Vocabulary } from "./intent";
import type { KeywordField } from "./keywords";
import type { SearchFilters } from "./params";
import { phraseHitTable, withMatchedPhrases } from "./phrases";
import type { SearchOutcome, Suggestion } from "./result";
import { queryOfSpec, type SearchSpec } from "./spec";
import type { Matched, NameFinding, TermFinding } from "./trace";
import { RELEVANCE_MIN, RESULT_PAGE } from "./weights";

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

type Place = "company" | "department";

/** 一段经历在哪的名字：入职前是公司名，公司内是末级部门名。 */
const PLACE_NAME: Record<Place, SQL> = {
	company: sql`e.company`,
	department: sql`e.department`,
};

/**
 * 这一段的公司名含其中一个，或部门名、部门路径含其中一个。公司名和部门名是专有名词，
 * 按包含匹配，不进向量；和检索条件编译出的谓词同一种写法（`compile.ts`）。
 */
function placeCond(field: Place, names: readonly string[]) {
	return sql`(${anyLike(
		names,
		field === "company"
			? [PLACE_NAME.company]
			: [PLACE_NAME.department, sql`e.department_path`],
	)})`;
}

/**
 * 发给查询理解模型的能力词和公司、学校名，至少这么多人写过才发。冷僻的写法和小公司的
 * 名字连同人数一起发出去，就能反推出是哪个人；而查询理解的端点可以在公网上。
 */
const MIN_PEOPLE_TO_SHOW = 5;

/** 一个词命中的标准能力词、一个名字匹配到的公司或学校，各最多给几个。 */
const MAX_TO_SHOW = 8;

/** 一个能力词更细的几个词最多给几个。 */
const MAX_NARROWER = 5;

/**
 * 经历词的命中人数与标准能力词，和搜索共用召回、相关度门槛及经历边。
 * 人数按员工去重，不带视图筛选。
 * 仅向模型展示至少 MIN_PEOPLE_TO_SHOW 人使用的标准能力词，最多 MAX_TO_SHOW 项；
 * 每个能力词带上它在词表里更宽和更细的词，人数按检索顺着词表往下带的同一批人算
 * （`peopleUnder`），门槛相同。
 * 这里采用正向门槛；排除主张使用更严格的 RELEVANCE_MIN_EXCLUDE。
 */
export async function lookupExperience(
	texts: string[],
): Promise<TermFinding[]> {
	const asked = [...new Set(texts)];
	if (asked.length === 0) return [];
	return withMatchedPhrases(
		asked,
		RELEVANCE_MIN,
		async (store, { phraseHits }) => {
			const out = asked.map(
				(text): TermFinding => ({ text, people: 0, terms: [] }),
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
			for (const row of counts.rows) {
				const r = out[row.claim_idx];
				if (r) r.people = row.people;
			}
			const terms = await store.execute<{
				claim_idx: number;
				name: string;
				people: number;
				broader: string | null;
				narrower: string[];
			}>(sql`
			${UNDER},
			q(claim_idx, value_idx, phrase_id, relevance) as ${table},
			hit as (
				select q.claim_idx, coalesce(t.canonical, ph.text) as name,
					count(distinct e.emp_id)::int as people, max(q.relevance) as relevance
				from q
				join experience_phrase ep on ep.phrase_id = q.phrase_id and ep.route = 'skill'
				join phrase ph on ph.id = ep.phrase_id
				left join term t on t.word = ph.text
				join experience e on e.id = ep.experience_id
				where not e.unemployed
				group by q.claim_idx, 2
				having count(distinct e.emp_id) >= ${MIN_PEOPLE_TO_SHOW}
			),
			shown as (
				select * from (
					select *, row_number() over (
						partition by claim_idx order by relevance desc, people desc, name
					) as n from hit
				) ranked where n <= ${MAX_TO_SHOW}
			)
			select s.claim_idx, s.name, s.people,
				case when ${peopleUnder(sql`t.parent`)} >= ${MIN_PEOPLE_TO_SHOW}
					then t.parent end as broader,
				array(
					select c.word from term c
					where c.parent = s.name and ${peopleUnder(sql`c.word`)} >= ${MIN_PEOPLE_TO_SHOW}
					order by ${peopleUnder(sql`c.word`)} desc, c.word
					limit ${MAX_NARROWER}
				) as narrower
			from shown s left join term t on t.word = s.name
			order by s.claim_idx, s.n`);
			for (const row of terms.rows)
				out[row.claim_idx]?.terms.push({
					name: row.name,
					people: row.people,
					broader: row.broader,
					narrower: row.narrower,
				});
			return out;
		},
	);
}

/**
 * 这些名字各能匹配到多少人、匹配到人才库里哪些公司或学校。
 *
 * 和搜索条件用同一套匹配：名字是专有名词，按包含匹配，不用向量。公司按入职前经历的
 * 公司名（`placeCond`），部门按公司内任职的部门名和部门路径，学校按人员档案。
 * 部门名是内部信息，只算人数，不给写法；公司名和学校名写的人少于
 * `MIN_PEOPLE_TO_SHOW` 的不给。
 */
export async function lookupNames(
	field: NameField,
	names: string[],
): Promise<NameFinding[]> {
	const asked = [...new Set(names)];
	return withCorpusSnapshot(async (store) => {
		const out: NameFinding[] = [];
		for (const name of asked) {
			const matched =
				field === "school"
					? sql`select p.school as name, p.emp_id from employee p
						where ${anyLike([name], [sql`p.school`])}`
					: sql`select ${PLACE_NAME[field]} as name, e.emp_id from experience e
						where not e.unemployed and ${placeCond(field, [name])}`;
			const [people] = (
				await store.execute<{ n: number }>(sql`
				select count(distinct emp_id)::int as n from (${matched}) m`)
			).rows;
			const shown =
				field === "department"
					? []
					: (
							await store.execute<Matched>(sql`
							select name, count(distinct emp_id)::int as people
							from (${matched}) m group by name
							having count(distinct emp_id) >= ${MIN_PEOPLE_TO_SHOW}
							order by people desc, name limit ${MAX_TO_SHOW}`)
						).rows;
			out.push({ query: name, people: people?.n ?? 0, values: shown });
		}
		return out;
	});
}

/**
 * 一列最多列几个取值。这是一条**读语料的上限**，不是模型契约：有限取值的列都是个位数到
 * 两位数量级，取 100 已经是「全都要」，它挡的是脏数据把一整列不同的公司名当成档位灌进 prompt。
 */
const LISTED_MAX = 100;

/**
 * 一列的取值和有这个值的人数：词表（`vocabulary`）和看目录（`server/discover.ts`）共用这一条
 * 语句。空值与 `NOT_A_VALUE` 不算取值；有高低的列按档高从低到高（`catalog.ts` 声明的 `rank`），
 * 其余人多的在前。给了 `stream` 只数这一条记录流。
 */
export async function valuesOf(
	store: DbExecutor,
	relation: string,
	column: string,
	stream?: string,
): Promise<Matched[]> {
	const col = sql.identifier(column);
	const rank = rankOf(relation, column);
	const { rows } = await store.execute<Matched>(sql`
		select ${col}::text as name, count(distinct emp_id)::int as people
		from ${sql.identifier(catalogSchema())}.${sql.identifier(relation)}
		where ${col} is not null and ${col}::text not in (${sql.join(
			["", ...NOT_A_VALUE].map((v) => sql`${v}`),
			sql`, `,
		)}) ${stream ? sql`and stream = ${stream}` : sql``}
		group by 1
		order by ${rank ? sql`min(${sql.identifier(rank)}), ` : sql``}people desc, name
		limit ${LISTED_MAX}`);
	return rows;
}

/**
 * 词表里的取值各自读数据目录的哪一列。哪几维有词表由 `VOCAB_KEYS` 说，这里按它穷尽。
 * 取值表达式只在目录视图里写一次（`db/schema.ts`），检索读的是同一份。
 */
const VOCAB_COLUMN: Record<
	VocabKey,
	{ relation: "person" | "experience"; column: string }
> = {
	companyTag: { relation: "experience", column: "company_tag" },
	level: { relation: "person", column: "level_band" },
	recruitment: { relation: "person", column: "recruitment" },
	education: { relation: "person", column: "education" },
	schoolTier: { relation: "person", column: "school_tier" },
	overseas: { relation: "person", column: "overseas" },
};

/** 查询理解能选择的语料取值和有这个值的人数（`valuesOf`）。各维在同一语料快照中读取。 */
export async function vocabulary(): Promise<Vocabulary> {
	return withCorpusSnapshot(async (store) => {
		const vocab = {} as { [K in VocabKey]: Matched[] };
		for (const key of VOCAB_KEYS) {
			const { relation, column } = VOCAB_COLUMN[key];
			vocab[key] = await valuesOf(store, relation, column);
		}
		return vocab;
	});
}

/**
 * 一份记录的查询交给执行外壳（`execute.ts`）；关键词链形状的条件表读取时编译（`spec.ts`）。
 */
export function search(
	/** 完整查询语义来自不可变记录；filters 只描述这一次怎样查看结果。 */
	spec: SearchSpec,
	filters: SearchFilters = {},
	/** 本次返回前多少人；每次翻页重新取得同一快照内排名的完整前缀。 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	return execute(queryOfSpec(spec), filters, limit);
}

/**
 * 一个标准词连同它的其他写法、它的细分，全部展开成 `(term, word)`。
 *
 * 人数是按这一堆词一起数的：`term` 是某一个标准词，`word` 是算进它那个数里的每一种
 * 写法——它自己、并进它的写法，以及它的细分连各自的写法，一层层往下。
 */
export const UNDER = sql`
	with recursive under(term, word) as (
		select canonical, word from term
		union
		select u.term, a.word from under u
		join term c on c.parent = u.word
		join term a on a.canonical = c.word
	)`;

/**
 * 一个标准词底下有多少人，和检索顺着词表往下带的是同一批：短说法里写了它、它的其他写法，
 * 或它任一项细分的人，各算一次。词表里的词有可能已经不在语料里（写它的人的简历
 * 改了），那就是 0。
 */
export function peopleUnder(term: SQL | string) {
	return sql`coalesce((
		select count(distinct e.emp_id)::int
		from under u
		join phrase p on p.text = u.word
		join experience_phrase ep on ep.phrase_id = p.id and ep.route in (${sql.join(
			SHORT_ROUTES.map((route) => sql`${route}`),
			sql`, `,
		)})
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
				from term a
				where a.word ilike ${contains}
				group by a.canonical
			) t
			where people > 0
			order by lead desc, people desc, value
			limit ${SUGGEST_MAX}`);
		return rows.map((r) => ({ value: r.value, people: null }));
	}

	const source =
		field === "school"
			? sql`select school as value, emp_id from employee where school ilike ${contains}`
			: sql`select ${PLACE_NAME[field]} as value, e.emp_id from experience e
				where not e.unemployed and ${PLACE_NAME[field]} ilike ${contains}`;
	const { rows } = await db.execute<{ value: string; people: number }>(sql`
		select value, count(distinct emp_id)::int as people
		from (${source}) t
		where value <> ''
		group by value
		order by (value ilike ${prefix}) desc, people desc, value
		limit ${SUGGEST_MAX}`);
	return rows;
}
