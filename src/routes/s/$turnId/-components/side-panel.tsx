import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { NavHeaderTitle } from "#/components/ui/app-layout";
import { DraggablePanel } from "#/components/ui/draggable-panel";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useStoredWidth } from "../../../-lib/stored";
import { PaneHeader } from "./pane-header";

/**
 * 右栏两样内容各记各的宽（px）：拖宽了人的详情，下次回到线程还是线程自己的宽。
 * 线程是一列对话，最宽 560，再宽就不像对话了；详情最宽 1280。
 */
const PANEL_WIDTH = {
	detail: { fallback: 400, max: 1280, min: 400 },
	thread: { fallback: 400, max: 560, min: 400 },
} as const;

/**
 * 右栏再宽也要给名单留下的宽（px）：420 放得下名单一行的姓名、部门岗位和一条命中，
 * 再窄名单就只剩姓名，和详情对照不起来。
 */
const LIST_KEEP = 420;

/**
 * 右栏能拖到多宽：那一行（名单一栏加右栏）的宽减去给名单留的，不超过这一样内容自己的
 * 上限，也不低于下限。右栏外面包一层量宽用的 div，挂在 `WorkspaceLayout` 给它的
 * 一格里，那一格的父元素就是名单和右栏并排的那一行；量它，导航栏拖宽、收起和窗口变化都跟得上。
 */
function useRoomyMax(bounds: { min: number; max: number }) {
	const ref = useRef<HTMLDivElement>(null);
	const [row, setRow] = useState<number | null>(null);
	useLayoutEffect(() => {
		const line = ref.current?.parentElement?.parentElement;
		if (!line) return;
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setRow(entry.contentRect.width);
		});
		observer.observe(line);
		return () => observer.disconnect();
	}, []);
	const max =
		row === null
			? bounds.max
			: Math.max(bounds.min, Math.min(bounds.max, row - LIST_KEEP));
	return { max, ref };
}

/**
 * 宽屏的右栏：对话的链上常驻线程，点开一个人时换成那个人的详情，关掉详情线程回来。
 * 两样都要常驻但不必同时在场：名单和详情才是要反复对照的一对，线程看完一轮就回到
 * 名单。关键词的链没有线程，右栏只在点开人时才展开。
 *
 * 右栏左边缘可以拖动调宽，那条边就是和名单之间的竖线。两样顶上都是一条 `PaneHeader`：
 * 线程的在这里画，详情的由详情自己画（`person.tsx`），吸在它的滚动区顶上。
 */
export function SidePanel({
	detail,
	conversation,
}: {
	/** 开着的那个人的详情；没开时是 `null` */
	detail: ReactNode;
	/** 对话线程；关键词的链没有 */
	conversation: ReactNode;
}) {
	const open = detail != null;
	const view = open ? "detail" : "thread";
	const { max, ref } = useRoomyMax(PANEL_WIDTH[view]);
	const bounds = { ...PANEL_WIDTH[view], max };
	const [width, setWidth] = useStoredWidth(`panel-width:${view}`, bounds);
	return (
		<div className="h-full" ref={ref}>
			<DraggablePanel
				aria-label={open ? "员工详情" : "对话"}
				className="h-full bg-container"
				classNames={{ content: "overflow-hidden" }}
				defaultSize={bounds.fallback}
				expand={open || conversation != null}
				maxWidth={bounds.max}
				minWidth={bounds.min}
				onSizeChange={setWidth}
				placement="right"
				showHandleWideArea={false}
				size={width}
			>
				{open ? (
					<ScrollArea
						className="size-full min-h-0"
						disableContentFit
						viewportProps={{
							className: "data-has-overflow-y:overscroll-y-contain",
						}}
					>
						{detail}
					</ScrollArea>
				) : (
					conversation && (
						<>
							<PaneHeader
								title={<NavHeaderTitle as="h2">对话</NavHeaderTitle>}
							/>
							<div className="min-h-0 flex-1">{conversation}</div>
						</>
					)
				)}
			</DraggablePanel>
		</div>
	);
}
