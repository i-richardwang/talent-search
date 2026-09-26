"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { Button } from "#/components/ui/button";
import {
	DialogPresenceBackdrop,
	DialogPresenceRoot,
	useDialogPresence,
} from "#/components/ui/dialog-presence";
import { defaultPortalContainer } from "#/components/ui/floating";
import { panelTransition } from "#/components/ui/motion-token";
import { cn } from "#/lib/utils";

/*
 * 样式在 modal.css。`Modal` 是组合好的一件：`open` 受控，关掉走 `onCancel`，
 * 有标题栏、关闭钮和「取消 / 确定」表脚。下面的 `Modal*` 原子件可以自己拼：
 * `ModalRoot` 的 `open` 受控，用 motion 放进出场，出场放完才卸载（见 dialog-presence.tsx）。
 * 对话框挂在打开它的组件里；关着的对话框卸载。按 Esc、点背板或关闭钮关闭。
 *
 * 默认文案：确定、取消；`ModalClose` 带 `aria-label="关闭"`。
 * portal 到 `<body>`；z 值是 `--z-index-popup` 这一档，不按打开先后另分配
 * （见 floating.ts）。
 */

/** 面板的进出场；时长与曲线读动效令牌（见 motion-token.ts）。 */
const modalMotionConfig = () => ({
	animate: { opacity: 1, scale: 1 },
	exit: {
		opacity: 0,
		scale: 0.98,
		transition: panelTransition("modal", "exit"),
	},
	initial: { opacity: 0, scale: 0.97 },
	transition: panelTransition("modal", "enter"),
});

export const ModalRoot = DialogPresenceRoot;

export function ModalPortal({ children }: { children: ReactNode }) {
	return (
		<Dialog.Portal container={defaultPortalContainer()}>
			{children}
		</Dialog.Portal>
	);
}

export function ModalBackdrop() {
	return <DialogPresenceBackdrop className="ui-modal-backdrop" />;
}

/**
 * 铺满视口的外层里居中一块面板；`panelClassName` 落在面板（圆角、底色那一层）上，
 * 宽度由它给（`max-w-*`），不给是 modal.css 的默认宽度。
 */
export function ModalPopup({
	children,
	panelClassName,
}: {
	children: ReactNode;
	panelClassName?: string;
}) {
	const { onExitComplete, open } = useDialogPresence();
	return (
		<Dialog.Popup className="ui-modal-popup">
			<AnimatePresence onExitComplete={onExitComplete}>
				{open ? (
					<motion.div
						{...modalMotionConfig()}
						className={cn("ui-modal-popup-inner", panelClassName)}
						key="modal-popup-panel"
					>
						{children}
					</motion.div>
				) : null}
			</AnimatePresence>
		</Dialog.Popup>
	);
}

export function ModalTitle({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<Dialog.Title className={cn("ui-modal-title", className)}>
			{children}
		</Dialog.Title>
	);
}

/** 正文区，带内边距；`flush` 去掉内边距，给自己排满整块面板的内容。 */
export function ModalContent({
	children,
	className,
	flush,
}: {
	children: ReactNode;
	className?: string;
	flush?: boolean;
}) {
	return (
		<div
			className={cn(
				"ui-modal-content",
				flush && "ui-modal-content-flush",
				className,
			)}
		>
			{children}
		</div>
	);
}

/**
 * 关闭钮，里面是一颗 ×。放在标题栏里随行排；直接放在面板里时浮在面板右上角
 * （modal.css 按它的位置定）。
 */
export function ModalClose() {
	return (
		<Dialog.Close aria-label="关闭" className="ui-modal-close">
			<X size={16} />
		</Dialog.Close>
	);
}

interface ModalProps {
	/** 退场动画放完之后调用。 */
	afterClose?: () => void;
	children: ReactNode;
	/** 面板上的类名；宽度也由它给（`max-w-*`）。 */
	className?: string;
	/** 正文换成等待圈。 */
	loading?: boolean;
	/** 不要「取消 / 确定」表脚。 */
	noFooter?: boolean;
	/** 确定钮前面的图标。 */
	okIcon?: LucideIcon;
	okText?: ReactNode;
	onCancel: () => void;
	onOk?: () => void;
	open: boolean;
	title: ReactNode;
}

export function Modal({
	open,
	title,
	children,
	onOk,
	onCancel,
	okText = "确定",
	okIcon,
	noFooter,
	className,
	loading,
	afterClose,
}: ModalProps) {
	return (
		<ModalRoot
			onExitComplete={afterClose}
			onOpenChange={(nextOpen) => {
				if (open && !nextOpen) onCancel();
			}}
			open={open}
		>
			<ModalPortal>
				<ModalBackdrop />
				<ModalPopup panelClassName={className}>
					<div className="ui-modal-header">
						<ModalTitle>{title}</ModalTitle>
						<ModalClose />
					</div>
					<ModalContent>
						{loading ? (
							<div className="ui-modal-loading">
								<span className="ui-spinner ui-modal-spinner" />
							</div>
						) : (
							children
						)}
					</ModalContent>
					{!noFooter && (
						<div className="ui-modal-footer">
							<Button onClick={onCancel}>取消</Button>
							<Button icon={okIcon} onClick={onOk} type="primary">
								{okText}
							</Button>
						</div>
					)}
				</ModalPopup>
			</ModalPortal>
		</ModalRoot>
	);
}
