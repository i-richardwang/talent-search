"use client";

import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 原生滚动的容器配一根自绘的纵向滚动条，平时透明，指针在滚动区上或正在滚时出现。
 * 内容节点的 `min-width` 设成 0，不用 Base UI 给的 `fit-content`：内容里有断不开的宽元素
 * （如 `<pre>`）时，它的固有宽度会一路撑宽外层，把滚动区挤出父元素。
 */

interface ScrollAreaProps {
	children?: ReactNode;
	className?: string;
	/** 在视口上下还能滚的一端用渐变遮罩淡出内容。 */
	scrollFade?: boolean;
	/**
	 * 加在内容节点上。内容要至少占满视口高（`min-h-full`），好把一部分推到底或上下居中时，
	 * 写在这一层上：视口的高是定的，内容节点的百分比高按它算。
	 */
	contentClassName?: string;
	viewportProps?: Pick<
		ComponentProps<typeof BaseScrollArea.Viewport>,
		"className" | "ref"
	>;
}

export function ScrollArea({
	children,
	className,
	contentClassName,
	scrollFade = false,
	viewportProps,
}: ScrollAreaProps) {
	return (
		<BaseScrollArea.Root className={cn("ui-scroll-area", className)}>
			<BaseScrollArea.Viewport
				{...viewportProps}
				className={cn(
					"ui-scroll-area-viewport",
					scrollFade && "ui-scroll-area-viewport-fade",
					viewportProps?.className,
				)}
			>
				<BaseScrollArea.Content
					className={contentClassName}
					style={{ minWidth: 0 }}
				>
					{children}
				</BaseScrollArea.Content>
			</BaseScrollArea.Viewport>
			<BaseScrollArea.Scrollbar className="ui-scroll-area-scrollbar">
				<BaseScrollArea.Thumb className="ui-scroll-area-thumb" />
			</BaseScrollArea.Scrollbar>
		</BaseScrollArea.Root>
	);
}
