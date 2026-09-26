"use client";

import {
	Tooltip as BaseTooltip,
	type TooltipPositionerProps as BaseTooltipPositionerProps,
} from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import {
	defaultPortalContainer,
	triggerRender,
	useFloatingLayer,
} from "#/components/ui/floating";
import { cn } from "#/lib/utils";

/*
 * 文字提示，样式在 tooltip.css。在触发器上方居中，悬停或聚焦 400ms 后出现，
 * 离开 100ms 后收起；没有 `title` 时直接返回 children。
 * 触发器是单个元素，触发器的属性与 ref 合进它本身，不另包一层（见 floating.ts）。
 *
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
	positionerProps?: Omit<
		BaseTooltipPositionerProps,
		"className" | "style" | "children"
	>;
	title: ReactNode;
}

export function Tooltip({
	children,
	title,
	className,
	positionerProps,
}: TooltipProps) {
	const floatingLayer = useFloatingLayer();

	if (title == null) return children;

	const child = children as ReactElement<Record<string, unknown>>;
	// 子元素本身是某个弹层的触发器（带 aria-haspopup 与 id）时，提示的触发器沿用它的 id。
	const popupTriggerId =
		child.props["aria-haspopup"] !== undefined &&
		typeof child.props.id === "string"
			? child.props.id
			: undefined;

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
					className="ui-tooltip-positioner"
					side="top"
					sideOffset={6}
					{...positionerProps}
				>
					<BaseTooltip.Popup className={cn("ui-tooltip-popup", className)}>
						<BaseTooltip.Viewport className="ui-tooltip-viewport">
							{title}
						</BaseTooltip.Viewport>
					</BaseTooltip.Popup>
				</BaseTooltip.Positioner>
			</BaseTooltip.Portal>
		</BaseTooltip.Root>
	);
}
