import type { ReactElement } from "react";
import { Button } from "#/components/ui/button";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
} from "#/components/ui/pagination";

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
 * 排法照 coss 的 `p-pagination-2`：两个按钮各自住在一个 `PaginationItem` 里，
 * 到头的那个是禁用的 `Button`，能去的那个把 `Link` 交给它渲染。`Pagination` 自带
 * 的是 `mx-auto w-full justify-center`，占满剩下的宽、内容居中，所以这里只改对齐
 * （`p-table-8` 也是只加一个 `justify-end`）——宽度收成 `w-auto` 的话，那个
 * `mx-auto` 就会把两个按钮推到剩下那段空当的正中间。
 */
export function PageNav({
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
		<Pagination className="justify-end">
			<PaginationContent>
				{steps(page).map(([label, to]) => {
					const beyond = to < 1 || to > pages;
					return (
						<PaginationItem key={label}>
							<Button
								disabled={beyond}
								render={beyond ? undefined : linkTo(to)}
								size="sm"
								variant="outline"
							>
								{label}
							</Button>
						</PaginationItem>
					);
				})}
			</PaginationContent>
		</Pagination>
	);
}

/** 这两个按钮各自要去哪一页。 */
function steps(page: number): [string, number][] {
	return [
		["上一页", page - 1],
		["下一页", page + 1],
	];
}
