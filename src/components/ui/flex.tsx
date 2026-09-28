import type {
	CSSProperties,
	ElementType,
	HTMLAttributes,
	ReactNode,
} from "react";
import { cn } from "#/lib/utils";

/*
 * 布局参数写成元素上的 `--ui-flex-*` 变量，flex.css 把它们落到对应的属性上。
 * 默认纵向排列；数字按像素。
 */

export interface FlexboxProps extends HTMLAttributes<HTMLElement> {
	align?: "center";
	as?: ElementType;
	children?: ReactNode;
	flex?: number | string;
	gap?: number | string;
	height?: number | string;
	horizontal?: boolean;
	justify?: "center";
	padding?: number | string;
	paddingBlock?: number | string;
	paddingInline?: number | string;
	width?: number | string;
}

const cssValue = (value: number | string) =>
	typeof value === "number" ? `${value}px` : value;

export function Flexbox({
	flex,
	gap,
	horizontal,
	align,
	justify,
	height,
	width,
	padding,
	paddingInline,
	paddingBlock,
	as: Container = "div",
	className,
	style,
	children,
	...props
}: FlexboxProps) {
	const vars: Record<string, string> = {};
	if (flex !== undefined) vars["--ui-flex"] = String(flex);
	if (horizontal) vars["--ui-flex-direction"] = "row";
	if (justify !== undefined) vars["--ui-flex-justify"] = justify;
	if (align !== undefined) vars["--ui-flex-align"] = align;
	if (width !== undefined) vars["--ui-flex-width"] = cssValue(width);
	if (height !== undefined) vars["--ui-flex-height"] = cssValue(height);
	if (padding !== undefined) vars["--ui-flex-padding"] = cssValue(padding);
	if (paddingInline !== undefined)
		vars["--ui-flex-padding-inline"] = cssValue(paddingInline);
	if (paddingBlock !== undefined)
		vars["--ui-flex-padding-block"] = cssValue(paddingBlock);
	if (gap !== undefined) vars["--ui-flex-gap"] = cssValue(gap);

	return (
		<Container
			{...props}
			className={cn("ui-flex", className)}
			style={{ ...(vars as CSSProperties), ...style }}
		>
			{children}
		</Container>
	);
}

/** 两个轴都居中的 Flexbox。 */
export function Center(props: Omit<FlexboxProps, "align" | "justify">) {
	return <Flexbox {...props} align="center" justify="center" />;
}
