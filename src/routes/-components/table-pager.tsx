import type { ReactElement } from "react";
import { Button } from "#/components/ui/button";
import type { TablePage } from "#/lib/paging";

/**
 * 管理页一张表的表脚：左边这一页在全部里的范围和总数，右边翻页。
 *
 * 只有一页的时候不说范围也不放翻页件：那一页就是全部，「第 1–20 个，共 20 人」
 * 是同一件事说两遍。`units.row` 数行，`units.total` 数总数——人的表一行是一个人，
 * 数作「第 1–50 个，共 320 人」；词表一行是一个词，两处都是「项」。
 */
export function TablePager({
	table,
	units,
	linkTo,
}: {
	table: TablePage<unknown>;
	units: { row: string; total: string };
	/** 指向第 n 页的那个链接。地址长什么样是调用方的事 */
	linkTo: (page: number) => ReactElement;
}) {
	const { from, page, pages, rows, total } = table;
	return (
		<div className="flex items-center justify-between gap-2">
			<p className="whitespace-nowrap text-fg-secondary text-sm tabular-nums">
				{pages > 1 && (
					<>
						第 {from}–{from + rows.length - 1} {units.row}，共{" "}
					</>
				)}
				<strong className="font-medium text-fg">{total}</strong> {units.total}
			</p>
			<PageNav linkTo={linkTo} page={page} pages={pages} />
		</div>
	);
}

/**
 * 一张表的上一页 / 下一页。
 *
 * 不列页码：按工号排的第 37 页、任务跑过的第 12 页，对翻页的人都不说明任何事，
 * 几千条就是几十个这样的数字。翻页是用来把一张表看完的，要找某一条用表上的搜索
 * 或过滤。
 *
 * 到头的那一头不带链接、禁用，但位置留着——两个按钮一直都在，翻到最后一页时
 * 「下一页」不会消失、让「上一页」跳过来。只有一页时整个件不出现：那一页就是全部。
 *
 * 到头的那个是禁用的 `Button`，能去的那个把 `Link` 交给它渲染。
 */
function PageNav({
	page,
	pages,
	linkTo,
}: {
	page: number;
	pages: number;
	/** 指向第 n 页的那个链接。地址长什么样是调用方的事 */
	linkTo: (page: number) => ReactElement;
}) {
	if (pages <= 1) return null;
	return (
		<nav aria-label="翻页" className="flex items-center gap-1">
			{steps(page).map(([label, to]) => {
				const beyond = to < 1 || to > pages;
				return (
					<Button
						disabled={beyond}
						key={label}
						render={beyond ? undefined : linkTo(to)}
						size="small"
					>
						{label}
					</Button>
				);
			})}
		</nav>
	);
}

/** 这两个按钮各自要去哪一页。 */
function steps(page: number): [string, number][] {
	return [
		["上一页", page - 1],
		["下一页", page + 1],
	];
}
