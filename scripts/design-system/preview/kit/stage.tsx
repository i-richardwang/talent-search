import type { ReactNode } from "react";
import { Block } from "#/components/ui/block";
import { cn } from "#/lib/utils";

/*
 * 分节里放组件的几块：展示台与两列的示例格。
 */

/**
 * 展示台：一块描边的面，里面的东西居中排开。给了 `footer` 就在底下接一条读数，
 * 两块是同一个对象，读数条和台面连在一起。
 */
export function Stage({
	children,
	className,
	footer,
}: {
	children: ReactNode;
	className?: string;
	footer?: ReactNode;
}) {
	return (
		<Block className="overflow-hidden" gap={0} variant="outlined">
			<div
				className={cn(
					"flex min-h-48 flex-col items-center justify-center gap-6 overflow-x-auto p-7",
					className,
				)}
			>
				{children}
			</div>
			{footer && (
				<div className="flex flex-wrap justify-center gap-5 border-border-secondary border-t px-3.5 py-2.5 text-fg-tertiary text-xs tabular-nums">
					{footer}
				</div>
			)}
		</Block>
	);
}

/** 一格示例：标题、一句说明，下面是组件。两列排开的使用场景用它。 */
export function Example({
	children,
	description,
	title,
}: {
	children: ReactNode;
	description?: string;
	title: string;
}) {
	return (
		<Block className="min-w-0" gap={0} padding={20} variant="outlined">
			<h3 className="font-medium text-sm">{title}</h3>
			{description && (
				<p className="mt-2 text-fg-secondary text-xs leading-5">
					{description}
				</p>
			)}
			<div className="mt-6 flex flex-wrap items-center gap-3 overflow-x-auto">
				{children}
			</div>
		</Block>
	);
}

/** 两列的示例网格。 */
export function ExampleGrid({ children }: { children: ReactNode }) {
	return (
		<div className="grid grid-cols-2 gap-3.5 max-md:grid-cols-1">
			{children}
		</div>
	);
}
