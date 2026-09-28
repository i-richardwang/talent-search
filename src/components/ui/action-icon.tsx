"use client";

import { Button, type ButtonProps } from "#/components/ui/button";
import { ICON_PRESET, Icon, type IconProps } from "#/components/ui/icon";
import { Tooltip, type TooltipProps } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/*
 * 只有图标的正方形按钮。给了 `title` 或 `tooltipProps.hotkey` 就套一层提示。
 * 传进来的 `tabIndex` 优先：放在 Toolbar 里时漫游焦点靠 Toolbar 写的 `tabIndex`。
 */

type ActionIconSize = "small" | "header" | "middle" | "floating";

export interface ActionIconProps
	extends Omit<
		ButtonProps,
		| "block"
		| "children"
		| "danger"
		| "htmlType"
		| "icon"
		| "loading"
		| "size"
		| "title"
		| "type"
	> {
	active?: boolean;
	/** 压在内容上的按钮用。 */
	glass?: boolean;
	icon?: IconProps["icon"];
	size?: ActionIconSize;
	title?: TooltipProps["title"];
	tooltipProps?: Omit<TooltipProps, "children" | "title">;
	variant?: "borderless" | "outlined";
}

/** `floating` 是浮在滚动内容上的圆钮。 */
const PRESET = {
	floating: {
		blockSize: "var(--action-icon-size-middle)",
		borderRadius: "50%",
		button: "middle",
		icon: 18,
	},
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

const BUTTON_TYPE = {
	borderless: "text",
	outlined: "default",
} as const;

export function ActionIcon({
	active,
	className,
	disabled,
	glass,
	icon,
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
	} = PRESET[size];
	// 提示不给触发器起名字：没给 aria-label 时拿字符串的 title 当按钮的名字。
	const ariaLabel =
		props["aria-label"] ?? (typeof title === "string" ? title : undefined);
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
