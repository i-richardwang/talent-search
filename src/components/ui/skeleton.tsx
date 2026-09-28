import type { HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

/*
 * 加载占位。`Skeleton` 是一块，其余形状都由这一块拼成；`Skeleton.Text` 每行占住一档字阶的
 * 行高，和真字换上来时不晃。
 */

type Length = number | string;

interface SkeletonProps
	extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
	height?: Length;
	width?: Length;
}

function SkeletonRoot({
	width = "100%",
	height = "1em",
	className,
	style,
	...rest
}: SkeletonProps) {
	return (
		<div
			className={cn("ui-skeleton", className)}
			style={{ height, width, ...style }}
			{...rest}
		/>
	);
}

type SkeletonTextSize = "xs" | "sm" | "base";

interface SkeletonTextProps {
	className?: string;
	rows?: number;
	size?: SkeletonTextSize;
	width?: Length;
}

/** 一行块高是字号与行高的中间值，上下各留行高减字号的四分之一，三者合起来正好一行。 */
function rowMetrics(size: SkeletonTextSize) {
	const font = `var(--text-${size})`;
	const line = `var(--text-${size}--line-height)`;
	return {
		height: `round(calc((${font} + ${line}) / 2), 1px)`,
		margin: `round(calc((${line} - ${font}) / 4), 1px)`,
	};
}

function SkeletonText({
	className,
	rows = 1,
	size = "base",
	width,
}: SkeletonTextProps) {
	const { height, margin } = rowMetrics(size);
	const rowWidth = (index: number): Length =>
		width ?? (index === rows - 1 && rows > 1 ? "66%" : "100%");
	return (
		<div className={cn("ui-skeleton-text", className)}>
			{Array.from({ length: rows }).map((_, index) => (
				<SkeletonRoot
					height={height}
					// biome-ignore lint/suspicious/noArrayIndexKey: 行只按位置区分，没有别的身份
					key={index}
					style={{ marginBlock: margin }}
					width={rowWidth(index)}
				/>
			))}
		</div>
	);
}

interface SkeletonAvatarProps extends Omit<SkeletonProps, "height" | "width"> {
	size?: Length;
}

/** 圆形的一块。 */
function SkeletonAvatar({
	className,
	size = 40,
	...rest
}: SkeletonAvatarProps) {
	return (
		<SkeletonRoot
			className={cn("ui-skeleton-avatar", className)}
			height={size}
			width={size}
			{...rest}
		/>
	);
}

export const Skeleton = Object.assign(SkeletonRoot, {
	Avatar: SkeletonAvatar,
	Text: SkeletonText,
});
