"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { type ReactNode, useState } from "react";
import { cn } from "#/lib/utils";

/*
 * 标签页，样式在 tabs.css。行为用 Base UI 的 Tabs：方向键在标签之间移动，
 * 选中的那一个垫一块指示块，换标签时在 240ms 里滑过去。
 *
 * - 按 `items` 画出整组；某一项带 `children` 时才渲染面板。
 * - 没给 `activeKey` 时，选中第一个不禁用的项。
 * - 两种变体：`rounded` 在底色上垫一块浮起的块，`point` 在选中项下方画一个主色圆点。
 * - 指示块在服务端渲染时就按选中项定位，首帧不从原点滑过来。
 */

type TabsVariant = "rounded" | "point";
type TabsSize = "small" | "middle";

interface TabsItem {
	children?: ReactNode;
	disabled?: boolean;
	key: string;
	label: ReactNode;
}

interface TabsProps {
	activeKey?: string;
	className?: string;
	items?: TabsItem[];
	onChange?: (key: string) => void;
	size?: TabsSize;
	variant?: TabsVariant;
}

const LIST_VARIANT = {
	point: null,
	rounded: "ui-tabs-list-rounded",
} as const;

const INDICATOR_VARIANT = {
	point: "ui-tabs-indicator-point",
	rounded: "ui-tabs-indicator-rounded",
} as const;

const TAB_SIZE = {
	middle: "ui-tabs-tab-middle",
	small: "ui-tabs-tab-small",
} as const;

const TAB_VARIANT = {
	point: "ui-tabs-tab-point",
	rounded: null,
} as const;

export function Tabs({
	activeKey,
	className,
	items,
	onChange,
	size = "middle",
	variant = "rounded",
}: TabsProps) {
	const [innerKey, setInnerKey] = useState<string | null>(
		() => items?.find((item) => !item.disabled)?.key ?? null,
	);
	const current = activeKey !== undefined ? activeKey : innerKey;
	const hasPanels = items?.some((item) => item.children != null);

	return (
		<TabsPrimitive.Root
			className={cn("ui-tabs", className)}
			onValueChange={(next: string | null) => {
				setInnerKey(next ?? null);
				if (next != null) onChange?.(next);
			}}
			value={current}
		>
			<TabsPrimitive.List className={cn("ui-tabs-list", LIST_VARIANT[variant])}>
				<TabsPrimitive.Indicator
					className={cn("ui-tabs-indicator", INDICATOR_VARIANT[variant])}
					renderBeforeHydration
				/>
				{items?.map((item) => (
					<TabsPrimitive.Tab
						className={cn("ui-tabs-tab", TAB_SIZE[size], TAB_VARIANT[variant])}
						disabled={item.disabled}
						key={item.key}
						value={item.key}
					>
						{item.label}
					</TabsPrimitive.Tab>
				))}
			</TabsPrimitive.List>
			{hasPanels &&
				items?.map((item) => (
					<TabsPrimitive.Panel
						className="ui-tabs-panel"
						key={item.key}
						value={item.key}
					>
						{item.children}
					</TabsPrimitive.Panel>
				))}
		</TabsPrimitive.Root>
	);
}
