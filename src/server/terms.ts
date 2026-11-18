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

/** 每一项此刻有人写的细分（更窄的词），各带人数。 */
const NARROWER = sql`narrower as (
	select t.parent as head, t.word, u.people from term t
	join u on u.word = t.word
	where t.parent is not null)`;

/** 这几项此刻有人写的其他写法，一项一行，按字排。 */
const aliasesOf = (heads: SQL) => sql`
	select head, array_agg(word order by word) as aliases
	from spellings where head in (${heads}) group by head`;

/**
 * 有词在等判定的项：按队列说，不按 `reviewed_at` 的空值说——没人写的词退回之后
 * 不会被收集，它不在等任何人。队列里的词落到它所在的那一项；还没进词表的词就是它自己。
 */
const QUEUED = sql`queued as (
	select coalesce(t.canonical, r.word) as head from review_word r
	left join term t on t.word = r.word)`;

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
		const { rows } =
			await store.execute<TermEntry>(sql`${MATCHED}, ${NARROWER}, ${QUEUED},
			/* 先定这一页是哪几项，其他写法、细分和判定只给这几项算 */
			shown as (
				select * from matched order by people desc, word
				limit ${at.limit} offset ${at.offset})
			select
				s.word as canonical,
				s.parent,
				coalesce(a.aliases, '{}') as aliases,
				coalesce(c.children, 0) as children,
				s.people,
				s.word in (select head from queued) as pending
			from shown s
			left join (${aliasesOf(sql`select word from shown`)}) a on a.head = s.word
			left join (
				select head, count(*)::int as children from narrower
				where head in (select word from shown) group by head) c on c.head = s.word
			order by s.people desc, s.word`);
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
			with ${IN_USE}, ${SPELLINGS}, ${NARROWER}, ${QUEUED},
			named as (select coalesce(
				(select canonical from term where word = ${word}), ${word}) as word)
			select
				h.word as canonical,
				h.people,
				coalesce(t.excluded, false) as excluded,
				coalesce(a.aliases, '{}') as aliases,
				h.word in (select head from queued) as pending,
				(select json_build_object('canonical', p.word, 'people', p.people)
					from u p where p.word = t.parent) as parent,
				coalesce((
					select json_agg(json_build_object('canonical', d.word, 'people', d.people)
						order by d.people desc, d.word)
					from narrower d where d.head = h.word), '[]') as children
			from named n
			join u h on h.word = n.word
			left join term t on t.word = h.word
			left join (${aliasesOf(sql`select word from named`)}) a on a.head = h.word`);
		return rows[0] ?? null;
	});
}
