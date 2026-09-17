/** 地址栏上的页码：管理页的表都按同一条规矩读它。 */

/**
 * 地址栏上写的是第几页。第一页是 `undefined`——默认值不写进地址，否则刚进来的
 * 链接和翻回第一页的链接是两个不同的字符串（检索那边同一条规矩，见
 * `s/$turnId/-lib/view-params.ts`）。
 *
 * 越界不在这里收：一共几页要问服务端，收回最后一页的是给出这张表的那一处
 * （`server/data.ts` 的 `listEmployees`、`server/tasks.ts` 的 `tasksState`）。
 */
export function pageOf(value: unknown): number | undefined {
	const n = Math.trunc(Number(value));
	return Number.isFinite(n) && n > 1 ? n : undefined;
}
