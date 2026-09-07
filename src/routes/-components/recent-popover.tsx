import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "#/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { dots } from "#/lib/format";
import type { SearchSpec } from "#/search/spec";
import type { RecentSearch } from "#/server/turn";
import { scopeEntries } from "../-lib/scope-label";

/**
 * 一行记录读的是**原话**——和查询台上那一行是同一样东西（见 `query-deck.tsx`）。
 * 回头找一次搜过的东西，认出来靠的是自己当时怎么说的，不是系统把它读成的那几个词：
 * 条件词是原话的解释，点进去就在屏幕上，这里再摆一遍只会把「我问的」换成「它懂的」。
 *
 * 没有原话的记录只有一种：直接拿一份条件调 RPC 落下的（`kind: "spec"` 且没有父
 * 记录），界面产生不出来。它的门面本来就是条件本身，所以落到条件词和范围上。
 */
function recentLabel(spec: SearchSpec, rawText: string | null) {
	if (rawText) return rawText;
	const terms = spec.requirements.map((r) => r.members[0].text);
	const scope = scopeEntries(spec.scope).map((entry) => entry.label);
	return dots(...terms, ...scope) || "未生效的条件";
}

/**
 * 搜过的那些，收在顶栏右上角的弹层里——就是通知铃铛那种东西。历史是「偶尔回头
 * 找一下」的东西，一个偶尔用一次的入口不该全程占着屏幕的一条边。
 *
 * 列表由根路由的 loader 送进来（`__root.tsx`），所以这里**没有取数，也就没有
 * 「正在取」这一档**：弹层打开即是最新的一份，不会每打开一次先转一圈。
 *
 * 两层浮层都走 `positionMethod="fixed"`。锚点在吸顶的顶栏里：它在视口里不动，
 * 在文档里一直动。浮层默认按文档坐标定位（`absolute`），于是每滚一帧都要重算
 * 一次位置去追锚点，而 coss 的定位器带 `transition-[top,left,…]`，每次重算都被
 * 补间——滚动时浮层就在上下游。换成视口坐标之后，锚点不动，算出来的数就不变，
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
				<RecentList recent={recent} />
			</PopoverPopup>
		</Popover>
	);
}

function RecentList({ recent }: { recent: RecentSearch[] | null }) {
	// 两句话说两件事。取不到不能借用「还没有记录」那一句——那是把一次失败
	// 谎报成一个空结果，而这两者该做的事正好相反（重试 vs 去搜一次）。
	if (recent === null) {
		return <p className="text-muted-foreground text-sm">记录暂时取不到。</p>;
	}
	if (recent.length === 0) {
		return <p className="text-muted-foreground text-sm">还没有搜索记录。</p>;
	}

	return (
		<nav aria-label="最近搜索" className="flex flex-col gap-0.5">
			{recent.map((record) => {
				const label = recentLabel(record.spec, record.rawText);
				return (
					/*
					 * 每一行是一枚 ghost 按钮 render 成 Link，只把居中改成靠左：悬停、
					 * 按压、焦点环全走组件自己那一套，和界面上其余可点的东西同一副长相。
					 * `data-status` 是 Link 自己标的，当前这条因此看得出来。
					 * 一句话在 w-80 里放不下就截断，`title` 让悬停能看全。
					 */
					<Button
						className="w-full justify-start data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
						key={record.turnId}
						render={<Link params={{ turnId: record.turnId }} to="/s/$turnId" />}
						size="sm"
						title={label}
						variant="ghost"
					>
						<span className="truncate">{label}</span>
					</Button>
				);
			})}
		</nav>
	);
}
