"use client";

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { Center } from "#/components/ui/flex";
import { cn } from "#/lib/utils";

/* 左右方向键在 `ToolbarButton` 之间移动焦点；按钮由调用处经 `ToolbarButton` 的 `render` 交进来。 */

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
			render={<Center gap={4} horizontal />}
			{...props}
		/>
	);
}

export const ToolbarButton: typeof ToolbarPrimitive.Button =
	ToolbarPrimitive.Button;

export function ToolbarSeparator(
	props: Omit<ToolbarPrimitive.Separator.Props, "className">,
) {
	return (
		<ToolbarPrimitive.Separator className="ui-toolbar-separator" {...props} />
	);
}
