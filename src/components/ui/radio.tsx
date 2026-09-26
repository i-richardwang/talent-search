"use client";

import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 样式在 radio.css。`Radio` 只能放在 `RadioGroup` 里，选中哪一项由组持有。圆点直径 16px。
 * 没有 children 时只渲染圆点；有 children 时外面包一层 `<label>`。
 * 标签文字是一个 `<span>`，常态与禁用两种颜色写在 radio.css。
 *
 * `RadioGroup` 只持有取值，不带布局：选项由调用处自己排（一行里还有计数、折起的选项）。
 */

type BaseRadioProps = Omit<
	ComponentProps<typeof BaseRadio.Root>,
	"className" | "style" | "render" | "children"
>;

interface RadioProps extends BaseRadioProps {
	children?: ReactNode;
}

export function Radio({ children, disabled, ...rest }: RadioProps) {
	const dot = (
		<BaseRadio.Root className="ui-radio" disabled={disabled} {...rest}>
			<BaseRadio.Indicator className="ui-radio-indicator" />
		</BaseRadio.Root>
	);

	if (!children) return dot;

	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: 圆点就是这层标签里的控件
		<label className="ui-radio-label">
			{dot}
			<span
				className={cn("ui-radio-text", disabled && "ui-radio-text-secondary")}
			>
				{children}
			</span>
		</label>
	);
}

type BaseRadioGroupProps = Omit<
	BaseRadioGroup.Props<string>,
	"className" | "style" | "render" | "children" | "onValueChange" | "onChange"
>;

interface RadioGroupProps extends BaseRadioGroupProps {
	children?: ReactNode;
	className?: string;
	onChange?: (value: string) => void;
}

export function RadioGroup({ onChange, ...rest }: RadioGroupProps) {
	return <BaseRadioGroup<string> onValueChange={onChange} {...rest} />;
}
