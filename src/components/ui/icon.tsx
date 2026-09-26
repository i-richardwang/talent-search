import type { LucideIcon } from "lucide-react";
import { type FC, isValidElement, type ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 样式在 icon.css。`size` 给档名取预设边长，给数字是像素，给 `{ size }` 原样用
 * （如 `"0.95em"`），不给是 1em、跟着所在的字号。
 */

type IconSize = "small" | "middle" | number | { size: string };

export interface IconProps
	extends Omit<React.ComponentProps<"span">, "children" | "ref"> {
	// biome-ignore lint/suspicious/noExplicitAny: 收任何照 lucide 写法接参数的图标组件
	icon: LucideIcon | FC<any> | ReactNode;
	size?: IconSize;
	spin?: boolean;
}

/** 两档预设的图标边长，px。 */
export const ICON_PRESET = { middle: 20, small: 14 } as const;

function calcSize(size: IconSize | undefined): number | string {
	if (size === undefined) return "1em";
	if (typeof size === "number") return size;
	if (typeof size === "string") return ICON_PRESET[size];
	return size.size;
}

export function Icon({
	icon,
	size: iconSize,
	className,
	spin,
	...props
}: IconProps) {
	const size = calcSize(iconSize);
	const Svg = icon as LucideIcon;
	return (
		<span
			className={cn("ui-icon", spin && "ui-icon-spin", className)}
			role="img"
			{...props}
		>
			{icon &&
				(isValidElement(icon) ? (
					icon
				) : (
					<Svg height={size} size={size} width={size} />
				))}
		</span>
	);
}

/** 按钮一类的 `icon` 属性：传元素原样放，传图标组件按 small 画。 */
export function resolveIcon(icon: LucideIcon | ReactNode): ReactNode {
	if (icon === undefined || icon === null) return null;
	if (
		isValidElement(icon) ||
		typeof icon === "string" ||
		typeof icon === "number"
	) {
		return icon;
	}
	return <Icon icon={icon} size="small" />;
}
