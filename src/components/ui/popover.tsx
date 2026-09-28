"use client";

import {
	Popover as BasePopover,
	type PopoverPopupProps as BasePopoverPopupProps,
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
 * 子元素是单个元素，触发器的属性与 ref 合进它本身（见 floating.ts）。定位器同时是里面提示的
 * portal 容器；z 值是 `--z-index-popup` 这一档，不按打开先后另分配。
 */

type PopoverTrigger = "hover" | "click";

interface PopoverProps {
	children: ReactElement;
	/** 落在浮层上。 */
	className?: string;
	content: ReactNode;
	/** 触发器是不是原生 `<button>`；不给时按子元素判断。 */
	nativeButton?: boolean;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	placement?: Placement;
	popupProps?: Pick<BasePopoverPopupProps, "aria-label">;
	trigger?: PopoverTrigger;
}

/** 悬停打开、离开收起前各等的毫秒数。 */
const HOVER_DELAY = 100;

export function Popover({
	children,
	content,
	trigger = "hover",
	placement = "top",
	className,
	open,
	onOpenChange,
	nativeButton,
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
					align={align}
					className="ui-popover-positioner"
					data-placement={placement}
					ref={setPositionerNode}
					side={side}
					sideOffset={6}
				>
					<FloatingLayerProvider value={positionerNode}>
						<BasePopover.Popup
							{...popupProps}
							className={cn("ui-popover-popup", className)}
						>
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
