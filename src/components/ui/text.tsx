"use client";

import {
	type CSSProperties,
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
 * 一段文字，样式在 text.css。不给 `type` 时颜色随外层继承；字号与字重只取字阶令牌的档名，
 * 不收像素数。标题元素（h1–h5）自带一档字号、粗体与 1.25 的行高，`size`、`weight` 盖它。
 *
 * - `ellipsis`：`true` 是单行截断；`{ rows }` 是多行截断，末行出省略号。
 *   `{ tooltip: true }` 只在文字真的被截断时，悬停显示完整内容；没截断就没有提示。
 * - `shiny`：一道亮光扫过文字，表示「正在进行」。静止色是 28% 的字色，给了 `type` 时
 *   静止色就是那一档颜色，亮光峰值总是正文色。减弱动效时停在静止色。
 * - `code` 换等宽字体；`strong` 是粗体。
 */

type TextElement =
	| "span"
	| "p"
	| "div"
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "h5"
	| "h6";

type TextType =
	| "secondary"
	| "tertiary"
	| "quaternary"
	| "success"
	| "warning"
	| "danger"
	| "info";

type TextSize = "xs" | "sm" | "base" | "lg" | "xl" | "2xl";

type TextWeight = "normal" | "medium" | "semibold" | "bold";

interface TextEllipsis {
	/** 最多几行；不给或 1 是单行。 */
	rows?: number;
	/** 被截断时悬停显示完整内容。 */
	tooltip?: boolean;
}

export interface TextProps extends HTMLAttributes<HTMLElement> {
	as?: TextElement;
	code?: boolean;
	ellipsis?: boolean | TextEllipsis;
	ref?: Ref<HTMLElement>;
	shiny?: boolean;
	size?: TextSize;
	strong?: boolean;
	type?: TextType;
	weight?: TextWeight;
}

const HEADING = {
	h1: "ui-text-h1",
	h2: "ui-text-h2",
	h3: "ui-text-h3",
	h4: "ui-text-h4",
	h5: "ui-text-h5",
} as const;

const TYPE = {
	danger: "ui-text-type-danger",
	info: "ui-text-type-info",
	quaternary: "ui-text-type-quaternary",
	secondary: "ui-text-type-secondary",
	success: "ui-text-type-success",
	tertiary: "ui-text-type-tertiary",
	warning: "ui-text-type-warning",
} as const;

const SIZE = {
	"2xl": "ui-text-size-2xl",
	base: "ui-text-size-base",
	lg: "ui-text-size-lg",
	sm: "ui-text-size-sm",
	xl: "ui-text-size-xl",
	xs: "ui-text-size-xs",
} as const;

const WEIGHT = {
	bold: "ui-text-weight-bold",
	medium: "ui-text-weight-medium",
	normal: "ui-text-weight-normal",
	semibold: "ui-text-weight-semibold",
} as const;

/**
 * 元素是否被截断：单行比宽，多行比高。尺寸变了或内容换了都重量一次。
 * 元素以状态保存，提示套上或摘掉使元素重挂时，观察跟着换到新元素上。
 */
function useTruncated(
	node: HTMLElement | null,
	multiline: boolean,
	content: unknown,
) {
	const [truncated, setTruncated] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 内容换了盒子尺寸可能不变，ResizeObserver 不触发，要靠 content 重量
	useEffect(() => {
		if (!node) return;
		const measure = () =>
			setTruncated(
				multiline
					? node.scrollHeight > node.clientHeight
					: node.scrollWidth > node.clientWidth,
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, [node, multiline, content]);
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
	strong,
	style,
	type,
	weight,
	...rest
}: TextProps) {
	// 标签只在几种文字元素里选，ref 统一按 HTMLElement 交给调用处。
	const Element = as as ElementType;
	const rows = typeof ellipsis === "object" ? (ellipsis.rows ?? 1) : 1;
	const multiline = rows > 1;
	const tooltip = typeof ellipsis === "object" && ellipsis.tooltip === true;

	const [node, setNode] = useState<HTMLElement | null>(null);
	const measuredRef = useCallback(
		(element: HTMLElement | null) => {
			setNode(element);
			if (typeof ref === "function") return ref(element);
			if (ref) ref.current = element;
		},
		[ref],
	);
	const truncated = useTruncated(tooltip ? node : null, multiline, children);

	const content = (
		<Element
			{...rest}
			className={cn(
				"ui-text",
				as in HEADING && HEADING[as as keyof typeof HEADING],
				shiny && "ui-text-shiny",
				type && TYPE[type],
				size && SIZE[size],
				strong && "ui-text-strong",
				weight && WEIGHT[weight],
				code && "ui-text-code",
				ellipsis && (multiline ? "ui-text-ellipsis-multi" : "ui-text-ellipsis"),
				className,
			)}
			ref={tooltip ? measuredRef : ref}
			style={
				multiline
					? ({ WebkitLineClamp: rows, ...style } as CSSProperties)
					: style
			}
		>
			{children}
		</Element>
	);

	if (!tooltip) return content;
	return <Tooltip title={truncated ? children : null}>{content}</Tooltip>;
}
