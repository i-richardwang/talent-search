"use client";

import { type LucideIcon, X } from "lucide-react";
import {
	type ComponentProps,
	isValidElement,
	type MouseEvent,
	type ReactNode,
} from "react";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 标签，样式在 tag.css。不带 `color` 时是次要色的字：filled 是三级填充的底，
 * outlined 是容器底加一圈分隔线色的边，borderless 没有底也没有边，solid 同 filled。
 * 带 `color` 时字换成那种状态色，filled / outlined 的底（和 outlined 的边）是那种
 * 状态色的三级填充，borderless 只换字色，solid 用状态色铺底、字取黑白里读得清的一个。
 * `processing` 与 `info` 同色。外层用 `className` / `style`。
 *
 * `icon` 放在文字前：传图标组件按 1em 画，传元素原样放。
 * `onClick` 时整枚标签显示可点的指针。
 *
 * `closable` 时尾部有一颗关闭钮，按下只调 `onClose`，标签由调用处移除。
 * 关闭钮的 aria-label：内容是文字时是「移除 <文字>」，否则是「关闭」。
 * 一排可关闭的标签在读屏里要分得出关的是哪一个。
 */

type TagSize = "small" | "middle" | "large";
type TagVariant = "filled" | "outlined" | "borderless" | "solid";
type TagShape = "normal" | "round";
export type TagColor = "success" | "warning" | "error" | "info" | "processing";

interface TagProps extends Omit<ComponentProps<"span">, "color"> {
	closable?: boolean;
	color?: TagColor;
	icon?: LucideIcon | ReactNode;
	onClose?: (event: MouseEvent<HTMLButtonElement>) => void;
	shape?: TagShape;
	size?: TagSize;
	variant?: TagVariant;
}

const SIZE = {
	large: "ui-tag-size-large",
	middle: "ui-tag-size-middle",
	small: "ui-tag-size-small",
} as const;

const VARIANT = {
	borderless: "ui-tag-variant-borderless",
	filled: "ui-tag-variant-filled",
	outlined: "ui-tag-variant-outlined",
	solid: "ui-tag-variant-solid",
} as const;

const COLOR = {
	error: "ui-tag-color-error",
	info: "ui-tag-color-info",
	processing: "ui-tag-color-info",
	success: "ui-tag-color-success",
	warning: "ui-tag-color-warning",
} as const;

export function Tag({
	children,
	className,
	closable,
	color,
	icon,
	onClose,
	shape = "normal",
	size = "middle",
	variant = "filled",
	...props
}: TagProps) {
	return (
		<span
			className={cn(
				"ui-tag",
				SIZE[size],
				VARIANT[variant],
				shape === "round" && "ui-tag-shape-round",
				color && COLOR[color],
				props.onClick && "ui-tag-clickable",
				className,
			)}
			{...props}
		>
			{isValidElement(icon) ? icon : icon ? <Icon icon={icon} /> : null}
			{children}
			{closable && (
				<button
					aria-label={
						typeof children === "string" ? `移除 ${children}` : "关闭"
					}
					className="ui-tag-close"
					onClick={(event) => {
						event.stopPropagation();
						onClose?.(event);
					}}
					type="button"
				>
					<X size={10} />
				</button>
			)}
		</span>
	);
}
