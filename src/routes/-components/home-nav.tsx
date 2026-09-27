import { Link, useLoaderData, useMatchRoute } from "@tanstack/react-router";
import {
	ActivityIcon,
	CheckIcon,
	MoreHorizontalIcon,
	SquarePenIcon,
	TableIcon,
	TagsIcon,
	UsersRoundIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { AppNavHeader } from "#/components/ui/app-layout";
import {
	DropdownMenuItemContent,
	DropdownMenuItemIcon,
	DropdownMenuItemLabel,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItemIndicator,
	DropdownMenuRadioItemPrimitive,
	DropdownMenuRoot,
	DropdownMenuTrigger,
	renderDropdownMenuItems,
} from "#/components/ui/dropdown-menu";
import { Icon } from "#/components/ui/icon";
import { NavGroup, NavGroups, NavItem } from "#/components/ui/nav-item";
import { ScrollArea } from "#/components/ui/scroll-area";
import type { TablePage } from "#/lib/paging";
import type { RecentSearch } from "#/server/turn";
import { RECENT_COUNTS, type RecentCount } from "../-lib/nav-prefs";
import { AllRecentsDrawer } from "./all-recents";
import { ToggleNavButton, useNavControl } from "./nav-control";
import { LoadFailed, RecentItem, useRetryRoot } from "./recent-item";

/** 导航栏里的两组。 */
const GROUPS = ["recent", "admin"] as const;

/**
 * 首页那一套导航：身份、新搜索，下面可以滚动的一栏里是最近搜索，管理页那一组
 * 沉在这一栏的底上。除了搜索结果页，每一屏的导航栏都是它（`app-shell.tsx`）。
 *
 * 两组都能收起，收着哪几组记在导航栏记住的样子里（`nav-prefs.ts`）。
 * 还没有搜索记录时最近搜索这一组整个不画：首页那一栏有起步的例子。
 */
export function HomeNav() {
	const { recent } = useLoaderData({ from: "__root__" });
	const control = useNavControl();
	const matchRoute = useMatchRoute();
	const on = (to: "/" | "/data" | "/skills" | "/tasks") =>
		Boolean(matchRoute({ to, fuzzy: to !== "/" }));
	const folded = control?.prefs.folded ?? [];
	return (
		<>
			<AppNavHeader
				logo={UsersRoundIcon}
				name="人才搜索"
				render={<Link to="/" />}
				toggle={<ToggleNavButton />}
			/>
			<div className="flex flex-col px-1">
				<NavItem active={on("/")} icon={SquarePenIcon} render={<Link to="/" />}>
					新搜索
				</NavItem>
			</div>
			<ScrollArea
				className="mt-2 min-h-0 flex-1"
				contentClassName="flex min-h-full flex-col"
				disableContentFit
				scrollFade
			>
				<NavGroups
					className="flex-1 px-1 pb-2"
					onValueChange={(open) =>
						control?.setPrefs({
							folded: GROUPS.filter((key) => !open.includes(key)),
						})
					}
					value={GROUPS.filter((key) => !folded.includes(key))}
				>
					{(recent === null || recent.total > 0) && (
						<RecentGroup recent={recent} />
					)}
					<div aria-hidden className="min-h-0 flex-1" />
					<NavGroup title="管理" value="admin">
						<NavItem
							active={on("/data")}
							icon={TableIcon}
							render={<Link search={{ page: undefined, q: "" }} to="/data" />}
						>
							数据
						</NavItem>
						<NavItem
							active={on("/skills")}
							icon={TagsIcon}
							render={<Link search={{ page: undefined, q: "" }} to="/skills" />}
						>
							技能
						</NavItem>
						<NavItem
							active={on("/tasks")}
							icon={ActivityIcon}
							render={<Link to="/tasks" />}
						>
							任务
						</NavItem>
					</NavGroup>
				</NavGroups>
			</ScrollArea>
		</>
	);
}

/**
 * 最近搜索这一组：列最近的几条（条数在组名旁的菜单里选），列不完时最后一行是「更多」，
 * 打开全部记录的抽屉。列表由根路由的 loader 送进来（`__root.tsx`），取不到时说一句并给重试。
 */
function RecentGroup({ recent }: { recent: TablePage<RecentSearch> | null }) {
	const control = useNavControl();
	const [all, setAll] = useState(false);
	const { retry, retrying } = useRetryRoot();
	const count = control?.prefs.recentCount ?? RECENT_COUNTS[0];

	return (
		<>
			<NavGroup
				action={
					<RecentMenu
						count={count}
						onCount={(recentCount) => control?.setPrefs({ recentCount })}
						onShowAll={() => setAll(true)}
					/>
				}
				title="最近搜索"
				value="recent"
			>
				{recent === null ? (
					<LoadFailed onRetry={retry} retrying={retrying} />
				) : (
					<>
						{recent.rows.slice(0, count).map((record) => (
							<RecentItem key={record.turnId} record={record} />
						))}
						{recent.total > count && (
							<NavItem
								icon={MoreHorizontalIcon}
								iconSize="small"
								onClick={() => setAll(true)}
								render={<button type="button" />}
							>
								更多
							</NavItem>
						)}
					</>
				)}
			</NavGroup>
			<AllRecentsDrawer onClose={() => setAll(false)} open={all} />
		</>
	);
}

/** 组名行尾的「…」：看全部记录，以及这一组列几条。 */
function RecentMenu({
	count,
	onCount,
	onShowAll,
}: {
	count: RecentCount;
	onCount: (count: RecentCount) => void;
	onShowAll: () => void;
}) {
	return (
		<DropdownMenuRoot>
			<DropdownMenuTrigger>
				<ActionIcon
					aria-label="最近搜索的更多操作"
					icon={MoreHorizontalIcon}
					size="small"
				/>
			</DropdownMenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner>
					<DropdownMenuPopup>
						{renderDropdownMenuItems(
							[
								{ key: "all", label: "全部搜索记录", onClick: onShowAll },
								{ type: "divider" },
							],
							{ reserveIconSpace: true },
						)}
						<DropdownMenuRadioGroup
							onValueChange={(next) => onCount(next as RecentCount)}
							value={count}
						>
							{RECENT_COUNTS.map((n) => (
								<DropdownMenuRadioItemPrimitive
									key={n}
									label={`列 ${n} 条`}
									value={n}
								>
									<DropdownMenuItemContent>
										<DropdownMenuItemIcon>
											<DropdownMenuRadioItemIndicator>
												<Icon icon={CheckIcon} />
											</DropdownMenuRadioItemIndicator>
										</DropdownMenuItemIcon>
										<DropdownMenuItemLabel>列 {n} 条</DropdownMenuItemLabel>
									</DropdownMenuItemContent>
								</DropdownMenuRadioItemPrimitive>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuRoot>
	);
}
