import { MessagesSquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import {
	DrawerBackdrop,
	DrawerClose,
	DrawerExtra,
	DrawerHeader,
	DrawerPopup,
	DrawerPortal,
	DrawerRoot,
	DrawerTitle,
} from "#/components/ui/drawer";

/**
 * 窄屏上的对话：名单上方一个「对话」按钮，点开从右侧拉出线程。宽屏的线程在右栏
 * （`SidePanel`），这个只在窄屏时挂（`WorkspaceLayout`）：抽屉是模态，藏起来也抓焦点。
 *
 * 线程自己带滚动区和输入框，要占满头部以下的整块，所以用抽屉的原子件拼，
 * 不放进 `Drawer` 带内边距的正文；关闭按钮照 `Drawer` 放进 `DrawerExtra`。
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
						<DrawerHeader>
							<DrawerTitle>对话</DrawerTitle>
							<DrawerExtra>
								<DrawerClose />
							</DrawerExtra>
						</DrawerHeader>
						<div className="min-h-0 flex-1">{children}</div>
					</DrawerPopup>
				</DrawerPortal>
			</DrawerRoot>
		</>
	);
}
