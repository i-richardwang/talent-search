import { cn } from "#/lib/utils";

/*
 * 外壳和预览页都画的两个小记号：颜色的色块，改过的项旁边的圆点。
 */

/** 一格色块，底下垫棋盘格，半透明的颜色看得出来。 */
export function Swatch({
	className,
	color,
}: {
	className?: string;
	color: string;
}) {
	return (
		<span
			className={cn(
				"inline-block size-5 shrink-0 rounded-xs border border-border-secondary",
				className,
			)}
			style={{
				background: `linear-gradient(${color}, ${color}), repeating-conic-gradient(var(--color-fill-secondary) 0 25%, transparent 0 50%) 0 0 / 8px 8px`,
			}}
		/>
	);
}

/** 改过的项名字旁边的一个小圆点。 */
export function ModifiedMark() {
	return (
		<span
			aria-label="已修改"
			className="inline-block size-1.5 shrink-0 rounded-full bg-info"
			role="img"
			title="已修改"
		/>
	);
}
