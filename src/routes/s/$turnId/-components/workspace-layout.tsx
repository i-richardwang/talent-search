import type { ReactNode } from "react";
import { useIsWide } from "../-lib/media";

/** 两侧常驻栏的槽：吸在查询带下沿，高度是视口减去顶上那一叠，自己不滚动。 */
const STICKY_SLOT =
	"sticky top-(--chrome-height) h-[calc(100dvh-var(--chrome-height))] shrink-0";

/**
 * 搜索结果页的排法：查询带吸在顶栏下沿，下面左筛选栏、名单版心、右栏三列。
 * 每一块由路由接好数据再放进来；每一块在哪个断点出现、吸不吸顶、多高，只在这里定。
 *
 * - `deck`：查询带（`QueryDeck`）
 * - `rail`：左筛选栏（`FilterRail`），lg 以上常驻
 * - `filterButton`：lg 以下替代筛选栏的按钮（`FilterPopover`），在名单正上方
 * - `notices`：名单上方的几行——正在看较早的一次、关键词的框、提交失败；没有就不留空
 * - `list`：名单（`ResultList`）
 * - `keys`：版心下面的快捷键表脚（`KeyHints`）
 * - `panel`：宽屏的右栏（`SidePanel`）
 * - `conversationDrawer`：窄屏的对话按钮和抽屉（`ConversationDrawer`），关键词的链没有
 * - `detailModal`：窄屏的人的详情浮层（`DetailModal`）
 *
 * 宽窄两套右侧容器由 `useIsWide` 二选一地挂（理由见 media.ts）；右栏的槽另带
 * `max-xl:hidden`，兜住 JS 还没答话的首帧。
 */
export function WorkspaceLayout({
	deck,
	rail,
	filterButton,
	notices,
	list,
	keys,
	panel,
	conversationDrawer,
	detailModal,
}: {
	deck: ReactNode;
	rail: ReactNode;
	filterButton: ReactNode;
	notices?: ReactNode;
	list: ReactNode;
	keys: ReactNode;
	panel: ReactNode;
	conversationDrawer?: ReactNode;
	detailModal: ReactNode;
}) {
	const wide = useIsWide();
	return (
		<div className="mx-auto flex w-full max-w-app flex-1 flex-col">
			{deck}
			<div className="flex min-h-0 flex-1">
				<div className={`${STICKY_SLOT} max-lg:hidden`}>{rail}</div>
				<div className="flex min-w-0 flex-1 flex-col">
					<main
						aria-label="搜索结果"
						className="mx-auto w-full max-w-page px-4 pt-4 pb-16"
						id="main"
						tabIndex={-1}
					>
						{notices && (
							<div className="mb-4 flex flex-col gap-3">{notices}</div>
						)}
						<div className="mb-3 flex flex-wrap gap-2">
							<div className="lg:hidden">{filterButton}</div>
							{!wide && conversationDrawer}
						</div>
						{list}
					</main>
					{keys}
				</div>
				{wide ? (
					<div className={`${STICKY_SLOT} max-xl:hidden`}>{panel}</div>
				) : (
					detailModal
				)}
			</div>
		</div>
	);
}
