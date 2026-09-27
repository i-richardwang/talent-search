"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import { animate, press } from "motion";
import { type ReactNode, useEffect, useRef } from "react";
import { resolveIcon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 按钮，样式在 button.css。
 * - `danger` 把这一型换成错误色：primary 是错误色铺底，default 与 dashed 是错误色
 *   的边和字，fill 是错误浅底，text 与 link 只换字色。
 * - `shape="circle"` 去掉水平内边距、圆角取一半，和只有图标的按钮一起用成圆钮；
 *   `shape="round"` 两头圆过去。
 * - 链接用 `render`（传路由的 `<Link>` 或 `<a>`），不用 `href` / `target`：
 *   站内跳转要走路由。
 * - 按下的弹簧缩放用 motion 的 `press` + `animate` 挂在元素上，
 *   `render` 换成什么元素都有同样的手感。
 */

type ButtonType = "default" | "primary" | "dashed" | "fill" | "link" | "text";
type ButtonSize = "small" | "middle" | "large";
type ButtonShape = "default" | "circle" | "round";

export interface ButtonProps
	extends Omit<useRender.ComponentProps<"button">, "type"> {
	block?: boolean;
	danger?: boolean;
	htmlType?: "button" | "submit" | "reset";
	icon?: LucideIcon | ReactNode;
	iconPosition?: "start" | "end";
	loading?: boolean;
	/** 只对 text 型：用负外边距抵掉这一档的起始内边距，让按钮和上下的字对齐。 */
	outdent?: boolean;
	shape?: ButtonShape;
	size?: ButtonSize;
	type?: ButtonType;
}

const SIZE = {
	small: "ui-button-size-small",
	middle: "ui-button-size-middle",
	large: "ui-button-size-large",
} as const;

const ICON_ONLY = {
	small: "ui-button-icon-only-small",
	middle: "ui-button-icon-only-middle",
	large: "ui-button-icon-only-large",
} as const;

const VARIANT = {
	dashed: "ui-button-variant-dashed",
	default: "ui-button-variant-default",
	fill: "ui-button-variant-fill",
	link: "ui-button-variant-link",
	primary: "ui-button-variant-primary",
	text: "ui-button-variant-text",
} as const;

/** 危险色叠在这一型的外观块之后；primary 与 fill 整块换掉。 */
const DANGER = {
	dashed: "ui-button-variant-dashed ui-button-danger-outlined",
	default: "ui-button-variant-default ui-button-danger-outlined",
	fill: "ui-button-danger-fill",
	link: "ui-button-variant-link ui-button-danger-inline",
	primary: "ui-button-danger-solid",
	text: "ui-button-variant-text ui-button-danger-inline",
} as const;

const SHAPE = {
	circle: "ui-button-shape-circle",
	default: undefined,
	round: "ui-button-shape-round",
} as const;

const TAP = { scale: 0.98 };
const TAP_TRANSITION = {
	damping: 26,
	mass: 0.6,
	stiffness: 600,
	type: "spring",
} as const;

/** 按下时缩到 0.98、松开弹回；不可交互时不挂。 */
function usePressScale(enabled: boolean) {
	const ref = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		const element = ref.current;
		if (!element || !enabled) return;
		return press(element, (target) => {
			animate(target, TAP, TAP_TRANSITION);
			return () => animate(target, { scale: 1 }, TAP_TRANSITION);
		});
	}, [enabled]);
	return ref;
}

export function Button({
	block,
	children,
	className,
	danger,
	disabled,
	htmlType = "button",
	icon,
	iconPosition = "start",
	loading,
	onClick,
	outdent,
	ref,
	render,
	shape = "default",
	size = "middle",
	type = "default",
	...props
}: ButtonProps) {
	const interactionDisabled = Boolean(disabled || loading);
	const pressRef = usePressScale(!interactionDisabled);

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
			danger ? DANGER[type] : VARIANT[type],
			SHAPE[shape],
			block && "ui-button-block",
			iconPosition === "end" && "ui-button-icon-end",
			iconOnly && ICON_ONLY[size],
			type === "text" && outdent && "ui-button-outdent",
			className,
		),
		children: (
			<>
				<span
					aria-hidden={!loading}
					className={cn(
						"ui-button-icon-box ui-button-spinner-slot",
						loading && "ui-button-spinner-slot-show",
						iconPosition === "end" && "ui-button-spinner-slot-end",
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
		ref: ref ? [pressRef, ref] : pressRef,
		render,
	});
}

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
Button.displayName = "Button";
