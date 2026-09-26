import { Link, useMatchRoute } from "@tanstack/react-router";
import {
	ActivityIcon,
	type LucideIcon,
	TableIcon,
	TagsIcon,
	UsersRoundIcon,
} from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Divider } from "#/components/ui/divider";
import type { RecentSearch } from "#/server/turn";
import { RecentPopover } from "./recent-popover";

/**
 * 顶栏。整条吸顶、80% 的画布色加一层模糊，内容从下面滑过去时能透出来一点；
 * 底边一根 border-secondary 的发丝线。
 *
 * 两头：身份和几个入口。**这条带不管当前这次查询**——
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
		<header className="sticky top-0 z-stick border-b bg-layout/80 backdrop-blur-sm">
			<div className="app-column flex h-(--header-height) items-center gap-2">
				{/* 悬停给下划线：主色是单色，没有一个比正文更重的前景色可以换过去。 */}
				<Link
					className="flex shrink-0 items-center gap-2 font-semibold text-base underline-offset-4 hover:underline"
					to="/"
				>
					<UsersRoundIcon className="size-4 text-fg-secondary" />
					人才搜索
				</Link>
				<div className="ms-auto flex shrink-0 items-center gap-2">
					<RecentPopover recent={recent} />
					{/*
					 * 一根竖线把两类东西分开。「最近」翻的是这个人问过什么，右边三个是
					 * 另外三块屏幕——同一档图标按钮并排摆四枚，读起来就是一条后台工具条，
					 * 而它们本来不是一件事（AGENTS.md「不同类的东西必须长得不一样」）。
					 */}
					<Divider orientation="vertical" />
					{/*
					 * 三个管理页的入口。当前所在的那一页是 `active` 并带上
					 * `aria-current`：四枚只有图标的按钮里，不说清人在哪一页的话，
					 * 进来之后没有任何东西回答「我现在看的是什么」。
					 */}
					<AdminLink
						icon={TableIcon}
						label="数据"
						search={{ page: undefined, q: "" }}
						to="/data"
					/>
					<AdminLink
						icon={TagsIcon}
						label="技能"
						search={{ page: undefined, q: "" }}
						to="/skills"
					/>
					<AdminLink icon={ActivityIcon} label="任务" to="/tasks" />
				</div>
			</div>
		</header>
	);
}

/**
 * 一个管理页的入口：一个图标按钮，鼠标停下来说出它是什么。
 *
 * 三处只差图标和字，写三遍的话下一次改尺码就会有一处忘掉——而顶栏上一个
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
	icon: LucideIcon;
	/**
	 * 那一页要求的地址参数。从顶栏进去是从头看：没有搜索词、停在第一页
	 * （第一页不写进地址，所以 `page` 是 undefined）。没有这类参数的页不给。
	 */
	search?: { q: string; page: undefined };
}) {
	const matchRoute = useMatchRoute();
	const current = Boolean(matchRoute({ to, fuzzy: true }));
	return (
		<ActionIcon
			active={current}
			aria-current={current ? "page" : undefined}
			aria-label={label}
			icon={icon}
			render={<Link search={search} to={to} />}
			title={label}
			tooltipProps={{ positionerProps: { positionMethod: "fixed" } }}
		/>
	);
}
