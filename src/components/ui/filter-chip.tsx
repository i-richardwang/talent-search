import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 名单上方一条条件的药丸，样式在 filter-chip.css：32px 高、半圆两端，三级填充的底
 * 加一圈次级描边，悬停时描边加深。左边是打开这一条菜单的开关（`FilterChipTrigger`，
 * 做下拉菜单的触发器），右边是清掉这一条的关闭格（`FilterChipClear`）。
 * `dashed` 时换成虚线描边、字退到次要色，表示这一条停用了。
 *
 * 开关里的字 13px 正文色；取值用 `FilterChipValue`（中粗），跟在后面的次要说明用
 * `FilterChipNote`（12px 次要色）。末尾的下箭头 10px。
 */

export function FilterChip({
	children,
	className,
	dashed = false,
}: {
	children: ReactNode;
	className?: string;
	dashed?: boolean;
}) {
	return (
		<span
			className={cn(
				"ui-filter-chip",
				dashed && "ui-filter-chip-dashed",
				className,
			)}
		>
			{children}
		</span>
	);
}

export function FilterChipTrigger({
	className,
	...props
}: ComponentProps<"button">) {
	return (
		<button
			className={cn("ui-filter-chip-trigger", className)}
			type="button"
			{...props}
		/>
	);
}
FilterChipTrigger.displayName = "FilterChipTrigger";

export function FilterChipValue({ children }: { children: ReactNode }) {
	return <span className="ui-filter-chip-value">{children}</span>;
}

export function FilterChipNote({ children }: { children: ReactNode }) {
	return <span className="ui-filter-chip-note">{children}</span>;
}

/** 关闭格：`label` 是读屏念的那句，要说得出清掉的是哪一条。 */
export function FilterChipClear({
	label,
	onClear,
}: {
	label: string;
	onClear: () => void;
}) {
	return (
		<button
			aria-label={label}
			className="ui-filter-chip-clear"
			onClick={onClear}
			title={label}
			type="button"
		>
			<Icon icon={X} size={12} />
		</button>
	);
}
