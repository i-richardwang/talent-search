import type { ReactNode } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { useIsWide } from "../-lib/media";

/**
 * 搜索结果页在内容卡片里的排法：左边是名单那一栏（抬头常驻，名单在它下面自己滚动），
 * 宽屏时右边一栏常驻线程或人的详情。
 * 每一块由路由接好数据再放进来；在哪个断点出现、滚动归谁，只在这里定。
 *
 * - `header`：名单那一栏的抬头（`QueryHeader`）
 * - `notices`：名单上方的几行——正在看较早的一次、条件那一排或关键词的框、筛选；没有就不留空
 * - `list`：名单（`ResultList`）
 * - `panel`：宽屏的右栏（`SidePanel`）
 * - `detailModal`：窄屏的人的详情浮层（`DetailModal`）
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
					disableContentFit
					viewportProps={{
						className: "data-has-overflow-y:overscroll-y-contain",
					}}
				>
					<main
						aria-label="搜索结果"
						className="mx-auto w-full max-w-page px-6 py-5"
						id="main"
						tabIndex={-1}
					>
						{notices && (
							<div className="mb-4 flex flex-col gap-4">{notices}</div>
						)}
						{list}
					</main>
				</ScrollArea>
			</div>
			{wide ? <div className="h-full max-xl:hidden">{panel}</div> : detailModal}
		</div>
	);
}
