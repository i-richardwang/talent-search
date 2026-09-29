"use client";

import {
	type ElementType,
	type HTMLAttributes,
	type Ref,
	useCallback,
	useEffect,
	useState,
} from "react";
import { Tooltip } from "#/components/ui/tooltip";
import { cn } from "#/lib/utils";

/*
 * 不给 `type` 时颜色随外层继承；字号与字重只取字阶令牌的档名，不收像素数。
 * `ellipsis` 的 `tooltip` 只在文字真的被截断时悬停显示完整内容。
 * `shiny` 表示「正在进行」，给了 `type` 时静止色就是那一档颜色。
 */

type TextType = "secondary" | "tertiary" | "quaternary";

type TextSize = "xs" | "sm" | "lg" | "2xl";

type TextWeight = "medium" | "bold";

interface TextProps extends HTMLAttributes<HTMLElement> {
	as?: "span" | "p" | "div";
	code?: boolean;
	ellipsis?: boolean | { tooltip: true };
	ref?: Ref<HTMLElement>;
	shiny?: boolean;
	size?: TextSize;
	type?: TextType;
	weight?: TextWeight;
}

const TYPE = {
	quaternary: "ui-text-type-quaternary",
	secondary: "ui-text-type-secondary",
	tertiary: "ui-text-type-tertiary",
} as const;

const SIZE = {
	"2xl": "ui-text-size-2xl",
	lg: "ui-text-size-lg",
	sm: "ui-text-size-sm",
	xs: "ui-text-size-xs",
} as const;

const WEIGHT = {
	bold: "ui-text-weight-bold",
	medium: "ui-text-weight-medium",
} as const;

/** 元素以状态保存：提示套上或摘掉使元素重挂时，观察跟着换到新元素上。 */
function useTruncated(node: HTMLElement | null, content: unknown) {
	const [truncated, setTruncated] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 内容换了盒子尺寸可能不变，ResizeObserver 不触发，要靠 content 触发重新测量
	useEffect(() => {
		if (!node) return;
		const measure = () => setTruncated(node.scrollWidth > node.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [node, content]);
	return truncated;
}

export function Text({
	as = "span",
	children,
	className,
	code,
	ellipsis,
	ref,
	shiny,
	size,
	type,
	weight,
	...rest
}: TextProps) {
	// 标签只在几种文字元素里选，ref 统一按 HTMLElement 交给调用处。
	const Element = as as ElementType;
	const tooltip = typeof ellipsis === "object";

	const [node, setNode] = useState<HTMLElement | null>(null);
	const measuredRef = useCallback(
		(element: HTMLElement | null) => {
			setNode(element);
			if (typeof ref === "function") return ref(element);
			if (ref) ref.current = element;
		},
		[ref],
	);
	const truncated = useTruncated(tooltip ? node : null, children);

	const content = (
		<Element
			{...rest}
			className={cn(
				"ui-text",
				shiny && "ui-text-shiny",
				type && TYPE[type],
				size && SIZE[size],
				weight && WEIGHT[weight],
				code && "ui-text-code",
				ellipsis && "ui-text-ellipsis",
				className,
			)}
			ref={tooltip ? measuredRef : ref}
		>
			{children}
		</Element>
	);

	if (!tooltip) return content;
	return <Tooltip title={truncated ? children : null}>{content}</Tooltip>;
}
