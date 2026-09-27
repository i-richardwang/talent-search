"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { CheckIcon, MinusIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 复选框与复选框组，样式在 checkbox.css。方框边长 `size`（默认 16px），圆角取边长的四分之一、
 * 至少 4px，勾与横线是边长的四分之三；标签文字与方框相隔边长的一半。点击面四周各多 6px。没有 children 时只渲染方框，
 * `className` 落在方框上；有 children 时外面包一层 `<label>`，`className` 落在这层上。
 * 标签文字是一个 `<span>`，平时与禁用的两种颜色写在 checkbox.css。
 * `CheckboxGroup` 只持有取值，不带布局：选项由调用处自己排（一行里还有计数、
 * 折起的选项、全选框）。
 */

type BaseCheckboxProps = Omit<
	ComponentProps<typeof BaseCheckbox.Root>,
	"className" | "style" | "render" | "children" | "onCheckedChange"
>;

interface CheckboxProps extends BaseCheckboxProps {
	children?: ReactNode;
	className?: string;
	onChange?: (checked: boolean) => void;
	/** 方框边长，px。 */
	size?: number;
}

export function Checkbox({
	children,
	className,
	onChange,
	disabled,
	size = 16,
	...rest
}: CheckboxProps) {
	const mark = { size, strokeWidth: 3, style: { transform: "scale(0.75)" } };
	const box = (
		<BaseCheckbox.Root
			className={cn("ui-checkbox", !children && className)}
			disabled={disabled}
			onCheckedChange={onChange}
			style={{
				borderRadius: `max(4px, ${Math.round(size / 4)}px)`,
				height: size,
				width: size,
			}}
			{...rest}
		>
			{/* 半选按 Base UI 的状态画：全选框（`parent`）的半选由复选框组算出。 */}
			<BaseCheckbox.Indicator
				className="ui-checkbox-indicator"
				render={(props, state) => (
					<span {...props}>
						{state.indeterminate ? (
							<MinusIcon {...mark} />
						) : (
							<CheckIcon {...mark} />
						)}
					</span>
				)}
			/>
		</BaseCheckbox.Root>
	);

	if (!children) return box;

	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: 方框就是这层标签里的控件
		<label
			className={cn("ui-checkbox-label", className)}
			style={{ gap: Math.floor(size / 2) }}
		>
			{box}
			<span
				className={cn(
					"ui-checkbox-text",
					disabled && "ui-checkbox-text-secondary",
				)}
			>
				{children}
			</span>
		</label>
	);
}

type BaseCheckboxGroupProps = Omit<
	ComponentProps<typeof BaseCheckboxGroup>,
	"className" | "style" | "render" | "children" | "onValueChange" | "onChange"
>;

interface CheckboxGroupProps extends BaseCheckboxGroupProps {
	children?: ReactNode;
	className?: string;
	onChange?: (value: string[]) => void;
}

export function CheckboxGroup({ onChange, ...rest }: CheckboxGroupProps) {
	return <BaseCheckboxGroup onValueChange={onChange} {...rest} />;
}
