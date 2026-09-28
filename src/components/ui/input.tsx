"use client";

import { Input as BaseInput } from "@base-ui/react/input";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 不传 `variant` 时浅色描边、深色填充，由 CSS 按 `.dark` 选，渲染时不读主题；
 * `borderless` 是嵌在别的面里的一行字。只有 AutoComplete 传 `variant`。
 */

export type InputVariant = "filled" | "borderless";
export type InputSize = "small" | "middle";

const SIZE = {
	middle: "ui-input-size-middle",
	small: "ui-input-size-small",
} as const;

/** 输入框外壳的类名，AutoComplete 也用它。 */
export function inputVariants({
	size,
	variant,
}: {
	size?: InputSize;
	variant?: InputVariant;
}) {
	return cn(
		"ui-input-root ui-input-invalid",
		SIZE[size ?? "middle"],
		variant ? `ui-input-${variant}` : "ui-input-auto",
	);
}

interface InputProps
	extends Omit<
		BaseInput.Props,
		"size" | "prefix" | "render" | "className" | "style"
	> {
	className?: string;
	prefix?: ReactNode;
	size?: InputSize;
	suffix?: ReactNode;
	variant?: InputVariant;
}

export function Input({
	className,
	disabled,
	prefix,
	size = "middle",
	suffix,
	variant,
	...props
}: InputProps) {
	return (
		<div
			className={cn(inputVariants({ size, variant }), className)}
			data-disabled={disabled ? "" : undefined}
		>
			{prefix && <span className="ui-input-slot">{prefix}</span>}
			<BaseInput className="ui-input-input" disabled={disabled} {...props} />
			{suffix && <span className="ui-input-slot">{suffix}</span>}
		</div>
	);
}
