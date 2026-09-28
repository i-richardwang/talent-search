"use client";

import { Radio as BaseRadio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import type { ComponentProps, ReactNode } from "react";

/* `Radio` 只能放在 `RadioGroup` 里；组只持有取值，不带布局，选项由调用处自己排。 */

type BaseRadioProps = Omit<
	ComponentProps<typeof BaseRadio.Root>,
	"className" | "style" | "render" | "children" | "disabled"
>;

interface RadioProps extends BaseRadioProps {
	children: ReactNode;
}

export function Radio({ children, ...rest }: RadioProps) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: 圆点就是这层标签里的控件
		<label className="ui-radio-label">
			<BaseRadio.Root className="ui-radio" {...rest}>
				<BaseRadio.Indicator className="ui-radio-indicator" />
			</BaseRadio.Root>
			<span className="ui-radio-text">{children}</span>
		</label>
	);
}

type BaseRadioGroupProps = Omit<
	BaseRadioGroup.Props<string>,
	| "className"
	| "style"
	| "render"
	| "children"
	| "onValueChange"
	| "onChange"
	| "disabled"
>;

interface RadioGroupProps extends BaseRadioGroupProps {
	children?: ReactNode;
	className?: string;
	onChange?: (value: string) => void;
}

export function RadioGroup({ onChange, ...rest }: RadioGroupProps) {
	return <BaseRadioGroup<string> onValueChange={onChange} {...rest} />;
}
