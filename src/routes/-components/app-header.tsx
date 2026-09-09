import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	ActivityIcon,
	TableIcon,
	TagsIcon,
	UsersRoundIcon,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import type { RecentSearch } from "#/server/turn";
import { RecentPopover } from "./recent-popover";

/**
 * 顶栏。照 coss 文档站那条的配方来：整条吸顶、半透明的画布色加一层模糊，
 * 底边那条线是 `before:` 伪元素画的一根 `h-px`（`bg-border/64`），不是 `border-b`。
 * 这几样合起来才是这套系统的顶栏长相——内容从下面滑过去时能透出来一点，
 * 而那根线比一条实边框淡，不会在整屏顶上压出一道黑杠。
 *
 * 两头：身份和几个入口，中间整段空着。**这条带不管当前这次查询**——
 * 工作台那句原话住在它自己那条带上（`s/$turnId/-components/query-deck.tsx`），
 * 那条带就吸在这一根的下沿、一直在场，所以顶栏里不需要它的替身，也不该有
 * 第二个能改查询的地方。
 *
 * 名字按正文号排，不放大：汉字系统字没有拉丁 display 字那种放大之后还成立的
 * 字形。它是一个回首页的链接，不是这一页的 h1——h1 在零态正中那处，
 * 以及工作台那条查询带上那句原话。
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
				<div className="ms-auto flex shrink-0 items-center gap-2">
					<RecentPopover recent={recent} />
					{/*
					 * 一根竖线把两类东西分开。「最近」翻的是这个人问过什么，右边三个是
					 * 另外三块屏幕——同一档图标按钮并排摆四枚，读起来就是一条后台工具条，
					 * 而它们本来不是一件事（AGENTS.md「不同类的东西必须长得不一样」）。
					 */}
					<Separator className="h-4" orientation="vertical" />
					{/*
					 * 三个管理页的入口。当前所在的那一页换成 `secondary` 并带上
					 * `aria-current`：四枚只有图标的按钮里，不说清人在哪一页的话，
					 * 进来之后没有任何东西回答「我现在看的是什么」。
					 */}
					<AdminLink
						icon={<TableIcon />}
						label="数据"
						search={{ q: "" }}
						to="/data"
					/>
					<AdminLink icon={<TagsIcon />} label="能力词" to="/skills" />
					<AdminLink icon={<ActivityIcon />} label="任务" to="/tasks" />
				</div>
			</div>
		</header>
	);
}

/**
 * 一个管理页的入口：一枚图标按钮，鼠标停下来说出它是什么。
 *
 * 三处只差图标和字，写三遍的话下一次改尺码就会有一处忘掉——而顶栏上一枚
 * 高矮不同的按钮，是这条横带上最显眼的错位。
 */
function AdminLink({
	to,
	label,
	icon,
	search,
}: {
	to: "/data" | "/skills" | "/tasks";
	label: string;
	icon: React.ReactNode;
	/** 那一页要求的地址参数（数据页的找人词）。没有要求的页不给。 */
	search?: { q: string };
}) {
	const matchRoute = useMatchRoute();
	const current = Boolean(matchRoute({ to, fuzzy: true }));
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						aria-current={current ? "page" : undefined}
						aria-label={label}
						render={<Link search={search} to={to} />}
						size="icon-sm"
						variant={current ? "secondary" : "ghost"}
					/>
				}
			>
				{icon}
			</TooltipTrigger>
			<TooltipPopup positionMethod="fixed">{label}</TooltipPopup>
		</Tooltip>
	);
}
