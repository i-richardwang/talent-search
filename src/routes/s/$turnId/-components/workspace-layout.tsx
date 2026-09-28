import type { ReactNode } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useIsWide } from "../-lib/media";

/** 名单那一栏两侧的内边距。 */
/**
 * 搜索结果页的排法：左边是名单那一栏，宽屏时右边一栏（`panel`），窄屏时人的详情是
 * 浮层（`detailModal`）。每一块由路由接好数据再放进来；在哪个断点出现、滚动归谁，
 * 只在这里定。
 *
 * 宽窄两套右侧容器由 `useIsWide` 二选一地挂（理由见 media.ts）；右栏的槽另带
 * `max-xl:hidden`，兜住 JS 还没答话的首帧。
 */
export function WorkspaceLayout({
	header,
	notices,
	list,
	panel,
	detailModal,
}: {
	header: ReactNode;
	notices?: ReactNode;
	list: ReactNode;
	panel: ReactNode;
	detailModal: ReactNode;
}) {
	const wide = useIsWide();
	return (
		<div className="flex min-h-0 flex-1">
			<div className="flex min-w-0 flex-1 flex-col">
				{header}
				<ScrollArea
					className="min-h-0 flex-1"
					viewportProps={{
						className: "data-has-overflow-y:overscroll-y-contain",
					}}
				>
					<main
						aria-label="搜索结果"
						className={`mx-auto w-full max-w-page px-6 py-5`}
						id="main"
						tabIndex={-1}
					>
						{/* 没有要放的时候组件渲染为空，`empty:hidden` 收掉这一块的下边距 */}
						<div className="mb-4 flex flex-col gap-4 empty:hidden">
							{notices}
						</div>
						{list}
					</main>
				</ScrollArea>
			</div>
			{wide ? <div className="h-full max-xl:hidden">{panel}</div> : detailModal}
		</div>
	);
}
