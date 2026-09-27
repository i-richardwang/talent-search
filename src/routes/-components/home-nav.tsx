import {
	Link,
	useLoaderData,
	useMatchRoute,
	useNavigate,
	useParams,
	useRouter,
} from "@tanstack/react-router";
import {
	ActivityIcon,
	MessageSquareTextIcon,
	SquarePenIcon,
	TableIcon,
	TagsIcon,
	TextSearchIcon,
	UsersRoundIcon,
	XIcon,
} from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { AppNavHeader } from "#/components/ui/app-layout";
import { NavGroup, NavItem } from "#/components/ui/nav-item";
import { ScrollArea } from "#/components/ui/scroll-area";
import { activeConditions } from "#/search/condition";
import { conditionLabel, MODE_GLYPH } from "#/search/condition-label";
import { keywordsOf, keywordTitle } from "#/search/keywords";
import { deleteRecent } from "#/server/functions";
import type { RecentSearch } from "#/server/turn";

/**
 * 首页那一套导航：身份、新搜索、最近搜索，底下是三个管理页。除了搜索结果页，
 * 每一屏的导航栏都是它（`app-shell.tsx`）。
 */
export function HomeNav() {
	const { recent } = useLoaderData({ from: "__root__" });
	const matchRoute = useMatchRoute();
	const on = (to: "/" | "/data" | "/skills" | "/tasks") =>
		Boolean(matchRoute({ to, fuzzy: to !== "/" }));
	return (
		<>
			<AppNavHeader
				logo={UsersRoundIcon}
				name="人才搜索"
				render={<Link to="/" />}
			/>
			<div className="flex flex-col px-1">
				<NavItem active={on("/")} icon={SquarePenIcon} render={<Link to="/" />}>
					新搜索
				</NavItem>
			</div>
			<ScrollArea className="mt-px min-h-0 flex-1" disableContentFit scrollFade>
				<div className="px-1 pb-2">
					<NavGroup title="最近搜索">
						<Recent recent={recent} />
					</NavGroup>
				</div>
			</ScrollArea>
			<div className="px-1 pb-2">
				<NavGroup title="管理">
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
			</div>
		</>
	);
}

/**
 * 一行记录读的是**任务标题**：对话的任务是链头那句话，回头找一次搜过的东西，
 * 认出来靠的是自己当时怎么开口的。关键词搜索没有那句话，框里的词就是它问的。
 */
function recentLabel(spec: RecentSearch["spec"], title: string | null) {
	if (title) return title;
	const keywords = keywordsOf(spec.conditions);
	if (keywords) return keywordTitle(keywords);
	// 读不回框里的条件表照条件写。停用的不出现：它没参与这次检索
	const labels = activeConditions(spec.conditions).map(
		(c) => MODE_GLYPH[c.mode] + conditionLabel(c),
	);
	return labels.join(" / ") || "无搜索条件";
}

/**
 * 最近搜索的几行。取不到不能借用「还没有记录」那一句：那是把一次失败谎报成一个
 * 空结果，而两者该做的事正好相反（重试 vs 去搜一次）。
 *
 * 列表由根路由的 loader 送进来（`__root.tsx`），删掉一条之后叫根路由重跑一次。
 */
function Recent({ recent }: { recent: RecentSearch[] | null }) {
	const router = useRouter();
	const navigate = useNavigate();
	const { turnId: current } = useParams({ strict: false });
	// 正在删的那一行：按下去之后到列表换新之前，这一行不能再按第二次
	const [deleting, setDeleting] = useState<string | null>(null);

	if (recent === null)
		return (
			<p className="px-2 py-1 text-fg-tertiary text-xs">
				暂时无法加载搜索记录。
			</p>
		);
	if (recent.length === 0)
		return (
			<p className="px-2 py-1 text-fg-tertiary text-xs">还没有搜索记录。</p>
		);

	async function remove(turnId: string) {
		setDeleting(turnId);
		try {
			const gone = await deleteRecent({ data: { turnId } });
			// 人正看着的那一屏就在删掉的这条链上：留在原地的话，下一次载入就是死链
			if (current && gone.includes(current)) await navigate({ to: "/" });
			else await router.invalidate();
		} finally {
			setDeleting(null);
		}
	}

	return recent.map((record) => {
		const label = recentLabel(record.spec, record.title);
		return (
			<NavItem
				actions={
					<ActionIcon
						aria-label={`删除「${label}」`}
						icon={XIcon}
						loading={deleting === record.turnId}
						onClick={() => void remove(record.turnId)}
						size="small"
						title="删除"
					/>
				}
				active={record.turnId === current}
				icon={record.title === null ? TextSearchIcon : MessageSquareTextIcon}
				iconSize="small"
				key={record.turnId}
				render={<Link params={{ turnId: record.turnId }} to="/s/$turnId" />}
				title={label}
			>
				{label}
			</NavItem>
		);
	});
}
