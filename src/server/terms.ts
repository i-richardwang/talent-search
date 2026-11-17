import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { SHORT_ROUTES } from "#/db/schema";
import { withCorpusSnapshot } from "#/db/snapshot";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";

/**
 * 一批标准词各自底下有多少人，给出 `(term, people)` 的一张表；`terms` 是这批词，一个值或一条查询。
 * 底下没有人的词不在表里。
 *
 * 一个词底下的人：短说法里写了它、它的其他写法，或它任一项细分（连细分的写法，一层层往下）的人，
 * 各算一次。这是词表页呈现一支词有多大用的数；检索不顺着词表往下带。词表里的词有可能已经
 * 不在语料里（写它的人的简历改了），那就没有人。只从这批词往下展开、整批一起数，花的工夫跟着
 * 要的词数走。
 */
function peopleUnder(terms: SQL) {
	return sql`
		with recursive under(term, word) as (
			select canonical, word from term where canonical in (${terms})
			union
			select u.term, a.word from under u
			join term c on c.parent = u.word
			join term a on a.canonical = c.word
		)
		select u.term, count(distinct e.emp_id)::int as people
		from under u
		join phrase p on p.text = u.word
		join experience_phrase ep on ep.phrase_id = p.id and ep.route in (${sql.join(
			SHORT_ROUTES.map((route) => sql`${route}`),
			sql`, `,
		)})
		join experience e on e.id = ep.experience_id and not e.unemployed
		group by u.term`;
}

export type TermEntry = {
	canonical: string;
	/** 更宽的词；没有就是 null */
	parent: string | null;
	aliases: string[];
	/** 属于它的标准词有几项；没有就是 0 */
	children: number;
	/** 写了这个词、它的其他写法或它任一项细分的人数，和筛选栏计数方法一致 */
	people: number;
	/** 这一项有词在队列里等着判 */
	pending: boolean;
};

/**
 * 这一项在不在等判定：按队列说，不按 `reviewed_at` 的空值说——没人写的词退回之后
 * 不会被收集，它不在等任何人。
 */
const PENDING = sql`bool_or(exists (select 1 from review_word r where r.word = a.word))`;

/**
 * 每个词底下有几项属于它的标准词，给出 `(parent, children)`。并进去的写法不算：那是同一件事的
 * 另一种写法。
 */
const CHILDREN = sql`select parent, count(*)::int as children from term
	where word = canonical group by parent`;

export type TermDetail = Omit<TermEntry, "parent" | "children"> & {
	/** 判定方认定它不是一项能力：它不在筛选栏和候选词里，没有归属、细分和其他写法 */
	excluded: boolean;
	/** 更宽的词，连它那一层的人数；没有就是 null */
	parent: { canonical: string; people: number } | null;
	/** 属于它的标准词，人多的在前；每个各带自己那一支的人数 */
	children: { canonical: string; people: number }[];
};

/**
 * 管理页的标准能力词列表，服务端搜索并分页。
 * 匹配标准词、别名与父词；人数包含别名和全部后代，与筛选栏共用统计。
 * 判定方命名的父词同样参与展示。判成不是能力的词不是标签，单独一张表（`excluded`）：
 * 判错了的在那里才看得见。
 */
export function listTerms(
	needle: string,
	page: unknown,
	excluded: boolean,
): Promise<TablePage<TermEntry>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	return withCorpusSnapshot(async (store) => {
		/* 哪些词算搜到了，只说一遍：数总数和取这一页共用 `MATCHED`。 */
		const MATCHED = sql`
			from term a
			where a.excluded = ${excluded}
			group by a.canonical
			having bool_or(a.word ilike ${pattern})
				or max(a.parent) filter (where a.word = a.canonical) ilike ${pattern}`;
		const found = await store.execute<{ n: number }>(
			sql`select count(*)::int as n from (select a.canonical ${MATCHED}) t`,
		);
		const total = found.rows[0]?.n ?? 0;
		const at = pageAt(total, page);
		const { rows } = await store.execute<TermEntry>(sql`
			with matched as (
				select
					a.canonical,
					max(a.parent) filter (where a.word = a.canonical) as parent,
					coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
					${PENDING} as pending
				${MATCHED}
			)
			select
				m.*,
				coalesce(p.people, 0) as people,
				coalesce(c.children, 0) as children
			from matched m
			left join (${peopleUnder(sql`select canonical from matched`)}) p on p.term = m.canonical
			left join (${CHILDREN}) c on c.parent = m.canonical
			order by people desc, m.canonical
			limit ${at.limit} offset ${at.offset}`);
		return tablePage(rows, total, at);
	});
}

/**
 * 一个词的详情，给词表页点开的那一层看。
 *
 * 传进来的可以是并进去的写法——地址栏是能手改的，而「数据分析能力」和「数据分析」
 * 在词表里是同一件事，那就把标准词那一份给出来，不是一句找不到。词表里没有这个词
 * 才是 null。
 *
 * 更宽的那个词和每一项细分各带自己那一支的人数：这一层要答的是「这个词底下的人是从
 * 哪几支来的」，而光有名字答不了——顺着往下点之前，得先看得出哪一支下面有人。
 */
export function describeTerm(word: string): Promise<TermDetail | null> {
	return withCorpusSnapshot(async (store) => {
		const named = await store.execute<{ canonical: string }>(
			sql`select canonical from term where word = ${word}`,
		);
		const canonical = named.rows[0]?.canonical;
		if (!canonical) return null;

		const self = await store.execute<
			Omit<TermDetail, "parent" | "children"> & { parent: string | null }
		>(sql`
			select
				a.canonical,
				max(a.parent) filter (where a.word = a.canonical) as parent,
				coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
				coalesce((select people from (${peopleUnder(sql`${canonical}`)}) p), 0) as people,
				bool_or(a.excluded) as excluded,
				${PENDING} as pending
			from term a
			where a.canonical = ${canonical}
			group by a.canonical`);
		const row = self.rows[0];
		if (!row) return null;

		/* 细分只认标准词那一行：并进去的写法不是细分，它们在「其他写法」里。 */
		const under = await store.execute<{
			canonical: string;
			people: number;
		}>(sql`
			select c.word as canonical, coalesce(p.people, 0) as people
			from term c
			left join (${peopleUnder(sql`select word from term where parent = ${canonical}`)}) p on p.term = c.word
			where c.parent = ${canonical} and c.word = c.canonical
			order by people desc, c.word`);

		const above = row.parent
			? await store.execute<{ people: number }>(sql`
				select coalesce((select people from (${peopleUnder(sql`${row.parent}`)}) p), 0) as people`)
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
