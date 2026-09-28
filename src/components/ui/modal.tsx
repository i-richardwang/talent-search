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
 * `Modal` 是组合好的一件，`Modal*` 原子件可以自己拼；出场放完才卸载（见 dialog-presence.tsx）。
 * 动手之前问一句用 `confirmModal(...)`：不需要 React 上下文，由根上挂一次的 `<ModalHost />` 画出来。
 * z 值是 `--z-index-popup` 这一档，不按打开先后另分配（见 floating.ts）。
 */

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

/** `panelClassName` 落在面板上，宽度由它给（`max-w-*`）。 */
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

/** `flush` 去掉内边距，给自己排满整块面板的内容。 */
export function ModalContent({
	children,
	flush,
}: {
	children: ReactNode;
	flush?: boolean;
}) {
	return (
		<div className={cn("ui-modal-content", flush && "ui-modal-content-flush")}>
			{children}
		</div>
	);
}

function ModalClose() {
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
	/** 落在面板上，宽度由它给（`max-w-*`）。 */
	className?: string;
	/** 不要「取消 / 确定」表脚。 */
	noFooter?: boolean;
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
					<ModalContent>{children}</ModalContent>
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

interface ConfirmConfig {
	title: ReactNode;
	content?: ReactNode;
	okText?: ReactNode;
	/**
	 * 返回 Promise 时确定钮转圈，兑现后关上；抛错时留着对话框、确定钮恢复可点，
	 * 出错的说明由调用处自己给。
	 */
	onOk?: () => void | Promise<void>;
}

interface ConfirmEntry {
	config: ConfirmConfig;
	id: number;
	open: boolean;
}

/* 关上先把那一项的 open 置假，出场动画放完再从列表里拿掉。 */
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

/** 删除这类收不回的动作前问一句，确定钮是危险色。点背板、按 Esc、关闭钮和取消都算取消。 */
export function confirmModal(config: ConfirmConfig) {
	const id = confirmSeed++;
	setConfirmStack([...confirmStack, { config, id, open: true }]);
}

function ConfirmDialog({ entry }: { entry: ConfirmEntry }) {
	const { config, id, open } = entry;
	const [loading, setLoading] = useState(false);
	const cancel = () => closeConfirm(id);
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
							<Button onClick={cancel}>取消</Button>
							<Button
								danger
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

/** 在应用根上挂一次。 */
export function ModalHost() {
	const stack = useSyncExternalStore(
		subscribeConfirms,
		() => confirmStack,
		() => NO_CONFIRMS,
	);
	return stack.map((entry) => <ConfirmDialog entry={entry} key={entry.id} />);
}
