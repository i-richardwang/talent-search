import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "#/components/ui/button";
import { integer } from "#/lib/format";
import type { TablePage } from "#/lib/paging";

/**
 * 管理页一张表的表脚：左边这一页的范围和总数，右边翻页。只有一页时只说总数、不放翻页。
 * `units.row` 数行、`units.total` 数总数：人的表写「第 1–50 个，共 320 人」。
 */
export function TablePager({
	table,
	units,
	linkTo,
}: {
	table: TablePage<unknown>;
	units: { row: string; total: string };
	/** 指向第 n 页的链接 */
	linkTo: (page: number) => ReactElement;
}) {
	const { from, page, pages, rows, total } = table;
	return (
		<div className="flex items-center justify-between gap-3">
			<p className="whitespace-nowrap text-fg-secondary text-sm tabular-nums">
				{pages > 1 && (
					<>
						第 {integer(from)}–{integer(from + rows.length - 1)} {units.row}，
					</>
				)}
				共 {integer(total)} {units.total}
			</p>
			{pages > 1 && <PageNav linkTo={linkTo} page={page} pages={pages} />}
		</div>
	);
}

/** 当前页左右各留几页，再往外用省略号收起。 */
const SIBLINGS = 1;

type PageItem = number | "gap-start" | "gap-end";

/**
 * 列出哪些页码：首页和末页总在，当前页左右各 `SIBLINGS` 页，中间断开处放省略号，
 * 例如 `1 … 4 5 6 … 70`。页数少到放得下时全列。
 */
function pageItems(page: number, pages: number): PageItem[] {
	if (pages <= SIBLINGS * 2 + 5)
		return Array.from({ length: pages }, (_, index) => index + 1);
	const start = Math.max(2, page - SIBLINGS);
	const end = Math.min(pages - 1, page + SIBLINGS);
	const items: PageItem[] = [1];
	if (start > 2) items.push("gap-start");
	for (let at = start; at <= end; at += 1) items.push(at);
	if (end < pages - 1) items.push("gap-end");
	items.push(pages);
	return items;
}

/**
 * 到头的那一头禁用但位置留着，别的按钮不会跳过去。能去的那一页把 `Link` 交给按钮
 * 渲染，中键、右键照常。
 */
function PageNav({
	page,
	pages,
	linkTo,
}: {
	page: number;
	pages: number;
	linkTo: (page: number) => ReactElement;
}) {
	const step = (to: number, label: string, icon: typeof ChevronLeftIcon) => {
		const beyond = to < 1 || to > pages;
		return (
			<Button
				aria-label={label}
				disabled={beyond}
				icon={icon}
				render={beyond ? undefined : linkTo(to)}
				size="small"
				type="text"
			/>
		);
	};
	return (
		<nav aria-label="翻页" className="flex items-center gap-1">
			{step(page - 1, "上一页", ChevronLeftIcon)}
			{pageItems(page, pages).map((item) =>
				typeof item === "number" ? (
					<Button
						aria-current={item === page ? "page" : undefined}
						key={item}
						render={item === page ? undefined : linkTo(item)}
						size="small"
						type={item === page ? "fill" : "text"}
					>
						<span className="tabular-nums">{item}</span>
					</Button>
				) : (
					<span
						aria-hidden="true"
						className="min-w-6 text-center text-fg-quaternary"
						key={item}
					>
						…
					</span>
				),
			)}
			{step(page + 1, "下一页", ChevronRightIcon)}
		</nav>
	);
}
