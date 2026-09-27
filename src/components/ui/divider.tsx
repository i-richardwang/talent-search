import { Separator } from "@base-ui/react/separator";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 分隔线，样式在 divider.css。行为用 Base UI 的 Separator，根上带 `role="separator"`、
 * `aria-orientation` 与 `data-orientation`。横向上下外边距 16px，竖向左右外边距 8px。
 * 横向可以带 `children`：内容居中，两侧各一段线，内容左右各留 1em；这时根不是分隔符，
 * 内容照常读出。`dashed` 把线画成虚线，带内容时两侧两段都是虚线。
 */

interface DividerProps
	extends Omit<Separator.Props, "className" | "orientation"> {
	className?: string;
	orientation?: "horizontal" | "vertical";
	/** 虚线。 */
	dashed?: boolean;
	/** 横向线中间的内容。 */
	children?: ReactNode;
}

export function Divider({
	children,
	className,
	dashed = false,
	orientation = "horizontal",
	...props
}: DividerProps) {
	// 分隔符角色的子节点对读屏是装饰，带内容时根是普通的 div，两侧的线才是装饰
	if (orientation === "horizontal" && children != null)
		return (
			<div
				className={cn(
					"ui-divider ui-divider-horizontal ui-divider-with-text",
					dashed && "ui-divider-dashed",
					className,
				)}
			>
				<span className="ui-divider-text">{children}</span>
			</div>
		);
	return (
		<Separator
			className={cn(
				"ui-divider",
				`ui-divider-${orientation}`,
				dashed && "ui-divider-dashed",
				className,
			)}
			orientation={orientation}
			{...props}
		/>
	);
}
