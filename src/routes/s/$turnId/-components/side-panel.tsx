import type { ReactNode } from "react";
import { NavHeader, NavHeaderTitle } from "#/components/ui/app-layout";
import { DraggablePanel } from "#/components/ui/draggable-panel";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useStoredWidth } from "../../../-lib/stored";

/**
 * 右栏两样内容各记各的宽（px）：拖宽了人的详情，下次回到线程还是线程自己的宽。
 * 线程是一列对话，最宽 560，再宽就不像对话了；详情可以一直拖到 1280。
 */
const PANEL_WIDTH = {
	detail: { fallback: 400, max: 1280, min: 400 },
	thread: { fallback: 400, max: 560, min: 400 },
} as const;

/**
 * 宽屏的右栏：对话的链上常驻线程，点开一个人时换成那个人的详情，关掉详情线程回来。
 * 两样都要常驻但不必同时在场：名单和详情才是要反复对照的一对，线程看完一轮就回到
 * 名单。关键词的链没有线程，右栏只在点开人时才展开。
 *
 * 右栏左边缘可以拖动调宽，那条边就是和名单之间的竖线。两样顶上都是一条 `NavHeader`：
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
	const bounds = PANEL_WIDTH[view];
	const [width, setWidth] = useStoredWidth(`panel-width:${view}`, bounds);
	return (
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
						<NavHeader left={<NavHeaderTitle as="h2">对话</NavHeaderTitle>} />
						<div className="min-h-0 flex-1">{conversation}</div>
					</>
				)
			)}
		</DraggablePanel>
	);
}
