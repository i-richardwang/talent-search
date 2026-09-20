import "@tanstack/react-start/server-only";

/**
 * 管理页的表怎么分页。三张表（人、能力词、任务跑过的记录）共用同一套算术：
 * 一页多少行、给出的是第几页、从第几个起。
 *
 * **页码由服务端定夺，不是照抄地址栏里的那个数**：搜过一次再改词，剩下的行可能
 * 填不满原来那么多页，而一个越界的页码在表上就是一张空表。越界收回最后一页。
 */

/** 一页多少行。管理页的表都是「一直往后翻到底」的读法，一屏放得下一批就够。 */
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

/** 想看第几页（`want` 来自地址栏，什么都可能）落到实处：第几页、跳过多少行。 */
export function pageAt(
	total: number,
	want: unknown,
	size: number = PAGE_SIZE,
): { page: number; pages: number; offset: number } {
	const pages = Math.max(1, Math.ceil(total / size));
	const asked = Math.trunc(Number(want));
	const page = Math.min(Math.max(1, Number.isFinite(asked) ? asked : 1), pages);
	return { offset: (page - 1) * size, page, pages };
}

/** 一页行连它和全部的关系，给页面的那一份。 */
export function tablePage<T>(
	rows: T[],
	total: number,
	at: { page: number; pages: number; offset: number },
): TablePage<T> {
	return {
		from: rows.length === 0 ? 0 : at.offset + 1,
		page: at.page,
		pages: at.pages,
		rows,
		total,
	};
}
