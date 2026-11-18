/**
 * 服务端分页的表共用的算术：地址上的页码怎么读、给出第几页、从第几行起取几行。
 *
 * 页码由服务端定夺，不照抄地址栏：改了搜索词后剩下的行可能填不满那么多页，
 * 越界的页码收回最后一页。
 */

export const PAGE_SIZE = 50;

/** 任务卡上的运行记录一页几行。往前的那些翻页看（`/tasks?derive=3`）。 */
export const RUNS_PAGE = 6;

/** 一张表的一页，连它和全部的关系。 */
export type TablePage<T> = {
	/** 一共多少行；有搜索词时是搜出来的那些 */
	total: number;
	/** 一共分几页，至少一页 */
	pages: number;
	/** 这一页的第一行在全部结果里排第几，从 1 起；一行都没有时是 0 */
	from: number;
	/** 从 1 起 */
	page: number;
	rows: T[];
};

type PageSlice = {
	page: number;
	pages: number;
	offset: number;
	limit: number;
};

/**
 * 读地址栏上的页码。第一页是 `undefined`：默认值不写进地址，刚进来的链接和翻回第一页的
 * 链接才是同一个字符串。越界由 `pageAt` 收，这里还不知道总数。
 */
export function pageParam(value: unknown): number | undefined {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) && n > 1 ? n : undefined;
}

/** 一张表的一次请求：搜索词和想看的页码都来自地址栏，什么都可能。越界的页码由 `pageAt` 收。 */
export function tableQuery(d: { q: unknown; page: unknown }): {
	q: string;
	page: number;
} {
	return { q: String(d.q ?? "").slice(0, 64), page: Number(d.page) || 1 };
}

/** 把想看的页码（`want` 来自地址栏）换算成实际的一页，越界收回最后一页。 */
export function pageAt(
	total: number,
	want: unknown,
	size: number = PAGE_SIZE,
): PageSlice {
	const pages = Math.max(1, Math.ceil(total / size));
	const page = Math.min(pageParam(want) ?? 1, pages);
	return { limit: size, offset: (page - 1) * size, page, pages };
}

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
