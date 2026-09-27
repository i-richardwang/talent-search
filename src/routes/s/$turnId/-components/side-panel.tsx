import type { ReactNode } from "react";
import { NavHeader, NavHeaderTitle } from "#/components/ui/app-layout";
import { ScrollArea } from "#/components/ui/scroll-area";
import { cn } from "#/lib/utils";

/** 右栏的宽度：对话线程和人的详情共用这一个槽（`styles.css` 的 `--container-detail`）。 */
const PANEL_W = "w-detail 2xl:w-detail-wide";

/**
 * 宽屏的右栏：对话的链上常驻线程，点开一个人时换成那个人的详情，关掉详情线程回来。
 * 两样都要常驻但不必同时在场：名单和详情才是要反复对照的一对，线程看完一轮就回到
 * 名单。关键词的链没有线程，右栏只在点开人时才有宽度。
 *
 * 和名单那一栏之间是一根 border-secondary 的竖线。两样顶上都是一条 `NavHeader`：线程的
 * 在这里画，详情的由详情自己画（`person.tsx`），吸在它的滚动区顶上。
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
				open || conversation ? `${PANEL_W} border-l` : "w-0",
			)}
		>
			<div className={cn(PANEL_W, "flex h-full flex-col")}>
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
			</div>
		</aside>
	);
}
