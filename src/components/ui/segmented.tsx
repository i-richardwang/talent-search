"use client";

import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { cn } from "#/lib/utils";

/*
 * 分段选择，样式在 segmented.css。选中的那一段垫一块 elevated 的底，换选项时这块底
 * 在 240ms 里滑过去：它的位置和尺寸由选中项的 offset 写成列表上的变量。
 * 选中哪一段由调用处持有（`value` / `onChange`）。
 * `className` 落在列表上；`aria-label` 给这组选项起名字。
 */

type SegmentedSize = "middle" | "small";

interface SegmentedOption<Value extends string = string> {
	icon?: ReactNode;
	label?: ReactNode;
	/** 只有图标时，它也是这一段的名字。 */
	title?: string;
	value: Value;
}

interface SegmentedProps<Value extends string = string> {
	"aria-label"?: string;
	/** 撑满父级宽度，各段等分。 */
	block?: boolean;
	className?: string;
	onChange: (value: Value) => void;
	options: (SegmentedOption<Value> | Value)[];
	size?: SegmentedSize;
	value: Value;
}

const ITEM_SIZE = {
	middle: "ui-segmented-item-middle",
	small: "ui-segmented-item-small",
} as const;

const normalizeOption = <Value extends string>(
	option: SegmentedOption<Value> | Value,
): SegmentedOption<Value> =>
	typeof option === "string" ? { label: option, value: option } : option;

export function Segmented<Value extends string = string>({
	"aria-label": ariaLabel,
	block = false,
	className,
	onChange,
	options,
	size = "middle",
	value,
}: SegmentedProps<Value>) {
	const listRef = useRef<HTMLDivElement>(null);
	const normalized = options.map((option) => normalizeOption(option));

	const updateIndicator = useCallback(() => {
		const list = listRef.current;
		if (!list) return;
		const active = list.querySelector<HTMLElement>(
			"[data-segmented-item][data-pressed]",
		);
		const set = (key: string, px: number) =>
			list.style.setProperty(`--active-item-${key}`, `${px}px`);
		if (!active) {
			for (const key of ["left", "top", "right", "width", "height"])
				set(key, 0);
			return;
		}
		set("left", active.offsetLeft);
		set("top", active.offsetTop);
		set("right", list.clientWidth - active.offsetLeft - active.offsetWidth);
		set("width", active.offsetWidth);
		set("height", active.offsetHeight);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: 选中项、选项、尺寸一变，底块就要重新量
	useLayoutEffect(() => {
		updateIndicator();
	}, [value, options, size, block, updateIndicator]);

	useEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const observer = new ResizeObserver(() => updateIndicator());
		observer.observe(list);
		return () => observer.disconnect();
	}, [updateIndicator]);

	return (
		<ToggleGroup<Value>
			aria-label={ariaLabel}
			className={cn(
				"ui-segmented-list",
				block && "ui-segmented-list-block",
				className,
			)}
			onValueChange={(next) => {
				const picked = next[0];
				if (picked != null) onChange(picked);
			}}
			ref={listRef}
			value={[value]}
		>
			<span aria-hidden className="ui-segmented-indicator" />
			{normalized.map((option) => (
				<Toggle<Value>
					aria-label={
						typeof option.label === "string" ? option.label : undefined
					}
					className={cn(
						"ui-segmented-item",
						ITEM_SIZE[size],
						block && "ui-segmented-item-block",
					)}
					data-segmented-item=""
					key={option.value}
					title={option.title}
					value={option.value}
				>
					{option.icon != null && (
						<span className="ui-segmented-item-icon">{option.icon}</span>
					)}
					{option.label != null && (
						<span className="ui-segmented-item-label">{option.label}</span>
					)}
				</Toggle>
			))}
		</ToggleGroup>
	);
}
