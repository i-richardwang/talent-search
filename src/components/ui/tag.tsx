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
 * `closable` 时尾部的关闭钮只调 `onClose`，标签由调用处移除。关闭钮的名字带上标签的文字，
 * 一排可关闭的标签在读屏里才分得出关的是哪一个。
 */

interface TagProps extends ComponentProps<"span"> {
	closable?: boolean;
	icon?: LucideIcon | ReactNode;
	onClose?: (event: MouseEvent<HTMLButtonElement>) => void;
	size?: "small" | "middle";
	variant?: "filled" | "outlined";
}

export function Tag({
	children,
	className,
	closable,
	icon,
	onClose,
	size = "middle",
	variant = "filled",
	...props
}: TagProps) {
	return (
		<span
			className={cn(
				"ui-tag",
				`ui-tag-size-${size}`,
				`ui-tag-variant-${variant}`,
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
