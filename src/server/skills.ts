import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db/snapshot";
import { escapeLike } from "#/lib/sql";
import { PAGE_SIZE, pageAt, type TablePage, tablePage } from "./paging";

/** 一个标准词：它属于哪个更宽的词、并进来的写法、它和它的细分词一共多少人、上次整理的时间。 */
export type SkillEntry = {
	canonical: string;
	/** 更宽的词；没有就是 null */
	parent: string | null;
	aliases: string[];
	/** 属于它的标准词有几项；没有就是 0 */
	children: number;
	/** 写了这个词、它的其他写法或它任一项细分的人数，和筛选栏同一口径 */
	people: number;
	/** 上次整理这个词是几天前；0 是今天 */
	reviewedDaysAgo: number;
};

/** 一个标准词的全部关系：它是什么意思、往上属于谁、往下带着谁。 */
export type SkillDetail = Omit<SkillEntry, "parent" | "children"> & {
	/** 判定方给这个词写的那一句；还没写过是 null */
	gloss: string | null;
	/** 更宽的词，连它那一层的人数；没有就是 null */
	parent: { canonical: string; people: number } | null;
	/** 属于它的标准词，人多的在前；每个各带自己那一支的人数 */
	children: { canonical: string; people: number }[];
};

/**
 * 一个标准词连同它的其他写法、它的细分，全部展开成 `(term, word)`。
 *
 * 人数是按这一堆词一起数的：`term` 是某一个标准词，`word` 是算进它那个数里的每一种
 * 写法——它自己、并进它的写法，以及它的细分连各自的写法，一层层往下。
 */
const UNDER = sql`
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
function peopleUnder(term: SQL | string) {
	return sql`coalesce((
		select count(distinct e.emp_id)::int
		from under u
		join phrase p on p.text = u.word
		join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
		join experience e on e.id = ep.experience_id
		where u.term = ${term}), 0)`;
}

/** 属于这个标准词的标准词有几项。并进去的写法不算：那是同一件事的另一种写法。 */
function childrenOf(term: SQL) {
	return sql`(select count(*)::int from skill_term c
		where c.parent = ${term} and c.word = c.canonical)`;
}

/**
 * 能力词词表的一页，给管理页看。
 *
 * 只读：表由整理任务写（`src/corpus/vocabulary.ts`），这里不提供改它的路，改了下一轮整理
 * 就会被判定的结果盖回去。人数按标准词连同它的其他写法、它的细分一起数，和筛选栏
 * 「入职前技能」同一口径——「团队管理」的人数包含写了「人员管理」的人，「数据分析」的
 * 人数包含写了「销售数据分析」的人。判定方起的名字（语料里没人写过的更宽的词）也是一行，
 * 人数全部来自它的细分。「几天前」在库里算：页面直出和水合两边都不用碰时区。
 *
 * 找词和翻页都在服务端做，同数据页（`listEmployees`）：词表是一千多行，一次全发到页面
 * 要三兆多的 HTML，而过滤只作用于当前页的表是在骗人——搜出来的总数、第几页到第几页，
 * 说的必须是整个词表里的那些词。找词认三样：标准词、并进它的写法、它属于的那个更宽的词。
 */
export function listSkills(
	needle: string,
	page: unknown,
): Promise<TablePage<SkillEntry>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	return withCorpusSnapshot(async (store) => {
		/*
		 * 哪些词算搜到了，只说一遍：数总数和取这一页共用 `MATCHED`。数总数那一条
		 * 不碰人数——它是这里最贵的一段（每一行一次递归展开），而数行数用不着它。
		 */
		const MATCHED = sql`
			from skill_term a
			group by a.canonical
			having bool_or(a.word ilike ${pattern})
				or max(a.parent) filter (where a.word = a.canonical) ilike ${pattern}`;
		const found = await store.execute<{ n: number }>(
			sql`select count(*)::int as n from (select a.canonical ${MATCHED}) t`,
		);
		const total = found.rows[0]?.n ?? 0;
		const at = pageAt(total, page);
		const { rows } = await store.execute<SkillEntry>(sql`
			${UNDER}
			select
				a.canonical,
				max(a.parent) filter (where a.word = a.canonical) as parent,
				coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
				${peopleUnder(sql`a.canonical`)} as people,
				${childrenOf(sql`a.canonical`)} as children,
				(current_date - max(a.reviewed_at)::date)::int as "reviewedDaysAgo"
			${MATCHED}
			order by people desc, a.canonical
			limit ${PAGE_SIZE} offset ${at.offset}`);
		return tablePage(rows, total, at);
	});
}

/**
 * 一个词的详情，给技能页点开的那一层看。
 *
 * 传进来的可以是并进去的写法——地址栏是能手改的，而「数据分析能力」和「数据分析」
 * 在词表里是同一件事，那就把标准词那一份给出来，不是一句找不到。词表里没有这个词
 * 才是 null。
 *
 * 更宽的那个词和每一项细分各带自己那一支的人数：这一层要答的是「这个词底下的人是从
 * 哪几支来的」，而光有名字答不了——顺着往下点之前，得先看得出哪一支下面有人。
 */
export function skillDetail(word: string): Promise<SkillDetail | null> {
	return withCorpusSnapshot(async (store) => {
		const named = await store.execute<{ canonical: string }>(
			sql`select canonical from skill_term where word = ${word}`,
		);
		const canonical = named.rows[0]?.canonical;
		if (!canonical) return null;

		const self = await store.execute<
			Omit<SkillDetail, "parent" | "children"> & { parent: string | null }
		>(sql`
			${UNDER}
			select
				a.canonical,
				max(a.parent) filter (where a.word = a.canonical) as parent,
				coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
				${peopleUnder(sql`a.canonical`)} as people,
				(current_date - max(a.reviewed_at)::date)::int as "reviewedDaysAgo",
				(select g.gloss from phrase_gloss g where g.text = a.canonical) as gloss
			from skill_term a
			where a.canonical = ${canonical}
			group by a.canonical`);
		const row = self.rows[0];
		if (!row) return null;

		/* 细分只认标准词那一行：并进去的写法不是细分，它们在「其他写法」里。 */
		const under = await store.execute<{
			canonical: string;
			people: number;
		}>(sql`
			${UNDER}
			select c.word as canonical, ${peopleUnder(sql`c.word`)} as people
			from skill_term c
			where c.parent = ${canonical} and c.word = c.canonical
			order by people desc, c.word`);

		const above = row.parent
			? await store.execute<{ people: number }>(sql`
				${UNDER}
				select ${peopleUnder(row.parent)} as people`)
			: null;

		return {
			...row,
			children: under.rows,
			parent: row.parent
				? { canonical: row.parent, people: above?.rows[0]?.people ?? 0 }
				: null,
		};
	});
}
