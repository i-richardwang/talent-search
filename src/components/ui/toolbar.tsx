"use client";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { Center } from "#/components/ui/flex";
import { cn } from "#/lib/utils";

/*
 * 一排按钮的容器：描边面加一层投影，根是横排、内边距 2 的 `Center`；样式在 toolbar.css。
 * 行为用 Base UI 的 Toolbar：`role="toolbar"`，左右方向键在 `ToolbarButton` 之间移动焦点。
 * 按钮由调用处经 `ToolbarButton` 的 `render` 交进来。分隔用 `ToolbarSeparator`，
 * 长相是 divider.css 的竖线。
 */

interface ToolbarProps
	extends Omit<
		ToolbarPrimitive.Root.Props,
		"className" | "orientation" | "disabled"
	> {
	className?: string;
}

export function Toolbar({ className, ...props }: ToolbarProps) {
	return (
		<ToolbarPrimitive.Root
			className={cn("ui-toolbar", className)}
			render={<Center horizontal padding={2} />}
			{...props}
		/>
	);
}

export const ToolbarButton: typeof ToolbarPrimitive.Button =
	ToolbarPrimitive.Button;

/** 栏里的一条竖向分隔线（divider.css 的竖向样式）。 */
export function ToolbarSeparator(
	props: Omit<ToolbarPrimitive.Separator.Props, "className">,
) {
	return (
		<ToolbarPrimitive.Separator
			className="ui-divider ui-divider-vertical"
			{...props}
		/>
	);
}
