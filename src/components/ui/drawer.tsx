"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import { type ReactNode, useRef } from "react";
import {
	DialogPresenceBackdrop,
	DialogPresenceRoot,
	useDialogPresence,
} from "#/components/ui/dialog-presence";
import { defaultPortalContainer } from "#/components/ui/floating";
import { panelTransition } from "#/components/ui/motion-token";
import { cn } from "#/lib/utils";

/*
 * 抽屉，样式在 drawer.css。`Drawer` 是组合好的一件：贴着左边或右边的面板，`open` 受控，
 * 走 motion 的进出动画，出场放完才卸载（见 dialog-presence.tsx）。下面的 `Drawer*`
 * 原子件可以自己拼。
 *
 * - 关闭按钮的 aria-label 是「关闭」。按 Esc 或点背板关闭。
 * - 背板和浮层都在 `--z-index-popup` 这一档，portal 到 `<body>`，按打开先后接在
 *   末尾，后开的压住先开的（与 floating.ts 同一口径）。
 * - 拼装用的原子件：`DrawerRoot`、`DrawerPortal`、`DrawerBackdrop`、`DrawerPopup`、
 *   `DrawerHeader`、`DrawerTitle`、`DrawerDescription`、`DrawerClose`、`DrawerExtra`、
 *   `DrawerFooter`。
 *   `DrawerExtra` 是头部右侧放关闭按钮的那一格；自己拼头部时关闭按钮放进它，
 *   位置才和 `Drawer` 的一致。`DrawerFooter` 是面板底部的一条，内容靠右。
 * - `extra` 排在头部右侧、关闭按钮左边；`footer` 在正文下面，上面一根分隔线，
 *   不随正文滚动。
 * - `width` 收任何 CSS 长度，如 `min(92vw, 520px)`；比视口宽时由浮层夹到视口宽。
 */

type DrawerPlacement = "left" | "right";

const offscreen: Record<DrawerPlacement, { x: string }> = {
	left: { x: "-100%" },
	right: { x: "100%" },
};

/** 面板的滑入滑出；时长与曲线读动效令牌（见 motion-token.ts）。 */
const drawerMotionConfig = (placement: DrawerPlacement): MotionProps => ({
	animate: { x: 0 },
	exit: {
		...offscreen[placement],
		transition: panelTransition("drawer", "exit"),
	},
	initial: offscreen[placement],
	transition: panelTransition("drawer", "enter"),
});

export const DrawerRoot = DialogPresenceRoot;

export function DrawerPortal({ children }: { children: ReactNode }) {
	return (
		<Dialog.Portal container={defaultPortalContainer()}>
			{children}
		</Dialog.Portal>
	);
}

export function DrawerBackdrop() {
	return <DialogPresenceBackdrop className="ui-drawer-backdrop" />;
}

/**
 * 贴边的面板；`width` 是面板宽度，`placement` 是贴哪条边，默认右边。
 * `panelClassName` 加在面板上，给换了底色、描边和投影的一种面板（导航栏的抽屉）用。
 */
export function DrawerPopup({
	children,
	panelClassName,
	placement: placementProp = "right",
	width: widthProp,
}: {
	children: ReactNode;
	panelClassName?: string;
	placement?: DrawerPlacement;
	width: number | string;
}) {
	const { onExitComplete, open } = useDialogPresence();

	/*
	 * 退场中的面板在 AnimatePresence 里留着打开时的属性，浮层却按调用处现在给的重画。
	 * 退场期间冻住几何，关的同时换了方位也不会让浮层先跳到另一条边。
	 */
	const openGeometryRef = useRef({
		placement: placementProp,
		width: widthProp,
	});
	if (open) {
		openGeometryRef.current = { placement: placementProp, width: widthProp };
	}
	const { placement, width } = openGeometryRef.current;

	return (
		<Dialog.Popup
			className={cn("ui-drawer-popup", `ui-drawer-popup-${placement}`)}
			style={{ width }}
		>
			<AnimatePresence onExitComplete={onExitComplete}>
				{open ? (
					<motion.div
						{...drawerMotionConfig(placement)}
						className={cn(
							"ui-drawer-panel",
							`ui-drawer-panel-${placement}`,
							panelClassName,
						)}
						key="drawer-popup-panel"
					>
						{children}
					</motion.div>
				) : null}
			</AnimatePresence>
		</Dialog.Popup>
	);
}

export function DrawerHeader({ children }: { children: ReactNode }) {
	return <div className="ui-drawer-header">{children}</div>;
}

export function DrawerTitle({ children }: { children: ReactNode }) {
	return <Dialog.Title className="ui-drawer-title">{children}</Dialog.Title>;
}

export const DrawerDescription = Dialog.Description;

/** 头部右侧的一格：放关闭按钮，右缘伸进头部内边距 4px。 */
export function DrawerExtra({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("ui-drawer-extra", className)}>{children}</div>;
}

/** 面板底部的一条：上面一根分隔线，内容靠右排。 */
export function DrawerFooter({ children }: { children: ReactNode }) {
	return (
		<div className="ui-drawer-footer">
			<div className="ui-drawer-container-inner ui-drawer-container-inner-footer">
				{children}
			</div>
		</div>
	);
}

export function DrawerClose() {
	return (
		<Dialog.Close aria-label="关闭" className="ui-drawer-close">
			<X size={16} />
		</Dialog.Close>
	);
}

interface DrawerProps {
	/** 退场动画放完之后调用。 */
	afterClose?: () => void;
	children: ReactNode;
	/** 头部右侧、关闭按钮左边的动作。 */
	extra?: ReactNode;
	/** 正文下面的一条，内容靠右，不随正文滚动。 */
	footer?: ReactNode;
	/** 没有头部，关闭按钮（连同 `extra`）浮在右上角。 */
	noHeader?: boolean;
	onClose: () => void;
	open: boolean;
	placement?: DrawerPlacement;
	title?: ReactNode;
	/** 面板宽度，默认是详情那一档 `--container-detail`。 */
	width?: number | string;
}

export function Drawer({
	open,
	placement = "right",
	width = "var(--container-detail)",
	title,
	extra,
	footer,
	noHeader,
	afterClose,
	onClose,
	children,
}: DrawerProps) {
	return (
		<DrawerRoot
			onExitComplete={afterClose}
			onOpenChange={(nextOpen) => {
				if (open && !nextOpen) onClose();
			}}
			open={open}
		>
			<DrawerPortal>
				<DrawerBackdrop />
				<DrawerPopup placement={placement} width={width}>
					{noHeader ? (
						<DrawerExtra className="ui-drawer-extra-floating">
							{extra}
							<DrawerClose />
						</DrawerExtra>
					) : (
						<DrawerHeader>
							<div className="ui-drawer-container-inner">
								{title === undefined ? (
									<span />
								) : (
									<DrawerTitle>{title}</DrawerTitle>
								)}
								<DrawerExtra>
									{extra}
									<DrawerClose />
								</DrawerExtra>
							</div>
						</DrawerHeader>
					)}
					<div className="ui-drawer-content">
						<div className="ui-drawer-body-content">{children}</div>
					</div>
					{footer && <DrawerFooter>{footer}</DrawerFooter>}
				</DrawerPopup>
			</DrawerPortal>
		</DrawerRoot>
	);
}
