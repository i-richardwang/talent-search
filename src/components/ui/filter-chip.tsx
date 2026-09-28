import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 一条搜索条件：左边是打开这一条菜单的开关（`FilterChipTrigger`），右边是清掉这一条的
 * 关闭格（`FilterChipClear`）。`dashed` 表示这一条停用了。
 */

export function FilterChip({
	children,
	dashed = false,
}: {
	children: ReactNode;
	dashed?: boolean;
}) {
	return (
		<span className={cn("ui-filter-chip", dashed && "ui-filter-chip-dashed")}>
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

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
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
