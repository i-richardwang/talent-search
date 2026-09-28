"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import {
	defaultPortalContainer,
	placementMap,
	triggerRender,
	useFloatingLayer,
} from "#/components/ui/floating";
import { Hotkey } from "#/components/ui/hotkey";
import { cn } from "#/lib/utils";

/*
 * `title` 与 `hotkey` 都没有时直接返回 children。触发器是单个元素，属性与 ref 合进它本身，
 * 不另包一层（见 floating.ts）。每个提示只有一个触发器，不在多个触发器之间共用浮层。
 */

const OPEN_DELAY = 400;
const CLOSE_DELAY = 100;

export interface TooltipProps {
	children: ReactElement;
	/** 落在浮层上。 */
	className?: string;
	/** 写法同 Hotkey 的 `keys`（`mod+k`）。 */
	hotkey?: string;
	placement?: "top" | "bottom";
	title?: ReactNode;
}

export function Tooltip({
	children,
	title,
	className,
	hotkey,
	placement = "top",
}: TooltipProps) {
	const floatingLayer = useFloatingLayer();

	if (title == null && !hotkey) return children;

	const child = children as ReactElement<Record<string, unknown>>;
	// 子元素本身是某个弹层的触发器（带 aria-haspopup 与 id）时，提示的触发器沿用它的 id。
	const popupTriggerId =
		child.props["aria-haspopup"] !== undefined &&
		typeof child.props.id === "string"
			? child.props.id
			: undefined;
	const { align, side } = placementMap[placement];

	return (
		<BaseTooltip.Root>
			<BaseTooltip.Trigger
				closeDelay={CLOSE_DELAY}
				delay={OPEN_DELAY}
				id={popupTriggerId}
				render={triggerRender(children)}
			/>
			<BaseTooltip.Portal container={floatingLayer ?? defaultPortalContainer()}>
				<BaseTooltip.Positioner
					align={align}
					className="ui-tooltip-positioner"
					data-placement={placement}
					side={side}
					sideOffset={6}
				>
					<BaseTooltip.Popup className={cn("ui-tooltip-popup", className)}>
						<BaseTooltip.Viewport className="ui-tooltip-viewport">
							{title}
							{hotkey ? <Hotkey compact keys={hotkey} /> : null}
						</BaseTooltip.Viewport>
					</BaseTooltip.Popup>
				</BaseTooltip.Positioner>
			</BaseTooltip.Portal>
		</BaseTooltip.Root>
	);
}
