"use client";

import type { CSSProperties } from "react";
import { Button, type ButtonProps } from "#/components/ui/button";
import { ICON_PRESET, Icon, type IconProps } from "#/components/ui/icon";
import { Tooltip, type TooltipProps } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/*
 * 一个正方形的 Button，字色是三级灰
 * （平时 tertiary、悬停 secondary、按下 fg），样式在 action-icon.css。
 * 三种面：borderless 没有底，filled 是浅灰底，outlined 是容器底加一圈描边；`glass` 把底换成
 * 半透明的浮层色并糊掉底下的内容，用在压在内容上的按钮。
 * 尺寸三档：small（24px，图标 14）放在行里，middle（36px，图标 20）单独摆着，两档的
 * 方块边长是 action-icon.css 的组件令牌；header（28px，图标 16）放在栏顶的页头上，
 * 边长是页头的布局令牌 `--nav-header-action-size`。三档之外可以直接给
 * `{ blockSize, borderRadius, size }`（像素）：方块边长、圆角、图标边长，按钮本身取 middle 一档。
 * 给了 `title` 或 `tooltipProps.hotkey` 就套一层提示，`tooltipProps` 转给它
 * （方位、快捷键）；提示本身不接指针。
 * 传进来的 `tabIndex` 优先，没传时禁用取 -1、否则 0：放在 Toolbar 里时
 * 漫游焦点靠 Toolbar 写的 `tabIndex`。
 */

type ActionIconSize =
	| "small"
	| "header"
	| "middle"
	| { blockSize: number; borderRadius: number; size: number };

export interface ActionIconProps
	extends Omit<
		ButtonProps,
		| "block"
		| "children"
		| "htmlType"
		| "icon"
		| "iconPosition"
		| "outdent"
		| "size"
		| "title"
		| "type"
	> {
	active?: boolean;
	/** 压在内容上时：半透明的浮层底，底下的内容糊掉。 */
	glass?: boolean;
	icon?: IconProps["icon"];
	/** 只对 borderless：用负外边距抵掉方块比图标多出来的那半圈，让图标和行尾的字对齐。 */
	outdent?: "end";
	size?: ActionIconSize;
	title?: TooltipProps["title"];
	tooltipProps?: Omit<TooltipProps, "children" | "title">;
	variant?: "borderless" | "filled" | "outlined";
}

/** 三档预设。圆角用全局的圆角档。 */
const PRESET = {
	header: {
		blockSize: "var(--nav-header-action-size)",
		borderRadius: "var(--radius-sm)",
		button: "small",
		icon: 16,
	},
	middle: {
		blockSize: "var(--action-icon-size-middle)",
		borderRadius: "var(--radius-sm)",
		button: "middle",
		icon: ICON_PRESET.middle,
	},
	small: {
		blockSize: "var(--action-icon-size-small)",
		borderRadius: "var(--radius-xs)",
		button: "small",
		icon: ICON_PRESET.small,
	},
} as const;

/** 方块边长、圆角，以及 outdent 要抵掉的那半圈（方块减图标的一半）。 */
function measure(size: ActionIconSize) {
	const preset =
		typeof size === "string"
			? PRESET[size]
			: {
					blockSize: `${size.blockSize}px`,
					borderRadius: `${size.borderRadius}px`,
					button: "middle" as const,
					icon: size.size,
				};
	return {
		...preset,
		outdent: `calc((${preset.blockSize} - ${preset.icon}px) / 2)`,
	};
}

const BUTTON_TYPE = {
	borderless: "text",
	filled: "fill",
	outlined: "default",
} as const;

export function ActionIcon({
	active,
	className,
	disabled,
	glass,
	icon,
	outdent,
	size = "middle",
	style,
	title,
	tooltipProps,
	variant = "borderless",
	...props
}: ActionIconProps) {
	const {
		blockSize,
		borderRadius,
		button: buttonSize,
		icon: iconSize,
		outdent: inset,
	} = measure(size);
	// 提示不给触发器起名字：没给 aria-label 时拿字符串的 title 当按钮的名字。
	const ariaLabel =
		props["aria-label"] ?? (typeof title === "string" ? title : undefined);
	const outdentMargin: CSSProperties | undefined =
		variant === "borderless" && outdent === "end"
			? { marginInlineEnd: `calc(-1 * ${inset})` }
			: undefined;
	const button = (
		<Button
			{...props}
			aria-label={ariaLabel}
			className={cn(
				"ui-action-icon",
				active && "ui-action-icon-active",
				glass && "ui-action-icon-glass",
				className,
			)}
			disabled={disabled}
			htmlType="button"
			icon={
				icon ? (
					<Icon icon={icon} size={iconSize} style={{ pointerEvents: "none" }} />
				) : undefined
			}
			size={buttonSize}
			style={{
				...outdentMargin,
				borderRadius,
				height: blockSize,
				width: blockSize,
				...style,
			}}
			tabIndex={props.tabIndex ?? (disabled ? -1 : 0)}
			type={BUTTON_TYPE[variant]}
		/>
	);
	if (!title && !tooltipProps?.hotkey) return button;
	return (
		<Tooltip
			title={title}
			{...tooltipProps}
			className={cn("pointer-events-none", tooltipProps?.className)}
		>
			{button}
		</Tooltip>
	);
}

/** 浮层触发器按它认出这是原生 `<button>`（见 `native-button.ts`）。 */
ActionIcon.displayName = "ActionIcon";
