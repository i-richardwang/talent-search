"use client";

import {
	Tooltip as BaseTooltip,
	type TooltipPositionerProps as BaseTooltipPositionerProps,
} from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import {
	defaultPortalContainer,
	type Placement,
	placementMap,
	triggerRender,
	useFloatingLayer,
} from "#/components/ui/floating";
import { Hotkey } from "#/components/ui/hotkey";
import { cn } from "#/lib/utils";

/*
 * 文字提示，样式在 tooltip.css。默认在触发器上方居中（`placement` 可改），悬停或聚焦
 * 400ms 后出现，离开 100ms 后收起；`title` 与 `hotkey` 都没有时直接返回 children。
 * 触发器是单个元素，触发器的属性与 ref 合进它本身，不另包一层（见 floating.ts）。
 *
 * - `hotkey` 画在文字后面，是收进一个键帽的 Hotkey（`compact`），两者隔 6px。
 * - 每个提示只有一个触发器，不在多个触发器之间共用浮层。
 * - `className` 落在浮层（popup）上。
 * - 不在弹出层里时 portal 到 `<body>`（见 floating.ts）。
 * - 定位器的 z 值是弹层档 `--z-index-popup`（写在 tooltip.css）。
 */

const OPEN_DELAY = 400;
const CLOSE_DELAY = 100;

export interface TooltipProps {
	/** 触发器。 */
	children: ReactElement;
	className?: string;
	/** 快捷键，写法同 Hotkey 的 `keys`（`mod+k`）。 */
	hotkey?: string;
	placement?: Placement;
	positionerProps?: Omit<
		BaseTooltipPositionerProps,
		"className" | "style" | "children" | "side" | "align"
	>;
	title?: ReactNode;
}

export function Tooltip({
	children,
	title,
	className,
	hotkey,
	placement = "top",
	positionerProps,
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
					{...positionerProps}
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
