"use client";

import { Dialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { AnimatePresence, type MotionProps, motion } from "motion/react";
import { type ReactElement, type ReactNode, useRef } from "react";
import {
	DialogPresenceBackdrop,
	DialogPresenceRoot,
	useDialogPresence,
} from "#/components/ui/dialog-presence";
import { defaultPortalContainer } from "#/components/ui/floating";
import { panelTransition } from "#/components/ui/motion-token";
import { cn } from "#/lib/utils";

/*
 * 抽屉：`Drawer` 是组合好的一件，下面的 `Drawer*` 原子件可以自己拼。出场动画放完才卸载
 * （见 dialog-presence.tsx）。背板和浮层都在 `--z-index-popup` 这一档，portal 到 `<body>`，
 * 按打开先后接在末尾，后开的压住先开的（与 floating.ts 同一套规则）。
 */

type DrawerPlacement = "left" | "right";

const offscreen: Record<DrawerPlacement, { x: string }> = {
	left: { x: "-100%" },
	right: { x: "100%" },
};

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

/** `container` 不给时 portal 到 `<body>`；给了就挂进它（`DrawerPopup` 同时传 `contained`）。 */
export function DrawerPortal({
	children,
	container,
}: {
	children: ReactNode;
	container?: HTMLElement | null;
}) {
	return (
		<Dialog.Portal container={container ?? defaultPortalContainer()}>
			{children}
		</Dialog.Portal>
	);
}

export function DrawerBackdrop() {
	return <DialogPresenceBackdrop className="ui-drawer-backdrop" />;
}

/**
 * 贴边的面板。`width` 收任何 CSS 长度，比视口宽时由浮层夹到视口宽。
 * `contained`：浮层不贴视口，绝对定位在 portal 进去的那个容器里，贴着容器的边滑出。
 */
export function DrawerPopup({
	children,
	contained = false,
	panelClassName,
	placement: placementProp = "right",
	width: widthProp,
}: {
	children: ReactNode;
	contained?: boolean;
	panelClassName?: string;
	placement?: DrawerPlacement;
	width: string;
}) {
	const { onExitComplete, open } = useDialogPresence();

	/*
	 * 退场中的面板在 AnimatePresence 里留着打开时的属性，浮层却按调用处这一次给的重画。
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
			className={cn(
				"ui-drawer-popup",
				`ui-drawer-popup-${placement}`,
				contained && "ui-drawer-popup-contained",
			)}
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

/**
 * 抽屉的标题，读屏拿它当抽屉的名字。抽屉里放的是一栏自带页头的内容（`NavHeader`）时，
 * `render` 传页头里那个 `NavHeaderTitle`，不另画一行。
 */
export function DrawerTitle({
	children,
	render,
}: {
	children: ReactNode;
	render?: ReactElement;
}) {
	return (
		<Dialog.Title
			className={render ? undefined : "ui-drawer-title"}
			render={render}
		>
			{children}
		</Dialog.Title>
	);
}

export const DrawerDescription = Dialog.Description;

function DrawerClose() {
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
	/** 没有头部，关闭按钮浮在右上角。 */
	noHeader?: boolean;
	onClose: () => void;
	open: boolean;
	placement?: DrawerPlacement;
	title?: ReactNode;
	width?: string;
}

export function Drawer({
	open,
	placement = "right",
	width = "var(--container-detail)",
	title,
	extra,
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
						<div className="ui-drawer-extra ui-drawer-extra-floating">
							<DrawerClose />
						</div>
					) : (
						<div className="ui-drawer-header">
							{title === undefined ? (
								<span />
							) : (
								<DrawerTitle>{title}</DrawerTitle>
							)}
							<div className="ui-drawer-extra">
								{extra}
								<DrawerClose />
							</div>
						</div>
					)}
					<div className="ui-drawer-content">
						<div className="ui-drawer-body-content">{children}</div>
					</div>
				</DrawerPopup>
			</DrawerPortal>
		</DrawerRoot>
	);
}
