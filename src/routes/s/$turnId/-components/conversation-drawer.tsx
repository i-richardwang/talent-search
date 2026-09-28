import { MessagesSquareIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { NavHeaderTitle } from "#/components/ui/app-layout";
import { Button } from "#/components/ui/button";
import {
	DrawerBackdrop,
	DrawerPopup,
	DrawerPortal,
	DrawerRoot,
	DrawerTitle,
} from "#/components/ui/drawer";
import { PaneHeader } from "./pane-header";

/**
 * 窄屏上的对话：名单上方一个「对话」按钮，点开从右侧拉出线程。宽屏的线程在右栏
 * （`SidePanel`），这个只在窄屏时挂（`WorkspaceLayout`）：抽屉是模态，藏起来也抓焦点。
 *
 * 抽屉里就是右栏那一栏：顶上同一条页头（`PaneHeader`），标题「对话」，行尾是关闭钮；
 * 下面线程自带滚动区和输入框，占满页头以下的整块。
 */
export function ConversationDrawer({
	open,
	onOpenChange,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** 对话线程（`Thread`） */
	children: ReactNode;
}) {
	return (
		<>
			<Button
				icon={MessagesSquareIcon}
				onClick={() => onOpenChange(true)}
				size="small"
			>
				对话
			</Button>
			<DrawerRoot onOpenChange={onOpenChange} open={open}>
				<DrawerPortal>
					<DrawerBackdrop />
					<DrawerPopup width="var(--container-detail)">
						<PaneHeader
							title={
								<DrawerTitle render={<NavHeaderTitle as="h2" />}>
									对话
								</DrawerTitle>
							}
							right={
								<ActionIcon
									icon={XIcon}
									onClick={() => onOpenChange(false)}
									size="header"
									title="关闭对话"
								/>
							}
						/>
						<div className="min-h-0 flex-1">{children}</div>
					</DrawerPopup>
				</DrawerPortal>
			</DrawerRoot>
		</>
	);
}
