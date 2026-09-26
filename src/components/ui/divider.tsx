import { Separator } from "@base-ui/react/separator";
import { cn } from "#/lib/utils";

/*
 * 分隔线，样式在 divider.css。行为用 Base UI 的 Separator，根上带 `role="separator"`、
 * `aria-orientation` 与 `data-orientation`。只有 `orientation` 一个参数，不带文字；
 * 横向上下外边距 16px，竖向左右外边距 8px。
 */

interface DividerProps
	extends Omit<Separator.Props, "className" | "orientation"> {
	className?: string;
	orientation?: "horizontal" | "vertical";
}

export function Divider({
	className,
	orientation = "horizontal",
	...props
}: DividerProps) {
	return (
		<Separator
			className={cn("ui-divider", `ui-divider-${orientation}`, className)}
			orientation={orientation}
			{...props}
		/>
	);
}
