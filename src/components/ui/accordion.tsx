"use client";

import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { ChevronDown, ChevronRight, Play } from "lucide-react";
import {
	type ComponentProps,
	createContext,
	type ReactNode,
	use,
	useMemo,
} from "react";
import { cn } from "#/lib/utils";

/*
 * 手风琴：一组可各自开合的项，行为是 Base UI Accordion，样式在 accordion.css。
 * 每项是 AccordionItem 里一个 AccordionHeader（里面是整行可点的 AccordionTrigger，和可选的
 * AccordionAction）加一个 AccordionPanel。展开的是哪几项用 `value` 受控或 `defaultValue`
 * 自管，值是各项 `value` 的数组；默认几项可以同时开着。
 *
 * 三种面：borderless 没有底，悬停整行铺 fill-tertiary，行向两边各伸出 8px 让字和外面对齐；
 * filled 行常铺 fill-tertiary，悬停加深一档；outlined 整组一圈描边，项与项之间一条线。
 *
 * 箭头三种放法：start 在字前（向右的箭头，开着转向下），面板内容跟着缩进 24px；end 在行尾
 * （向下的箭头，开着转向上）；inline 紧跟在字后（7px 的实心三角，开着转向下），行不向外伸，
 * 面板不缩进也没有上下留白，用在侧栏分组的组名和一段过程的摘要行上。
 *
 * 行尾的 AccordionAction 平时透明，指针悬停在行上或焦点落进行里时出现；`alwaysVisible`
 * 常显；没有悬停的设备上常显，否则摸不到。
 */

export type AccordionVariant = "borderless" | "filled" | "outlined";
export type AccordionIndicatorPlacement = "start" | "end" | "inline";

interface AccordionContextValue {
	hideIndicator: boolean;
	indicatorPlacement: AccordionIndicatorPlacement;
	variant: AccordionVariant;
}

const AccordionContext = createContext<AccordionContextValue>({
	hideIndicator: false,
	indicatorPlacement: "start",
	variant: "borderless",
});

interface AccordionLookProps {
	hideIndicator?: boolean;
	indicatorPlacement?: AccordionIndicatorPlacement;
	variant?: AccordionVariant;
}

type AccordionRootProps = Omit<
	ComponentProps<typeof BaseAccordion.Root<string>>,
	"className" | "render" | "onValueChange"
> &
	AccordionLookProps & {
		className?: string;
		onValueChange?: (value: string[]) => void;
	};

export function AccordionRoot({
	className,
	hideIndicator = false,
	indicatorPlacement = "start",
	multiple = true,
	onValueChange,
	variant = "borderless",
	...rest
}: AccordionRootProps) {
	const look = useMemo(
		() => ({ hideIndicator, indicatorPlacement, variant }),
		[hideIndicator, indicatorPlacement, variant],
	);
	return (
		<AccordionContext value={look}>
			<BaseAccordion.Root<string>
				className={cn(
					"ui-accordion",
					variant === "outlined" && "ui-accordion-outlined",
					className,
				)}
				multiple={multiple}
				onValueChange={
					onValueChange ? (next) => onValueChange([...next]) : undefined
				}
				{...rest}
			/>
		</AccordionContext>
	);
}

type AccordionItemProps = Omit<
	ComponentProps<typeof BaseAccordion.Item>,
	"className" | "render"
> & { className?: string };

export function AccordionItem({ className, ...rest }: AccordionItemProps) {
	const { variant } = use(AccordionContext);
	return (
		<BaseAccordion.Item
			className={cn(
				"ui-accordion-item",
				variant === "outlined" && "ui-accordion-item-outlined",
				className,
			)}
			{...rest}
		/>
	);
}

type AccordionHeaderProps = Omit<
	ComponentProps<typeof BaseAccordion.Header>,
	"className" | "render"
> & { className?: string };

export function AccordionHeader({ className, ...rest }: AccordionHeaderProps) {
	const { indicatorPlacement, variant } = use(AccordionContext);
	return (
		<BaseAccordion.Header
			className={cn(
				"ui-accordion-header",
				`ui-accordion-header-${variant}`,
				indicatorPlacement === "inline" &&
					variant !== "outlined" &&
					"ui-accordion-header-inline",
				className,
			)}
			{...rest}
		/>
	);
}

const INDICATOR = {
	end: <ChevronDown size={16} />,
	inline: <Play fill="currentColor" size={7} strokeWidth={1} />,
	start: <ChevronRight size={16} />,
} as const;

type AccordionTriggerProps = Omit<
	ComponentProps<typeof BaseAccordion.Trigger>,
	"className" | "render"
> & { className?: string };

export function AccordionTrigger({
	children,
	className,
	...rest
}: AccordionTriggerProps) {
	const { hideIndicator, indicatorPlacement, variant } = use(AccordionContext);
	const indicator = hideIndicator ? null : (
		<span
			aria-hidden="true"
			className={cn(
				"ui-accordion-indicator",
				`ui-accordion-indicator-${indicatorPlacement}`,
			)}
		>
			{INDICATOR[indicatorPlacement]}
		</span>
	);
	return (
		<BaseAccordion.Trigger
			className={cn(
				"ui-accordion-trigger",
				`ui-accordion-trigger-${variant}`,
				className,
			)}
			{...rest}
		>
			{indicatorPlacement === "start" && indicator}
			{children}
			{indicatorPlacement !== "start" && indicator}
		</BaseAccordion.Trigger>
	);
}

/** 行尾的动作格，放在 AccordionHeader 里、AccordionTrigger 之后。 */
export function AccordionAction({
	alwaysVisible,
	children,
	className,
}: {
	alwaysVisible?: boolean;
	children: ReactNode;
	className?: string;
}) {
	const { variant } = use(AccordionContext);
	return (
		<div
			className={cn(
				"ui-accordion-action",
				variant !== "borderless" && "ui-accordion-action-inset",
				alwaysVisible && "ui-accordion-action-visible",
				className,
			)}
		>
			{children}
		</div>
	);
}

type AccordionPanelProps = Omit<
	ComponentProps<typeof BaseAccordion.Panel>,
	"className" | "render"
> & {
	className?: string;
	/** 面板里那层内容的类名：内容的留白与字号在这一层上。 */
	contentClassName?: string;
};

export function AccordionPanel({
	children,
	className,
	contentClassName,
	...rest
}: AccordionPanelProps) {
	const { hideIndicator, indicatorPlacement, variant } = use(AccordionContext);
	return (
		<BaseAccordion.Panel
			className={cn("ui-accordion-panel", className)}
			{...rest}
		>
			<div
				className={cn(
					"ui-accordion-content",
					`ui-accordion-content-${variant}`,
					!hideIndicator &&
						indicatorPlacement === "start" &&
						"ui-accordion-content-indent",
					indicatorPlacement === "inline" &&
						variant === "borderless" &&
						"ui-accordion-content-inline",
					contentClassName,
				)}
			>
				{children}
			</div>
		</BaseAccordion.Panel>
	);
}

export interface AccordionItemType {
	/** 行尾的动作，平时藏着，悬停时出现。 */
	action?: ReactNode;
	alwaysShowAction?: boolean;
	children?: ReactNode;
	disabled?: boolean;
	key: string;
	title: ReactNode;
}

interface AccordionProps
	extends Omit<AccordionRootProps, "children">,
		AccordionLookProps {
	items: readonly AccordionItemType[];
	/** 收起的面板留在文档里，只是藏起来。 */
	keepMounted?: boolean;
	/** 各部分的类名，给调用处调行高、留白用。 */
	classNames?: { content?: string; header?: string; trigger?: string };
}

/** 按 `items` 一次画完一组项；要在行上套别的东西（比如右键菜单）时直接用各部分拼。 */
export function Accordion({
	classNames,
	items,
	keepMounted,
	...rest
}: AccordionProps) {
	return (
		<AccordionRoot {...rest}>
			{items.map((item) => (
				<AccordionItem disabled={item.disabled} key={item.key} value={item.key}>
					<AccordionHeader className={classNames?.header}>
						<AccordionTrigger className={classNames?.trigger}>
							{item.title}
						</AccordionTrigger>
						{item.action && (
							<AccordionAction alwaysVisible={item.alwaysShowAction}>
								{item.action}
							</AccordionAction>
						)}
					</AccordionHeader>
					<AccordionPanel
						contentClassName={classNames?.content}
						keepMounted={keepMounted}
					>
						{item.children}
					</AccordionPanel>
				</AccordionItem>
			))}
		</AccordionRoot>
	);
}
