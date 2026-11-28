import { Link, useLoaderData, useMatchRoute } from "@tanstack/react-router";
import {
	ActivityIcon,
	EllipsisIcon,
	FolderOpenIcon,
	ShieldCheckIcon,
	SquarePenIcon,
	TableIcon,
	TagsIcon,
	UserCogIcon,
} from "lucide-react";
import { AppNavHeader } from "#/components/ui/app-layout";
import { NavGroup, NavGroups, NavItem } from "#/components/ui/nav-item";
import { ScrollArea } from "#/components/ui/scroll-area";
import { NAV_RECENT_COUNT } from "../-lib/recent";
import { useRecents } from "../-lib/recents";
import { AccountMenu } from "./account-menu";
import { ToggleNavButton, useNavControl } from "./nav-control";
import { LoadFailed, RecentItem } from "./recent-item";

/** 导航栏里能收起的组。 */
const GROUPS = ["recent"] as const;

/**
 * 导航栏的内容，每一屏都是这一套：新搜索、最近搜索，管理页的几项沉在滚动区的底上。
 * 还没有搜索记录时最近搜索这一组整个不画：首页那一栏有起步的例子。
 */
export function NavContent() {
	const { user } = useLoaderData({ from: "__root__" });
	const { page: recent } = useRecents();
	const control = useNavControl();
	const matchRoute = useMatchRoute();
	const on = (
		to: "/" | "/pools" | "/data" | "/terms" | "/tasks" | "/audit" | "/accounts",
	) => Boolean(matchRoute({ to, fuzzy: to !== "/" }));
	const folded = control?.prefs.folded ?? [];
	return (
		<>
			<AppNavHeader toggle={<ToggleNavButton />}>
				{user && <AccountMenu user={user} />}
			</AppNavHeader>
			<div className="mt-px flex flex-col px-1">
				<NavItem active={on("/")} icon={SquarePenIcon} render={<Link to="/" />}>
					新搜索
				</NavItem>
			</div>
			<ScrollArea
				className="mt-px min-h-0 flex-1"
				contentClassName="flex min-h-full flex-col gap-px px-1 pb-2"
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
						<RecentGroup />
					</NavGroups>
				)}
				<div aria-hidden className="min-h-0 flex-1" />
				<NavItem
					active={on("/pools")}
					icon={FolderOpenIcon}
					render={
						<Link
							to="/pools"
							search={{ page: undefined, poolId: undefined, tab: undefined }}
						/>
					}
				>
					外部人才池
				</NavItem>
				<NavItem
					active={on("/data")}
					icon={TableIcon}
					render={<Link search={{ page: undefined, q: "" }} to="/data" />}
				>
					数据
				</NavItem>
				<NavItem
					active={on("/terms")}
					icon={TagsIcon}
					render={<Link search={{ page: undefined, q: "" }} to="/terms" />}
				>
					标签
				</NavItem>
				{user?.admin && (
					<>
						<NavItem
							active={on("/tasks")}
							icon={ActivityIcon}
							render={<Link to="/tasks" />}
						>
							任务
						</NavItem>
						<NavItem
							active={on("/audit")}
							icon={ShieldCheckIcon}
							render={<Link search={{ page: undefined, q: "" }} to="/audit" />}
						>
							审计
						</NavItem>
						<NavItem
							active={on("/accounts")}
							icon={UserCogIcon}
							render={
								<Link search={{ page: undefined, q: "" }} to="/accounts" />
							}
						>
							账号
						</NavItem>
					</>
				)}
			</ScrollArea>
		</>
	);
}

/** 最近搜索这一组：列不完时最后一行「更多」打开全部记录的抽屉。 */
function RecentGroup() {
	const control = useNavControl();
	const { page: recent, reload } = useRecents();

	return (
		<NavGroup title="最近搜索" value="recent">
			{recent === null ? (
				<LoadFailed onRetry={reload} />
			) : (
				<>
					{recent.rows.slice(0, NAV_RECENT_COUNT).map((record) => (
						<RecentItem key={record.turnId} record={record} />
					))}
					{recent.total > NAV_RECENT_COUNT && (
						<NavItem
							icon={EllipsisIcon}
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
