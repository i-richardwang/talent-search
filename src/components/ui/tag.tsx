"use client";

import { X } from "lucide-react";
import type { ComponentProps, MouseEvent } from "react";
import { cn } from "#/lib/utils";

/*
 * 标签，样式在 tag.css：次要色的字，filled 是三级填充的底，outlined 是容器底加一圈
 * 分隔线色的边。外层用 `className` / `style`。
 *
 * `closable` 时尾部有一颗关闭钮，按下只调 `onClose`，标签由调用处移除。
 * 关闭钮的 aria-label：内容是文字时是「移除 <文字>」，否则是「关闭」。
 * 一排可关闭的标签在读屏里要分得出关的是哪一个。
 */

type TagSize = "small" | "middle";
type TagVariant = "filled" | "outlined";

interface TagProps extends Omit<ComponentProps<"span">, "color"> {
	closable?: boolean;
	onClose?: (event: MouseEvent<HTMLButtonElement>) => void;
	size?: TagSize;
	variant?: TagVariant;
}

const SIZE = {
	middle: "ui-tag-size-middle",
	small: "ui-tag-size-small",
} as const;

const VARIANT = {
	filled: "ui-tag-variant-filled",
	outlined: "ui-tag-variant-outlined",
} as const;

export function Tag({
	children,
	className,
	closable,
	onClose,
	size = "middle",
	variant = "filled",
	...props
}: TagProps) {
	return (
		<span
			className={cn("ui-tag", SIZE[size], VARIANT[variant], className)}
			{...props}
		>
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
