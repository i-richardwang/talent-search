import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db/snapshot";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";

/**
 * 标签页读的词，一律是此刻有人写的（`term_in_use`）：没人写的词留在词表里等它再出现，
 * 不在这一页上。一个语句里视图只算一遍，后面各段都读这一份 `u`。
 */
const IN_USE = sql`u as materialized (select word, people from term_in_use)`;

/**
 * 一项：标准词，或还没进词表的词。并进去的写法不成一项，它们在「其他写法」里；
 * 判成不是能力的词单独一张表（`excluded`），判错了的在那里才看得见。
 */
const headsOf = (excluded: boolean) => sql`heads as (
	select u.word, u.people, t.parent from u
	left join term t on t.word = u.word
	where (t.word is null or t.word = t.canonical)
		and coalesce(t.excluded, false) = ${excluded})`;

/** 每一项此刻有人写的其他写法。 */
const SPELLINGS = sql`spellings as (
	select a.canonical as head, a.word from term a
	join u on u.word = a.word
	where a.word <> a.canonical)`;

/** 这一项此刻有人写的其他写法，按字排。 */
const aliasesOf = (head: SQL) => sql`coalesce(
	(select array_agg(s.word order by s.word) from spellings s where s.head = ${head}),
	'{}')`;

/**
 * 这一项在不在等判定：按队列说，不按 `reviewed_at` 的空值说——没人写的词退回之后
 * 不会被收集，它不在等任何人。还没进词表的词也可能在队列里。
 */
const pendingOf = (head: SQL) => sql`(
	exists (select 1 from review_word r where r.word = ${head})
	or exists (select 1 from term a join review_word r on r.word = a.word
		where a.canonical = ${head}))`;

export type TermEntry = {
	canonical: string;
	/** 更宽的词；没有就是 null */
	parent: string | null;
	/** 此刻有人写的其他写法 */
	aliases: string[];
	/** 属于它、此刻有人写的标准词有几项；没有就是 0 */
	children: number;
	/** 写了这个词、它的其他写法或它任一项细分的人数，和筛选栏计数方法一致 */
	people: number;
	/** 这一项有词在队列里等着判 */
	pending: boolean;
};

export type TermDetail = Omit<TermEntry, "parent" | "children"> & {
	/** 判定方认定它不是一项能力：它不在筛选栏和候选词里，没有归属、细分和其他写法 */
	excluded: boolean;
	/** 更宽的词，连它那一层的人数；没有就是 null */
	parent: { canonical: string; people: number } | null;
	/** 属于它的标准词，人多的在前；每个各带自己那一支的人数 */
	children: { canonical: string; people: number }[];
};

/**
 * 标签页的表，服务端搜索并分页。匹配标准词、此刻有人写的其他写法与它属于的那个词。
 */
export function listTerms(
	needle: string,
	page: unknown,
	excluded: boolean,
): Promise<TablePage<TermEntry>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	/* 哪些词算搜到了，只说一遍：数总数和取这一页共用。 */
	const MATCHED = sql`with ${IN_USE}, ${headsOf(excluded)}, ${SPELLINGS},
		matched as (
			select h.* from heads h
			where h.word ilike ${pattern} or h.parent ilike ${pattern}
				or exists (select 1 from spellings s
					where s.head = h.word and s.word ilike ${pattern}))`;
	return withCorpusSnapshot(async (store) => {
		const found = await store.execute<{ n: number }>(
			sql`${MATCHED} select count(*)::int as n from matched`,
		);
		const total = found.rows[0]?.n ?? 0;
		const at = pageAt(total, page);
		const { rows } = await store.execute<TermEntry>(sql`${MATCHED}
			select
				m.word as canonical,
				m.parent,
				${aliasesOf(sql`m.word`)} as aliases,
				(select count(*)::int from term c join u on u.word = c.word
					where c.parent = m.word and c.word = c.canonical) as children,
				m.people,
				${pendingOf(sql`m.word`)} as pending
			from matched m
			order by m.people desc, m.word
			limit ${at.limit} offset ${at.offset}`);
		return tablePage(rows, total, at);
	});
}

/**
 * 一个词的详情，给标签页点开的那一层看。
 *
 * 传进来的可以是并进去的写法——地址栏是能手改的，而「数据分析能力」和「数据分析」
 * 在词表里是同一件事，那就把标准词那一份给出来，不是一句找不到。此刻没有人写的词
 * 才是 null。
 *
 * 更宽的那个词和每一项细分各带自己那一支的人数：这一层要答的是「这个词底下的人是从
 * 哪几支来的」，而光有名字答不了——顺着往下点之前，得先看得出哪一支下面有人。
 */
export function describeTerm(word: string): Promise<TermDetail | null> {
	return withCorpusSnapshot(async (store) => {
		const { rows } = await store.execute<TermDetail>(sql`
			with ${IN_USE}, ${SPELLINGS},
			named as (select coalesce(
				(select canonical from term where word = ${word}), ${word}) as word)
			select
				h.word as canonical,
				h.people,
				coalesce(t.excluded, false) as excluded,
				${aliasesOf(sql`h.word`)} as aliases,
				${pendingOf(sql`h.word`)} as pending,
				(select json_build_object('canonical', p.word, 'people', p.people)
					from u p where p.word = t.parent) as parent,
				/* 细分只认标准词那一行：并进去的写法不是细分，它们在「其他写法」里 */
				coalesce((
					select json_agg(json_build_object('canonical', c.word, 'people', cu.people)
						order by cu.people desc, c.word)
					from term c join u cu on cu.word = c.word
					where c.parent = h.word and c.word = c.canonical), '[]') as children
			from named n
			join u h on h.word = n.word
			left join term t on t.word = h.word`);
		return rows[0] ?? null;
	});
}
