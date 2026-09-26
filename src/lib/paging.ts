/**
 * 管理页的表怎么分页。三张表（人、能力词、每类任务的运行记录）共用同一套算术：
 * 地址上的页码怎么读、给出的是第几页、从第几行起取几行。人和能力词一页
 * `PAGE_SIZE` 行；任务卡上的运行记录是卡片里的一小张表，页大小由 `server/tasks.ts`
 * 传进 `pageAt`。服务端按它取数，设计系统按它给样例分页。
 *
 * **页码由服务端定夺，不是照抄地址栏里的那个数**：搜过一次再改词，剩下的行可能
 * 填不满原来那么多页，而一个越界的页码在表上就是一张空表。越界收回最后一页。
 */

/** 人和能力词的表一页多少行。管理页的表都是「一直往后翻到底」的读法，一屏放得下一批就够。 */
export const PAGE_SIZE = 50;

/** 一张表的一页，连它和全部的关系。页面照这个形状画表脚。 */
export type TablePage<T> = {
	/** 一共多少行；有搜索词时是搜出来的那些 */
	total: number;
	/** 一共分几页，至少一页 */
	pages: number;
	/** 这一页的第一行在全部结果里排第几，从 1 起；一行都没有时是 0 */
	from: number;
	/** 给出的是第几页，从 1 起 */
	page: number;
	rows: T[];
};

/** 某一页落到实处：第几页、一共几页，SQL 跳过多少行、取几行。 */
type PageSlice = {
	page: number;
	pages: number;
	offset: number;
	limit: number;
};

/**
 * 地址栏上写的是第几页，什么值都可能进来。第一页是 `undefined`——默认值不写进地址，
 * 否则刚进来的链接和翻回第一页的链接是两个不同的字符串（检索那边同一条规矩，见
 * `routes/s/$turnId/-lib/view-params.ts`）。越界不在这里收：一共几页要等 `pageAt`
 * 知道总数。
 */
export function pageParam(value: unknown): number | undefined {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) && n > 1 ? n : undefined;
}

/** 想看第几页（`want` 来自地址栏）落到实处，越界收回最后一页。 */
export function pageAt(
	total: number,
	want: unknown,
	size: number = PAGE_SIZE,
): PageSlice {
	const pages = Math.max(1, Math.ceil(total / size));
	const page = Math.min(pageParam(want) ?? 1, pages);
	return { limit: size, offset: (page - 1) * size, page, pages };
}

/** 一页行连它和全部的关系，给页面的那一份。 */
export function tablePage<T>(
	rows: T[],
	total: number,
	at: PageSlice,
): TablePage<T> {
	return {
		from: rows.length === 0 ? 0 : at.offset + 1,
		page: at.page,
		pages: at.pages,
		rows,
		total,
	};
}
