"use client";

import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 原生滚动的容器配一根自绘的纵向滚动条，样式在 scroll-area.css。滚动条平时透明，
 * 指针在滚动区上或正在滚时出现，3px 细条，指针移到条上长到 6px。`scrollFade` 用
 * 遮罩淡出上下还能滚的那一端（各 40px）。
 *
 * 视口的键盘焦点环画在内侧（`outline-offset: -2px`）：环是元素自己的 outline，
 * 而滚动视口总是铺满一块有边界、常常 `overflow: hidden` 的面，画在外侧就被裁掉。
 */

interface ScrollAreaProps {
	children?: ReactNode;
	className?: string;
	/**
	 * 把 Base UI 给内容节点的 `min-width: fit-content` 改成 0。内容里有断不开的宽元素
	 * （如 `<pre>`）时，不这样它的固有宽度会一路撑宽外层，把滚动区挤出父元素。
	 */
	disableContentFit?: boolean;
	/** 在视口上下还能滚的一端用渐变遮罩淡出内容。 */
	scrollFade?: boolean;
	viewportProps?: Pick<
		ComponentProps<typeof BaseScrollArea.Viewport>,
		"className" | "ref"
	>;
}

export function ScrollArea({
	children,
	className,
	disableContentFit = false,
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
					style={disableContentFit ? { minWidth: 0 } : undefined}
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
