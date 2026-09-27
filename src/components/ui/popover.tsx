"use client";

import {
	Popover as BasePopover,
	type PopoverPopupProps as BasePopoverPopupProps,
	type PopoverPositionerProps as BasePopoverPositionerProps,
} from "@base-ui/react/popover";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useState,
} from "react";
import {
	defaultPortalContainer,
	FloatingLayerProvider,
	type Placement,
	placementMap,
	triggerRender,
} from "#/components/ui/floating";
import { resolveNativeButton } from "#/components/ui/native-button";
import { cn } from "#/lib/utils";

/*
 * 气泡卡片，样式在 popover.css。默认悬停打开（进出各等 0.1 秒），`trigger="click"`
 * 改成点击。子元素是单个元素，触发器的属性与 ref 合进它本身（见 floating.ts）。弹出层的定位器同时是
 * 里面提示的 portal 容器。
 *
 * `className` 落在浮层（popup）上。portal 到 `<body>`；定位器的 z 值是
 * `--z-index-popup` 这一档，不按打开先后另分配（见 floating.ts）。
 */

type PopoverTrigger = "hover" | "click";

interface PopoverProps {
	/** 朝触发器伸出一个 12×6 的小三角，浮层与触发器的间距从 6px 放到 10px。 */
	arrow?: boolean;
	/** 触发器，单个元素。 */
	children: ReactElement;
	className?: string;
	content: ReactNode;
	/** 触发器是不是原生 `<button>`；不给时按子元素判断。 */
	nativeButton?: boolean;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	placement?: Placement;
	popupProps?: Pick<BasePopoverPopupProps, "aria-label">;
	positionerProps?: Pick<BasePopoverPositionerProps, "positionMethod">;
	trigger?: PopoverTrigger;
}

/** 悬停打开、离开收起前各等的毫秒数。 */
const HOVER_DELAY = 100;

export function Popover({
	arrow = false,
	children,
	content,
	trigger = "hover",
	placement = "top",
	className,
	open,
	onOpenChange,
	nativeButton,
	positionerProps,
	popupProps,
}: PopoverProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const [positionerNode, setPositionerNode] = useState<HTMLDivElement | null>(
		null,
	);
	const openOnHover = trigger === "hover";

	/*
	 * Base UI 的 Popover.Trigger 总挂着点击：悬停打开后再按一下会以 `trigger-press`
	 * 重新打开并钉住，移开也不关。只认悬停的触发器要取消这种打开。
	 */
	const handleOpenChange = useCallback(
		(
			nextOpen: boolean,
			eventDetails: { cancel: () => void; reason: string },
		) => {
			if (openOnHover && nextOpen && eventDetails.reason === "trigger-press") {
				eventDetails.cancel();
				return;
			}
			onOpenChange?.(nextOpen);
			if (open === undefined) setUncontrolledOpen(nextOpen);
		},
		[onOpenChange, open, openOnHover],
	);

	const { align, side } = placementMap[placement];

	return (
		<BasePopover.Root
			onOpenChange={handleOpenChange}
			open={open ?? uncontrolledOpen}
		>
			<BasePopover.Trigger
				closeDelay={HOVER_DELAY}
				delay={HOVER_DELAY}
				nativeButton={resolveNativeButton(children, nativeButton)}
				openOnHover={openOnHover}
				render={triggerRender(children)}
			/>
			<BasePopover.Portal container={defaultPortalContainer()}>
				<BasePopover.Positioner
					{...positionerProps}
					align={align}
					className="ui-popover-positioner"
					data-placement={placement}
					ref={setPositionerNode}
					side={side}
					sideOffset={arrow ? 10 : 6}
				>
					<FloatingLayerProvider value={positionerNode}>
						<BasePopover.Popup
							{...popupProps}
							className={cn("ui-popover-popup", className)}
						>
							{arrow && (
								<BasePopover.Arrow className="ui-popover-arrow">
									<svg
										aria-hidden="true"
										height="6"
										viewBox="0 0 12 6"
										width="12"
									>
										<path d="M0 6L6 0L12 6Z" data-role="fill" />
										<path d="M0 6L6 0L12 6" data-role="stroke" />
									</svg>
								</BasePopover.Arrow>
							)}
							<BasePopover.Viewport className="ui-popover-viewport">
								{content}
							</BasePopover.Viewport>
						</BasePopover.Popup>
					</FloatingLayerProvider>
				</BasePopover.Positioner>
			</BasePopover.Portal>
		</BasePopover.Root>
	);
}
