import { Link, useLoaderData, useMatchRoute } from "@tanstack/react-router";
import {
	ActivityIcon,
	CheckIcon,
	HashIcon,
	MoreHorizontalIcon,
	SquarePenIcon,
	TableIcon,
	TagsIcon,
	UsersRoundIcon,
} from "lucide-react";
import { ActionIcon } from "#/components/ui/action-icon";
import { AppNavHeader } from "#/components/ui/app-layout";
import {
	DropdownMenuItemContent,
	DropdownMenuItemExtra,
	DropdownMenuItemIcon,
	DropdownMenuItemLabel,
	DropdownMenuPopup,
	DropdownMenuPortal,
	DropdownMenuPositioner,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItemIndicator,
	DropdownMenuRadioItemPrimitive,
	DropdownMenuRoot,
	DropdownMenuSubmenuArrow,
	DropdownMenuSubmenuRoot,
	DropdownMenuSubmenuTrigger,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Icon } from "#/components/ui/icon";
import { NavGroup, NavGroups, NavItem } from "#/components/ui/nav-item";
import { ScrollArea } from "#/components/ui/scroll-area";
import type { TablePage } from "#/lib/paging";
import type { RecentSearch } from "#/server/turn";
import { RECENT_COUNTS, type RecentCount } from "../-lib/nav-prefs";
import { ToggleNavButton, useNavControl } from "./nav-control";
import { LoadFailed, RecentItem, useRetryRoot } from "./recent-item";

/** 导航栏里能收起的组。 */
const GROUPS = ["recent"] as const;

/**
 * 导航栏的内容，每一屏都是这一套（`app-shell.tsx`）：身份、新搜索，下面可以滚动的
 * 一栏里是最近搜索这一组，管理页的几项沉在这一栏的底上。
 *
 * 最近搜索能收起，收没收着记在导航栏记住的样子里（`nav-prefs.ts`）。
 * 还没有搜索记录时这一组整个不画：首页那一栏有起步的例子。
 */
export function NavContent() {
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
			<div className="mt-px flex flex-col px-1">
				<NavItem active={on("/")} icon={SquarePenIcon} render={<Link to="/" />}>
					新搜索
				</NavItem>
			</div>
			<ScrollArea
				className="mt-px min-h-0 flex-1"
				contentClassName="flex min-h-full flex-col gap-px px-1 pb-2"
				disableContentFit
				scrollFade
			>
				{(recent === null || recent.total > 0) && (
					<NavGroups
						onValueChange={(open) =>
							control?.setPrefs({
								folded: GROUPS.filter((key) => !open.includes(key)),
							})
						}
						value={GROUPS.filter((key) => !folded.includes(key))}
					>
						<RecentGroup recent={recent} />
					</NavGroups>
				)}
				<div aria-hidden className="min-h-0 flex-1" />
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
			</ScrollArea>
		</>
	);
}

/**
 * 最近搜索这一组：列最近的几条（条数在组名旁的菜单里选），列不完时最后一行是「更多」，
 * 打开全部记录的抽屉。列表由根路由的 loader 送进来（`__root.tsx`），取不到时说一句并给重试。
 * 组上按右键打开和组名行尾「…」同一份菜单；按在一条记录上是那一条自己的菜单。
 */
function RecentGroup({ recent }: { recent: TablePage<RecentSearch> | null }) {
	const control = useNavControl();
	const { retry, retrying } = useRetryRoot();
	const count = control?.prefs.recentCount ?? RECENT_COUNTS[0];
	const menu = (
		<RecentMenuItems
			count={count}
			onCount={(recentCount) => control?.setPrefs({ recentCount })}
		/>
	);

	return (
		<NavGroup
			action={
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
							<DropdownMenuPopup>{menu}</DropdownMenuPopup>
						</DropdownMenuPositioner>
					</DropdownMenuPortal>
				</DropdownMenuRoot>
			}
			headerMenu={menu}
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
							onClick={control?.openAllRecents}
							render={<button type="button" />}
						>
							更多
						</NavItem>
					)}
				</>
			)}
		</NavGroup>
	);
}

/** 这一组的菜单项：「显示」一项的子菜单里选这一组列几条，行尾写着现在列几条。 */
function RecentMenuItems({
	count,
	onCount,
}: {
	count: RecentCount;
	onCount: (count: RecentCount) => void;
}) {
	return (
		<DropdownMenuSubmenuRoot>
			<DropdownMenuSubmenuTrigger label="显示">
				<DropdownMenuItemContent>
					<DropdownMenuItemIcon>
						<Icon icon={HashIcon} />
					</DropdownMenuItemIcon>
					<DropdownMenuItemLabel>显示</DropdownMenuItemLabel>
					<DropdownMenuItemExtra>{count}</DropdownMenuItemExtra>
					<DropdownMenuSubmenuArrow />
				</DropdownMenuItemContent>
			</DropdownMenuSubmenuTrigger>
			<DropdownMenuPortal>
				<DropdownMenuPositioner submenu>
					<DropdownMenuPopup>
						<DropdownMenuRadioGroup
							onValueChange={(next) => onCount(next as RecentCount)}
							value={count}
						>
							{RECENT_COUNTS.map((n) => (
								<DropdownMenuRadioItemPrimitive
									key={n}
									label={`${n} 条`}
									value={n}
								>
									<DropdownMenuItemContent>
										<DropdownMenuItemIcon>
											<DropdownMenuRadioItemIndicator>
												<Icon icon={CheckIcon} />
											</DropdownMenuRadioItemIndicator>
										</DropdownMenuItemIcon>
										<DropdownMenuItemLabel>{n} 条</DropdownMenuItemLabel>
									</DropdownMenuItemContent>
								</DropdownMenuRadioItemPrimitive>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuPopup>
				</DropdownMenuPositioner>
			</DropdownMenuPortal>
		</DropdownMenuSubmenuRoot>
	);
}
