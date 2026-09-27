import type { CSSProperties, HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

/*
 * 加载占位，样式在 skeleton.css，一律明暗呼吸。`Skeleton` 是一块，宽、高写在行内样式上。
 * 其余形状都由这一块拼成：
 *
 * - `Skeleton.Text`：按一档字阶排出几行，每行占住那一档的行高，块本身高是字号与行高的
 *   中间值，上下各留剩下的一半。多行时末行取 66% 宽；`width` 给数组时逐行取宽，
 *   不够长的行沿用最后一项。
 * - `Skeleton.Title`：一行，默认 60% 宽。
 * - `Skeleton.Avatar`：定宽定高不收缩的方块或圆，默认 40px。
 * - `Skeleton.Button`：高度与圆角读 Button 同档的令牌，默认 80px 宽，`block` 撑满，
 *   圆形时宽等于高。
 * - `Skeleton.Tags`：一排 Tag 大小的块，高度读 Tag 同档的令牌。
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

type SkeletonTextSize = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";

interface SkeletonTextProps {
	className?: string;
	rows?: number;
	/** 按哪一档字阶占位，默认正文 base。 */
	size?: SkeletonTextSize;
	style?: CSSProperties;
	width?: Length | Length[];
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
	style,
	width,
}: SkeletonTextProps) {
	const rowCount = Math.max(rows, 1);
	const { height, margin } = rowMetrics(size);
	const rowWidth = (index: number): Length => {
		if (Array.isArray(width)) return width[index] ?? width.at(-1) ?? "100%";
		if (width !== undefined) return width;
		return index === rowCount - 1 && rowCount > 1 ? "66%" : "100%";
	};
	return (
		<div className={cn("ui-skeleton-text", className)} style={style}>
			{Array.from({ length: rowCount }).map((_, index) => (
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

function SkeletonTitle({
	width = "60%",
	...rest
}: Omit<SkeletonTextProps, "rows" | "width"> & { width?: Length }) {
	return <SkeletonText {...rest} rows={1} width={width} />;
}

interface SkeletonAvatarProps extends Omit<SkeletonProps, "height" | "width"> {
	shape?: "circle" | "square";
	size?: Length;
}

function SkeletonAvatar({
	className,
	shape = "square",
	size = 40,
	...rest
}: SkeletonAvatarProps) {
	return (
		<SkeletonRoot
			className={cn(
				"ui-skeleton-avatar",
				shape === "circle" && "ui-skeleton-circle",
				className,
			)}
			height={size}
			width={size}
			{...rest}
		/>
	);
}

type SkeletonControlSize = "small" | "middle";

interface SkeletonButtonProps extends Omit<SkeletonProps, "height"> {
	block?: boolean;
	shape?: "default" | "circle";
	size?: SkeletonControlSize;
}

function SkeletonButton({
	block,
	className,
	shape = "default",
	size = "middle",
	width,
	...rest
}: SkeletonButtonProps) {
	const height = `var(--button-height-${size})`;
	return (
		<SkeletonRoot
			className={cn(
				"ui-skeleton-button",
				shape === "circle" && "ui-skeleton-circle",
				className,
			)}
			height={height}
			width={width ?? (block ? "100%" : shape === "circle" ? height : 80)}
			{...rest}
		/>
	);
}

interface SkeletonTagsProps {
	className?: string;
	count?: number;
	size?: SkeletonControlSize;
	style?: CSSProperties;
	width?: Length | Length[];
}

const TAG_WIDTH = { middle: 48, small: 36 } as const;

function SkeletonTags({
	className,
	count = 1,
	size = "middle",
	style,
	width,
}: SkeletonTagsProps) {
	const tagWidth = (index: number): Length => {
		if (Array.isArray(width))
			return width[index] ?? width.at(-1) ?? TAG_WIDTH[size];
		return width ?? TAG_WIDTH[size];
	};
	return (
		<div className={cn("ui-skeleton-tags", className)} style={style}>
			{Array.from({ length: Math.max(count, 1) }).map((_, index) => (
				<SkeletonRoot
					className="ui-skeleton-tag"
					height={`var(--tag-height-${size})`}
					// biome-ignore lint/suspicious/noArrayIndexKey: 块只按位置区分，没有别的身份
					key={index}
					width={tagWidth(index)}
				/>
			))}
		</div>
	);
}

export const Skeleton = Object.assign(SkeletonRoot, {
	Avatar: SkeletonAvatar,
	Button: SkeletonButton,
	Tags: SkeletonTags,
	Text: SkeletonText,
	Title: SkeletonTitle,
});
