import { Link } from "@tanstack/react-router";
import { DatabaseIcon, TagsIcon, UsersRoundIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import type { RecentSearch } from "#/server/turn";
import { RecentPopover } from "./recent-popover";

/**
 * 顶栏中间那一格的 id。工作台把「我现在搜的是什么」portal 进来（见
 * `query-deck.tsx`）——这一格由顶栏提供，因为顶栏是全站唯一一条常驻的横带，
 * 而那句话只在**它自己滚出视野之后**才需要一个替身。
 *
 * 用 id 而不是 context：顶栏在外壳里（`__root.tsx`），工作台在 `Outlet` 里面，
 * 子组件没法往祖先传值。portal 认的是 DOM 不是树，于是这条替身的全部逻辑
 * （何时出现、点了做什么）能留在它唯一的主人那里。
 */
export const HEADER_QUERY_SLOT = "header-query";

/**
 * 顶栏。照 coss 文档站那条的配方来：整条吸顶、半透明的画布色加一层模糊，
 * 底边那条线是 `before:` 伪元素画的一根 `h-px`（`bg-border/64`），不是 `border-b`。
 * 这几样合起来才是这套系统的顶栏长相——内容从下面滑过去时能透出来一点，
 * 而那根线比一条实边框淡，不会在整屏顶上压出一道黑杠。
 *
 * 三格：身份、这条查询、「最近」。中间那格在零态是空的——那一屏没有查询，
 * 空着的宽度就是它的信息量。
 *
 * 名字按正文号排，不放大：汉字系统字没有拉丁 display 字那种放大之后还成立的
 * 字形。它是一个回首页的链接，不是这一页的 h1——h1 在零态正中那处，
 * 以及工作台名单上方那句原话。
 */
export function AppHeader({ recent }: { recent: RecentSearch[] | null }) {
	return (
		<header className="sticky top-0 z-stick bg-canvas/80 backdrop-blur-sm before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64">
			<div className="app-column flex h-(--header-height) items-center gap-2">
				{/* 悬停给下划线，走 coss `link` 那一档的做法：这是套中性色系统，
				    没有一个比正文更重的前景色可以换过去。 */}
				<Link
					className="flex shrink-0 items-center gap-2 font-heading font-semibold text-sm underline-offset-4 hover:underline"
					to="/"
				>
					<UsersRoundIcon className="size-4 text-muted-foreground" />
					人才搜索
				</Link>
				{/* `min-w-0` 是给里面那句话的省略号用的：没有它，flex 子项以内容
				    为最小宽度，长句子会把「最近」顶出页宽列。 */}
				<div
					className="flex min-w-0 flex-1 items-center ps-1"
					id={HEADER_QUERY_SLOT}
				/>
				<div className="flex shrink-0 items-center gap-2">
					<RecentPopover recent={recent} />
					{/* 两个管理页的入口和「最近」并排：都是偶尔去一下的地方，同一档图标按钮。 */}
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="能力词"
									render={<Link to="/skills" />}
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<TagsIcon />
						</TooltipTrigger>
						<TooltipPopup positionMethod="fixed">能力词</TooltipPopup>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="导入"
									render={<Link to="/imports" />}
									size="icon-sm"
									variant="ghost"
								/>
							}
						>
							<DatabaseIcon />
						</TooltipTrigger>
						<TooltipPopup positionMethod="fixed">导入</TooltipPopup>
					</Tooltip>
				</div>
			</div>
		</header>
	);
}
