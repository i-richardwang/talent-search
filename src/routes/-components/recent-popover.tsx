import {
	Link,
	useNavigate,
	useParams,
	useRouter,
} from "@tanstack/react-router";
import { HistoryIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Popover,
	PopoverDescription,
	PopoverPopup,
	PopoverTitle,
	PopoverTrigger,
} from "#/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { activeConditions } from "#/search/condition";
import { conditionLabel, MODE_GLYPH } from "#/search/condition-label";
import type { SearchSpec } from "#/search/spec";
import { deleteRecent } from "#/server/functions";
import type { RecentSearch } from "#/server/turn";

/**
 * 一行记录读的是**原话**——和查询台上那一行是同一样东西（见 `query-deck.tsx`）。
 * 回头找一次搜过的东西，认出来靠的是自己当时怎么说的，不是系统把它读成的那几个词：
 * 条件是原话的解释，点进去就在屏幕上，这里再摆一遍只会把「我问的」换成「它懂的」。
 *
 * 没有原话的记录只有一种：直接拿一份条件调 RPC 落下的（`kind: "spec"` 且没有父
 * 记录），界面产生不出来。它的标题本来就是条件本身，所以落到条件上。
 */
function recentLabel(spec: SearchSpec, rawText: string | null) {
	if (rawText) return rawText;
	// 停用的条件不出现：它没参与这次检索，写出来就是把没搜的当成搜过的
	const labels = activeConditions(spec.conditions).map(
		(c) => MODE_GLYPH[c.mode] + conditionLabel(c),
	);
	return labels.join(" / ") || "没有生效的条件";
}

/**
 * 搜过的那些，收在顶栏右上角的弹层里——就是通知铃铛那种东西。历史是「偶尔回头
 * 找一下」的东西，一个偶尔用一次的入口不该全程占着屏幕的一条边。
 *
 * 弹层照 coss 的排法：顶上一行标题，下面是内容。没有记录时内容就是标题下那一句
 * 说明（coss 的通知弹层「You are all caught up」正是这样写的）；有记录时标题下
 * 不写说明——一句每次打开都一样、只解释去重规则的小字，没有人会读第二遍。
 *
 * 列表由根路由的 loader 送进来（`__root.tsx`），所以这里**没有取数，也就没有
 * 「正在取」这一档**：弹层打开即是最新的一份，不会每打开一次先转一圈。
 *
 * 两层浮层都走 `positionMethod="fixed"`。锚点在吸顶的顶栏里：它在视口里不动，
 * 在文档里一直动。浮层默认按文档坐标定位（`absolute`），于是每滚一帧都要重算
 * 一次位置去追锚点，而 coss 的定位器带 `transition-[top,left,…]`，每次重算都被
 * 补间——滚动时浮层就在上下游。换成视口坐标之后，锚不可点击，算出来的数就不变，
 * 没有要重算的，也就没有要补间的。
 *
 * 浮层 portal 在 `<body>` 上（组件自带的去处），于是它是独立的一层，永远盖在
 * 页面之上，不和页面里的任何东西比 z——顶栏自己就是 `z-stick`，而这个弹层的锚点
 * 正在顶栏里：同处一个层叠上下文的话，DOM 里更靠后的兄弟就会把它盖掉。
 */
export function RecentPopover({ recent }: { recent: RecentSearch[] | null }) {
	return (
		<Popover>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button aria-label="最近搜索" size="icon-sm" variant="ghost" />
							}
						>
							<HistoryIcon />
						</PopoverTrigger>
					}
				/>
				<TooltipPopup positionMethod="fixed">最近搜索</TooltipPopup>
			</Tooltip>

			<PopoverPopup align="end" className="w-80" positionMethod="fixed">
				<PopoverTitle className="mb-3 text-sm">最近搜索</PopoverTitle>
				<RecentBody recent={recent} />
			</PopoverPopup>
		</Popover>
	);
}

/**
 * 标题下面是什么。取不到不能借用「还没有记录」那一句——那是把一次失败谎报成
 * 一个空结果，而这两者该做的事正好相反（重试 vs 去搜一次）。
 */
function RecentBody({ recent }: { recent: RecentSearch[] | null }) {
	if (recent === null)
		return <PopoverDescription>记录暂时取不到。</PopoverDescription>;
	if (recent.length === 0)
		return <PopoverDescription>还没有搜索记录。</PopoverDescription>;
	return <RecentList recent={recent} />;
}

function RecentList({ recent }: { recent: RecentSearch[] }) {
	const router = useRouter();
	const navigate = useNavigate();
	const { turnId: current } = useParams({ strict: false });
	// 正在删的那一行：按钮按下去之后到列表换新之前，这一行不能再按第二次
	const [deleting, setDeleting] = useState<string | null>(null);

	async function remove(turnId: string) {
		setDeleting(turnId);
		try {
			const gone = await deleteRecent({ data: { turnId } });
			// 人正看着的那一屏就在删掉的这条链上：留在原地的话，下一次载入就是死链。
			// 换屏会重跑根路由的 loader，列表随之换新；不换屏就得自己叫它重跑。
			if (current && gone.includes(current)) await navigate({ to: "/" });
			else await router.invalidate();
		} finally {
			setDeleting(null);
		}
	}

	return (
		<nav aria-label="最近搜索" className="flex flex-col gap-0.5">
			{recent.map((record) => {
				const label = recentLabel(record.spec, record.rawText);
				return (
					/*
					 * 一行是一个 ghost 按钮 render 成 Link，只把居中改成靠左：悬停、
					 * 按压、焦点环全走组件自己那一套，和界面上其余可点的东西同一副长相。
					 * `data-status` 是 Link 自己标的，当前这条因此看得出来。
					 * 一句话在 w-80 里放不下就截断，`title` 让悬停能看全。
					 *
					 * 删除按钮照 coss 侧栏 `SidebarMenuAction` 的排法：绝对定位在行尾，
					 * 鼠标停在这一行或焦点落在行内时才现身，触屏上一直在。行尾留出
					 * 它的位置（`pe-8`），文字截断在它前面而不是钻到它底下。
					 */
					<div className="group/row relative" key={record.turnId}>
						<Button
							className="w-full justify-start pe-8 data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
							render={
								<Link params={{ turnId: record.turnId }} to="/s/$turnId" />
							}
							size="sm"
							title={label}
							variant="ghost"
						>
							<span className="truncate">{label}</span>
						</Button>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label={`删除「${label}」`}
										className="absolute end-1 top-1/2 -translate-y-1/2 group-focus-within/row:opacity-100 group-hover/row:opacity-100 pointer-fine:opacity-0"
										disabled={deleting === record.turnId}
										onClick={() => void remove(record.turnId)}
										size="icon-xs"
										variant="ghost"
									/>
								}
							>
								<XIcon />
							</TooltipTrigger>
							<TooltipPopup>删除</TooltipPopup>
						</Tooltip>
					</div>
				);
			})}
		</nav>
	);
}
