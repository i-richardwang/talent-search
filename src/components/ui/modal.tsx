"use client";

import { Dialog } from "@base-ui/react/dialog";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useState, useSyncExternalStore } from "react";
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
 *
 * 动手之前问一句用 `confirmModal(...)`：不需要 React 上下文，事件处理里直接调，
 * 由根上挂一次的 `<ModalHost />` 画出来（见文件末尾）。
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

/** `confirmModal` 的一问。 */
export interface ConfirmConfig {
	title: ReactNode;
	content?: ReactNode;
	okText?: ReactNode;
	cancelText?: ReactNode;
	/** 确定钮换成错误色的实底：删除这类收不回的动作。 */
	danger?: boolean;
	/**
	 * 点确定时调用。返回 Promise 时确定钮转圈，兑现后关上；抛错时留着对话框、
	 * 确定钮恢复可点，出错的说明由调用处自己给。
	 */
	onOk?: () => void | Promise<void>;
	onCancel?: () => void;
}

interface ConfirmEntry {
	config: ConfirmConfig;
	id: number;
	open: boolean;
}

/*
 * 命令式的确认框：一张列表加一组订阅者，`<ModalHost />` 用 useSyncExternalStore 读它。
 * 关上先把那一项的 open 置假，出场动画放完再从列表里拿掉。
 */
let confirmStack: ConfirmEntry[] = [];
let confirmSeed = 0;
const confirmListeners = new Set<() => void>();

function setConfirmStack(next: ConfirmEntry[]) {
	confirmStack = next;
	for (const listener of confirmListeners) listener();
}

const subscribeConfirms = (listener: () => void) => {
	confirmListeners.add(listener);
	return () => {
		confirmListeners.delete(listener);
	};
};

const NO_CONFIRMS: ConfirmEntry[] = [];

const closeConfirm = (id: number) =>
	setConfirmStack(
		confirmStack.map((entry) =>
			entry.id === id ? { ...entry, open: false } : entry,
		),
	);

/**
 * 打开一个确认框：宽 420px，标题栏、一段正文、「取消 / 确定」表脚。点背板、按 Esc、
 * 关闭钮和取消都算取消。返回 `close`，调用处可以提前关上它。
 */
export function confirmModal(config: ConfirmConfig): { close: () => void } {
	const id = confirmSeed++;
	setConfirmStack([...confirmStack, { config, id, open: true }]);
	return { close: () => closeConfirm(id) };
}

function ConfirmDialog({ entry }: { entry: ConfirmEntry }) {
	const { config, id, open } = entry;
	const [loading, setLoading] = useState(false);
	const cancel = () => {
		closeConfirm(id);
		config.onCancel?.();
	};
	const ok = async () => {
		if (config.onOk) {
			setLoading(true);
			try {
				await config.onOk();
			} catch {
				setLoading(false);
				return;
			}
		}
		closeConfirm(id);
	};
	return (
		<ModalRoot
			onExitComplete={() =>
				setConfirmStack(confirmStack.filter((item) => item.id !== id))
			}
			onOpenChange={(nextOpen) => {
				if (open && !nextOpen) cancel();
			}}
			open={open}
		>
			<ModalPortal>
				<ModalBackdrop />
				<ModalPopup panelClassName="ui-modal-confirm">
					<div className="ui-modal-header">
						<ModalTitle>{config.title}</ModalTitle>
						<ModalClose />
					</div>
					<ModalContent flush>
						{config.content && (
							<div className="ui-modal-confirm-body">{config.content}</div>
						)}
						<div className="ui-modal-footer">
							<Button onClick={cancel}>{config.cancelText ?? "取消"}</Button>
							<Button
								danger={config.danger}
								loading={loading}
								onClick={() => void ok()}
								type="primary"
							>
								{config.okText ?? "确定"}
							</Button>
						</div>
					</ModalContent>
				</ModalPopup>
			</ModalPortal>
		</ModalRoot>
	);
}

/** 画出 `confirmModal` 打开的确认框；在应用根上挂一次。 */
export function ModalHost() {
	const stack = useSyncExternalStore(
		subscribeConfirms,
		() => confirmStack,
		() => NO_CONFIRMS,
	);
	return stack.map((entry) => <ConfirmDialog entry={entry} key={entry.id} />);
}
