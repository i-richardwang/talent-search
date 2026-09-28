"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { resolveIcon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 按钮。链接用 `render`（传路由的 `<Link>` 或 `<a>`），不用 `href` / `target`：站内跳转要
 * 走路由。
 */

type ButtonType = "default" | "primary" | "fill" | "text";
type ButtonSize = "small" | "middle";

export interface ButtonProps
	extends Omit<useRender.ComponentProps<"button">, "type"> {
	block?: boolean;
	/** 只对 primary：换成危险色。 */
	danger?: boolean;
	htmlType?: "button" | "submit" | "reset";
	icon?: LucideIcon | ReactNode;
	loading?: boolean;
	size?: ButtonSize;
	type?: ButtonType;
}

const SIZE = {
	small: "ui-button-size-small",
	middle: "ui-button-size-middle",
} as const;

const ICON_ONLY = {
	small: "ui-button-icon-only-small",
	middle: "ui-button-icon-only-middle",
} as const;

const VARIANT = {
	default: "ui-button-variant-default",
	fill: "ui-button-variant-fill",
	primary: "ui-button-variant-primary",
	text: "ui-button-variant-text",
} as const;

export function Button({
	block,
	children,
	className,
	danger,
	disabled,
	htmlType = "button",
	icon,
	loading,
	onClick,
	ref,
	render,
	size = "middle",
	type = "default",
	...props
}: ButtonProps) {
	const interactionDisabled = Boolean(disabled || loading);

	const hasChildren =
		children !== undefined &&
		children !== null &&
		children !== false &&
		children !== "";
	const iconOnly = !hasChildren && Boolean(loading || icon);

	const defaultProps = {
		className: cn(
			"ui-button",
			SIZE[size],
			danger && type === "primary" ? "ui-button-danger" : VARIANT[type],
			block && "ui-button-block",
			iconOnly && ICON_ONLY[size],
			className,
		),
		children: (
			<>
				<span
					aria-hidden={!loading}
					className={cn(
						"ui-button-icon-box ui-button-spinner-slot",
						loading && "ui-button-spinner-slot-show",
					)}
				>
					<span className="ui-spinner" />
				</span>
				{icon && !loading ? (
					<span className="ui-button-icon-box">{resolveIcon(icon)}</span>
				) : null}
				{children}
			</>
		),
		disabled: render ? undefined : disabled,
		onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
			if (interactionDisabled) {
				event.preventDefault();
				return;
			}
			onClick?.(event);
		},
		type: render ? undefined : htmlType,
	};

	return useRender({
		defaultTagName: "button",
		// 忙与禁用的状态由组件说了算，放在调用处的属性之后。
		props: mergeProps<"button">(defaultProps, props, {
			"aria-busy": loading || undefined,
			"aria-disabled": interactionDisabled || undefined,
		}),
		ref,
		render,
	});
}

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
Button.displayName = "Button";
