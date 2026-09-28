"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 一排标签，选中项下方一个圆点。只切换，不带面板：内容由调用处按 `activeKey` 渲染。
 * 圆点在服务端渲染时就按选中项定位，首帧不从原点滑过来。
 */

interface TabsItem {
	key: string;
	label: ReactNode;
}

interface TabsProps {
	activeKey: string;
	className?: string;
	items: TabsItem[];
	onChange: (key: string) => void;
}

export function Tabs({ activeKey, className, items, onChange }: TabsProps) {
	return (
		<TabsPrimitive.Root
			className={cn("ui-tabs", className)}
			onValueChange={(next: string | null) => {
				if (next != null) onChange(next);
			}}
			value={activeKey}
		>
			<TabsPrimitive.List className="ui-tabs-list">
				<TabsPrimitive.Indicator
					className="ui-tabs-indicator"
					renderBeforeHydration
				/>
				{items.map((item) => (
					<TabsPrimitive.Tab
						className="ui-tabs-tab"
						key={item.key}
						value={item.key}
					>
						{item.label}
					</TabsPrimitive.Tab>
				))}
			</TabsPrimitive.List>
		</TabsPrimitive.Root>
	);
}
