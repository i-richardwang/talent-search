import { useLayoutEffect, useRef, useState } from "react";
import {
	type ComponentSizing,
	editUnit,
	numericTokens,
	type SizeTier,
	TIER_LABEL,
} from "../../shared/tokens/registry";
import { usePreviewState, useTokenNumber } from "../state";

/*
 * 展示台下面那条读数：尺寸令牌按令牌表读，别的数从画出来的元素上量。
 */

/**
 * 一个组件这一档的尺寸读数：令牌表里这个组件这一档的令牌和不分档的令牌，
 * 标签是令牌表里的名字，值是修改后的。每项一个 `<span>`，放进读数条或一格里。
 */
export function SizeReading({
	group,
	tier,
}: {
	group: ComponentSizing;
	tier: SizeTier;
}) {
	const read = useTokenNumber();
	return (
		<>
			{numericTokens(group)
				.filter((token) => token.size === undefined || token.size === tier)
				.map((token) => (
					<span key={token.key}>
						{token.label} {read(token.key)}
						{editUnit(token)}
					</span>
				))}
		</>
	);
}

/**
 * 从 `ref` 挂着的元素上量读数。每次渲染后重量，修改、外观一变也重量；
 * 量出来和上次一样时不触发渲染。第一次渲染（和服务端渲染）时还没有读数。
 */
export function useMeasured<Reading>(
	measure: (root: HTMLElement) => Reading | undefined,
) {
	// 订阅预览状态：令牌改了，元素跟着变，这里要重量。
	usePreviewState();
	const ref = useRef<HTMLDivElement>(null);
	const [reading, setReading] = useState<Reading>();
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root) return;
		const next = measure(root);
		setReading((prev) =>
			JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
		);
	});
	return { reading, ref };
}

/** 量出来的像素：保留一位小数。 */
export const px = (value: number) => `${Math.round(value * 10) / 10}px`;

/** 尺寸表每行的第一格：档名，下面是这一档的中文名与尺寸读数。 */
export function SizeCell({
	group,
	tier,
}: {
	group: ComponentSizing;
	tier: SizeTier;
}) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="font-mono text-xs">{tier}</span>
			<span className="flex flex-wrap gap-x-2 text-fg-tertiary text-xs tabular-nums">
				<span>{TIER_LABEL[tier]}</span>
				<SizeReading group={group} tier={tier} />
			</span>
		</div>
	);
}
