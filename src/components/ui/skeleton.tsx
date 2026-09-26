import type { HTMLAttributes } from "react";
import { cn } from "#/lib/utils";

/*
 * 加载占位，样式在 skeleton.css，一律明暗呼吸。`Skeleton` 是一块，宽、高写在行内样式上；
 * `Skeleton.Text` 按正文字号与 1.6 的行高排出几行，占住真实文字会占的盒子，
 * 多行时末行取 66% 宽。
 */

interface SkeletonProps
	extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
	height?: number | string;
	width?: number | string;
}

interface SkeletonTextProps {
	rows?: number;
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

/* 行高 1.6：每行块高是字号的 1.3 倍，上下各留 0.15 倍，合起来是一行的高度。 */
const ROW_HEIGHT = "round(calc(var(--text-base) * 1.3), 1px)";
const HALF_LEADING = "round(calc(var(--text-base) * 0.15), 1px)";

function SkeletonText({ rows = 1 }: SkeletonTextProps) {
	const rowCount = Math.max(rows, 1);
	return (
		<div className="ui-skeleton-text">
			{Array.from({ length: rowCount }).map((_, index) => (
				<SkeletonRoot
					height={ROW_HEIGHT}
					// biome-ignore lint/suspicious/noArrayIndexKey: 行只按位置区分，没有别的身份
					key={index}
					style={{ marginBlock: HALF_LEADING }}
					width={index === rowCount - 1 && rowCount > 1 ? "66%" : "100%"}
				/>
			))}
		</div>
	);
}

export const Skeleton = Object.assign(SkeletonRoot, { Text: SkeletonText });
