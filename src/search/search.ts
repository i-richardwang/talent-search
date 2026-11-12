/**
 * 检索入口与人才库里的写法：按字面捞说法、查名字、词表、关键词候选，以及按一份记录检索（`search`）。
 * 取数、去重和打分在执行外壳（`execute.ts`）与 rank.ts，这里不按条件类型手写取数。
 */

import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { SHORT_ROUTES } from "#/db/schema";
import { type DbExecutor, withCorpusSnapshot } from "#/db/snapshot";
import { escapeLike } from "#/lib/sql";
import { catalogSchema, columnOf, rankOf } from "./catalog";
import type { NameField } from "./condition-label";
import { NOT_A_VALUE, VOCAB_KEYS, type VocabKey } from "./dimensions";
import { anyLike, execute, placeLike } from "./execute";
import type { Vocabulary } from "./intent";
import type { KeywordField } from "./keywords";
import type { SearchFilters } from "./params";
import { matching } from "./phrases";
import type { SearchOutcome, Suggestion } from "./result";
import { queryOfSpec, type SearchSpec } from "./spec";
import type { Matched, NameFinding, PatternFinding } from "./trace";
import { RESULT_PAGE } from "./weights";

type Place = "company" | "department";

/** 一段经历在哪的名字：入职前是公司名，公司内是末级部门名。 */
const PLACE_NAME: Record<Place, SQL> = {
	company: sql`e.company`,
	department: sql`e.department`,
};

/** 一个名字匹配到的写法最多给几个。 */
const MAX_TO_SHOW = 8;

/** 一条正则捞到的说法最多给几条。够模型看出捞到的是哪一类、有没有漏掉的叫法。 */
const MAX_FOUND = 40;

/**
 * 这几条正则各自按字面捞到多少种短说法、多少人，以及写的人最多的那些说法。和检索是同一种匹配
 * （`phrases.ts`）：不分大小写，在说法的文字上匹配；这里只列正则自己捞到的，不看算不算，也不带
 * 词表里的其他写法。没读过的简历原文不列出来，人数里也不算：它太长，看不出捞到的是什么。
 * 正则写不对或跑得太久的给出原因。
 */
export async function findPhrases(
	patterns: readonly string[],
): Promise<PatternFinding[]> {
	return withCorpusSnapshot(async (store) => {
		const out: PatternFinding[] = [];
		for (const pattern of new Set(patterns)) {
			// 一种说法一行，外加不分说法的合计那一行（`name` 为空）
			const found = await matching(store, () =>
				store.execute<{ name: string | null; people: number }>(sql`
					select p.text as name, count(distinct e.emp_id)::int as people
					from phrase p
					join experience_phrase ep on ep.phrase_id = p.id and ep.route <> 'description'
					join experience e on e.id = ep.experience_id and not e.unemployed
					where p.text ~* ${pattern}
					group by grouping sets ((p.text), ())
					order by people desc, p.text`),
			);
			if ("problem" in found) {
				out.push({
					pattern,
					phrases: 0,
					people: 0,
					top: [],
					problem: found.problem,
				});
				continue;
			}
			const top = found.value.rows.flatMap(({ name, people }) =>
				name === null ? [] : [{ name, people }],
			);
			out.push({
				pattern,
				phrases: top.length,
				people: found.value.rows.find((row) => row.name === null)?.people ?? 0,
				top: top.slice(0, MAX_FOUND),
				problem: null,
			});
		}
		return out;
	});
}

/**
 * 这些名字各能匹配到多少人、匹配到人才库里哪些公司或学校。
 *
 * 和搜索条件用同一套匹配：名字是专有名词，按包含匹配。公司按入职前经历的
 * 公司名（`placeLike`），部门按公司内任职的部门名和部门路径，学校按人员档案。
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
						where not e.unemployed and ${placeLike(field, [name])}`;
			const [people] = (
				await store.execute<{ n: number }>(sql`
				select count(distinct emp_id)::int as n from (${matched}) m`)
			).rows;
			const shown = await store.execute<Matched>(sql`
				select name, count(distinct emp_id)::int as people
				from (${matched}) m group by name
				order by people desc, name limit ${MAX_TO_SHOW}`);
			out.push({ query: name, people: people?.n ?? 0, values: shown.rows });
		}
		return out;
	});
}

/**
 * 有限取值列的全部取值和有这个值的人数：词表（`vocabulary`）和看目录（`server/discover.ts`）共用这一条
 * 语句。空值与 `NOT_A_VALUE` 不算取值；有高低的列按档高从低到高（`catalog.ts` 声明的 `rank`），
 * 其余人多的在前。数组列的每个取值各数各的。给了 `stream` 只数这一条记录流。
 */
export async function valuesOf(
	store: DbExecutor,
	relation: string,
	column: string,
	stream?: string,
): Promise<Matched[]> {
	const col = sql`t.${sql.identifier(column)}`;
	const rank = rankOf(relation, column);
	// 数组列（行业、名企组合）一行有几个取值，各算各的
	const value =
		columnOf(relation, column)?.type === "text[]"
			? sql`unnest(${col})`
			: sql`(values (${col}::text))`;
	const { rows } = await store.execute<Matched>(sql`
		select v.name, count(distinct t.emp_id)::int as people
		from ${sql.identifier(catalogSchema())}.${sql.identifier(relation)} t
		cross join lateral ${value} as v(name)
		where v.name is not null and v.name not in (${sql.join(
			["", ...NOT_A_VALUE].map((v) => sql`${v}`),
			sql`, `,
		)}) ${stream ? sql`and t.stream = ${stream}` : sql``}
		group by 1
		order by ${rank ? sql`min(t.${sql.identifier(rank)}), ` : sql``}people desc, name`);
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
	/** 这份记录所在的链头：确认过的经历只认这次找人任务里的。不在任何链上的为 null。 */
	rootTurnId: string | null,
	filters: SearchFilters = {},
	/** 本次返回前多少人；每次翻页重新取得同一快照内排名的完整前缀。 */
	limit: number = RESULT_PAGE,
): Promise<SearchOutcome> {
	return execute(queryOfSpec(spec), rootTurnId, filters, limit);
}

/** 一次给几条候选。下拉是用来挑的，不是用来翻的：再多就该多敲一个字。 */
const SUGGEST_MAX = 8;

/**
 * 关键词候选只查询所属维度，前缀匹配优先，再按人数。经历词给的是人才库里含这几个字的短说法
 * （词表里并了的给标准写法，判成不是能力的不给），不显示人数：搜的时候按字面包含匹配，找到的人比写这一条的多。
 */
export async function suggest(
	field: KeywordField,
	needle: string,
): Promise<Suggestion[]> {
	const q = needle.trim();
	if (!q) return [];
	const contains = `%${escapeLike(q)}%`;
	const prefix = `${escapeLike(q)}%`;

	if (field === "what") {
		const { rows } = await db.execute<{ value: string }>(sql`
			select coalesce(t.canonical, p.text) as value,
				count(distinct e.emp_id)::int as people,
				bool_or(p.text ilike ${prefix}) as lead
			from phrase p
			join experience_phrase ep on ep.phrase_id = p.id and ep.route in (${sql.join(
				SHORT_ROUTES.map((route) => sql`${route}`),
				sql`, `,
			)})
			join experience e on e.id = ep.experience_id and not e.unemployed
			left join term t on t.word = p.text
			where p.text ilike ${contains} and t.excluded is not true
			group by 1
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
