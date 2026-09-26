"use client";

import { Field } from "@base-ui/react/field";
import { Input as BaseInput } from "@base-ui/react/input";
import { NumberField } from "@base-ui/react/number-field";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 样式在 input.css。外层样式用 `className`。不传 `variant` 时的深浅两种默认由 CSS
 * 按 `.dark` 选（`ui-input-auto`：浅色描边、深色填充），不在渲染时读主题；
 * `variant="filled"` 深浅都是填充。
 */

export type InputVariant = "filled";
export type InputSize = "small" | "middle";

const SIZE = {
	middle: "ui-input-size-middle",
	small: "ui-input-size-small",
} as const;

/** 输入框外壳的类名，AutoComplete 也用它（size 默认 middle）。 */
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

interface TextAreaProps
	extends Omit<React.ComponentProps<"textarea">, "prefix" | "style"> {
	/** 随内容长高；`minRows` 是最少几行，默认 2。 */
	autoSize?: { minRows?: number };
}

export function TextArea({
	autoSize,
	className,
	disabled,
	...props
}: TextAreaProps) {
	return (
		<div
			className={cn(
				inputVariants({}),
				"ui-input-textarea",
				autoSize && "ui-input-textarea-auto-size",
				className,
			)}
			data-disabled={disabled ? "" : undefined}
			style={{ "--textarea-min-rows": autoSize?.minRows } as CSSProperties}
		>
			<Field.Control
				className="ui-input-input"
				disabled={disabled}
				render={<textarea {...props} />}
			/>
		</div>
	);
}

interface InputNumberProps
	extends Omit<
		NumberField.Root.Props,
		"className" | "style" | "render" | "onValueChange" | "children" | "ref"
	> {
	onChange?: (value: number | null) => void;
	placeholder?: string;
}

/** 数字输入框，右端带上下步进。 */
export function InputNumber({
	onChange,
	placeholder,
	...props
}: InputNumberProps) {
	return (
		<NumberField.Root
			className={inputVariants({})}
			onValueChange={onChange}
			{...props}
		>
			<NumberField.Input
				className="ui-input-input ui-input-number-input"
				placeholder={placeholder}
			/>
			<div className="ui-input-number-controls">
				<NumberField.Increment className="ui-input-number-control">
					<Icon icon={ChevronUp} size={12} />
				</NumberField.Increment>
				<NumberField.Decrement className="ui-input-number-control">
					<Icon icon={ChevronDown} size={12} />
				</NumberField.Decrement>
			</div>
		</NumberField.Root>
	);
}
