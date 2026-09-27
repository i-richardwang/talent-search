"use client";

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 受控的展开与收起，样式在 collapsible.css。`Collapsible` 是面板：`open` 决定它在不在，
 * 高度过渡，内容淡入并位移；收起时内容卸载。`id` 写在面板上。
 *
 * `CollapsibleTrigger` 是它的开关：一行内容后面紧跟一枚实心三角（收起朝右、展开朝下），
 * 按下调 `onOpenChange`，`aria-expanded` 与指向面板的 `aria-controls` 由它写。
 * 开关与面板不必相邻，靠同一个 `panelId` 配对。
 */

interface CollapsibleProps {
	children?: ReactNode;
	id: string;
	open: boolean;
}

export function Collapsible({ open, children, id }: CollapsibleProps) {
	return (
		<BaseCollapsible.Root open={open}>
			<BaseCollapsible.Panel className="ui-collapsible-panel" id={id}>
				<div className="ui-collapsible-content">{children}</div>
			</BaseCollapsible.Panel>
		</BaseCollapsible.Root>
	);
}

interface CollapsibleTriggerProps
	extends Omit<
		ComponentProps<"button">,
		"aria-controls" | "aria-expanded" | "onClick" | "type"
	> {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	/** 它开合的那个 `Collapsible` 的 `id`。 */
	panelId: string;
}

export function CollapsibleTrigger({
	children,
	className,
	onOpenChange,
	open,
	panelId,
	...rest
}: CollapsibleTriggerProps) {
	return (
		<button
			{...rest}
			aria-controls={open ? panelId : undefined}
			aria-expanded={open}
			className={cn("ui-collapsible-trigger", className)}
			onClick={() => onOpenChange(!open)}
			type="button"
		>
			{children}
			<svg
				aria-hidden="true"
				className="ui-collapsible-arrow"
				fill="currentColor"
				viewBox="0 0 16 16"
			>
				<path d="M7.002 10.624a.5.5 0 01-.752-.432V5.808a.5.5 0 01.752-.432l3.758 2.192a.5.5 0 010 .864l-3.758 2.192z" />
			</svg>
		</button>
	);
}
