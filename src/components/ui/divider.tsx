import { Separator } from "@base-ui/react/separator";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/* 分隔线。横向可以带 `children`：内容居中，两侧各一段线。 */

interface DividerProps
	extends Omit<Separator.Props, "className" | "orientation"> {
	className?: string;
	orientation?: "horizontal" | "vertical";
	dashed?: boolean;
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
