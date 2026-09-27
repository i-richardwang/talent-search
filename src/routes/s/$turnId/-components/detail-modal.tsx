import type { ReactNode } from "react";
import {
	ModalBackdrop,
	ModalContent,
	ModalPopup,
	ModalPortal,
	ModalRoot,
	ModalTitle,
} from "#/components/ui/modal";

/**
 * 窄屏上人的详情：没有右栏，点开一个人从名单上浮出一层，关掉回到名单。
 * Esc、焦点陷阱与焦点还原由 `Modal` 自带；关闭钮在详情自己的页头上。
 */
export function DetailModal({
	open,
	onClose,
	children,
}: {
	open: boolean;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<ModalRoot
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
			open={open}
		>
			<ModalPortal>
				<ModalBackdrop />
				<ModalPopup panelClassName="max-w-2xl">
					<ModalTitle className="sr-only">员工详情</ModalTitle>
					<ModalContent flush>{children}</ModalContent>
				</ModalPopup>
			</ModalPortal>
		</ModalRoot>
	);
}
