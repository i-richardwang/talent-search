import type { ReactNode } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { cn } from "#/lib/utils";

/** 右栏的宽度：对话线程和人的详情共用这一个槽（`styles.css` 的 `--container-detail`）。 */
const PANEL_W = "w-detail 2xl:w-detail-wide";

/**
 * 宽屏的右栏：对话的链上常驻线程，点开一个人时换成那个人的详情，关掉详情线程回来。
 * 两样都要常驻但不必同时在场：名单和详情才是要反复对照的一对，线程看完一轮就回到
 * 名单。关键词的链没有线程，右栏只在点开人时才有宽度。
 *
 * 这里只管宽度和换哪样内容；高度跟着外面的槽，吸顶和在哪个断点出现归
 * `WorkspaceLayout`。
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
	return (
		<aside
			aria-label={open ? "员工详情" : "对话"}
			className={cn(
				"h-full overflow-hidden transition-[width] duration-200 ease-out",
				open || conversation ? `${PANEL_W} border-l bg-container` : "w-0",
			)}
		>
			<div className={cn(PANEL_W, "h-full")}>
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
					conversation
				)}
			</div>
		</aside>
	);
}
