import { Link } from "@tanstack/react-router";
import { HistoryIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "#/components/ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import type { SearchSpec } from "#/search/spec";
import type { RecentSearch } from "#/server/turn";
import { scopeEntries, scopeLabel } from "../-lib/scope-label";

/**
 * 一条记录的样子：条件词和范围，就是点进去会看到的那几枚 chip。
 * 一条都没有的记录（理解完发现没有可用条件）仍然存在，落到原话上——
 * 它至少能让人认出「这是我搜过的那句」。
 */
function recentLabel(spec: SearchSpec, rawText: string | null) {
	const evidence = spec.evidence.map((item) => item.term);
	const scope = scopeEntries(spec.scope).map(({ key, value }) =>
		scopeLabel(key, value),
	);
	return [...evidence, ...scope].join(" · ") || rawText || "未生效的条件";
}

/**
 * 搜过的那些，收在顶栏右上角的弹层里——就是通知铃铛那种东西。历史是「偶尔回头
 * 找一下」的东西，一个偶尔用一次的入口不该全程占着屏幕的一条边。
 *
 * 列表由根路由的 loader 送进来（`__root.tsx`），所以这里**没有取数，也就没有
 * 「正在取」这一档**：弹层打开即是最新的一份，不会每打开一次先转一圈。
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
				<TooltipPopup>最近搜索</TooltipPopup>
			</Tooltip>

			<PopoverPopup align="end" className="w-80">
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
			{recent.map((record) => (
				/*
				 * 每一行是一枚 ghost 按钮 render 成 Link，只把居中改成靠左：悬停、
				 * 按压、焦点环全走组件自己那一套，和界面上其余可点的东西同一副长相。
				 * `data-status` 是 Link 自己标的，当前这条因此看得出来。
				 */
				<Button
					className="w-full justify-start data-[status=active]:bg-accent data-[status=active]:text-accent-foreground"
					key={record.turnId}
					render={<Link params={{ turnId: record.turnId }} to="/s/$turnId" />}
					size="sm"
					variant="ghost"
				>
					<span className="truncate">
						{recentLabel(record.spec, record.rawText)}
					</span>
				</Button>
			))}
		</nav>
	);
}
