/**
 * 关键词模式下拉里的候选：用户敲了几个字，库里有哪些写法。
 *
 * 三个框各查各的一维，候选不混：经历或技能查能力词表的标准词，公司或部门查经历上
 * 登记的名字（外部是公司名，内部是末级部门），学校查人员表。都是精确的包含匹配，
 * 以这几个字开头的排前面，再按人数。
 *
 * 经历或技能的候选不带人数：按这个词搜是按意思找，找到的人比写过这个词的多，
 * 摆一个写过它的人数只会让人以为那就是会搜出来的人数。公司和学校按名字包含去筛，
 * 候选的人数是按这一个名字数的，说的就是这件事。
 */
import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { db } from "#/db";
import { escapeLike } from "#/lib/sql";
import type { KeywordField } from "#/search/keywords";
import { peopleUnder, UNDER } from "./skills";

export type Suggestion = { value: string; people: number | null };

/** 一次给几条候选。下拉是用来挑的，不是用来翻的：再多就该多敲一个字。 */
const SUGGEST_MAX = 8;

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
			? sql`select org as value, emp_id from experience where org ilike ${contains}`
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
