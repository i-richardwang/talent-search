import {
	Link,
	useLoaderData,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { SquarePenIcon, UsersRoundIcon } from "lucide-react";
import { AppNavHeader } from "#/components/ui/app-layout";
import { NavItem } from "#/components/ui/nav-item";
import { ScrollArea } from "#/components/ui/scroll-area";
import { emptyFacets } from "#/search/result";
import { ToggleNavButton } from "../../../-components/nav-control";
import { filterFields, textFilters } from "../-lib/filters";
import type { View } from "../-lib/view-params";
import { FilterPanel } from "./filter-panel";

/**
 * 搜索结果页的导航栏（路由的 `staticData.nav`）：身份和新搜索照旧在顶上，下面换成这次
 * 名单的筛选。最近搜索和管理页在首页那一套里，点身份或新搜索就回去。
 *
 * 筛选读的是这一屏 loader 的分面和地址上的视图，改筛选就是改地址：和名单共用同一份事实。
 */
export function WorkbenchNav() {
	const { result } = useLoaderData({ from: "/s/$turnId" });
	const view = useSearch({ from: "/s/$turnId" });
	const navigate = useNavigate({ from: "/s/$turnId" });
	const onChange = (next: Partial<View>) =>
		navigate({ to: ".", search: (old) => ({ ...old, n: undefined, ...next }) });

	return (
		<>
			<AppNavHeader
				logo={UsersRoundIcon}
				name="人才搜索"
				render={<Link to="/" />}
				toggle={<ToggleNavButton />}
			/>
			<div className="flex flex-col px-1">
				<NavItem icon={SquarePenIcon} render={<Link to="/" />}>
					新搜索
				</NavItem>
			</div>
			<ScrollArea className="mt-2 min-h-0 flex-1" disableContentFit scrollFade>
				<div className="px-1 pb-2">
					<FilterPanel
						fields={filterFields(result?.facets ?? emptyFacets(), view)}
						onChange={onChange}
						textFilters={textFilters(view)}
					/>
				</div>
			</ScrollArea>
		</>
	);
}
