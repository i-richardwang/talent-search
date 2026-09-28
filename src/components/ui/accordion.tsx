"use client";

import { Accordion as BaseAccordion } from "@base-ui/react/accordion";
import { Play } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 手风琴：一组可各自开合的项，行为是 Base UI Accordion。展开哪几项用 `value` 受控或
 * `defaultValue` 自管，默认几项可以同时开着。开合的箭头跟在标题后面；面板与过渡和
 * Collapsible 共用一份（collapsible.css）。
 */

type AccordionRootProps = Omit<
	ComponentProps<typeof BaseAccordion.Root<string>>,
	"className" | "render" | "onValueChange"
> & {
	className?: string;
	onValueChange?: (value: string[]) => void;
};

export function AccordionRoot({
	className,
	multiple = true,
	onValueChange,
	...rest
}: AccordionRootProps) {
	return (
		<BaseAccordion.Root<string>
			className={cn("ui-accordion", className)}
			multiple={multiple}
			onValueChange={
				onValueChange ? (next) => onValueChange([...next]) : undefined
			}
			{...rest}
		/>
	);
}

type AccordionItemProps = Omit<
	ComponentProps<typeof BaseAccordion.Item>,
	"className" | "render"
>;

export function AccordionItem(props: AccordionItemProps) {
	return <BaseAccordion.Item className="ui-accordion-item" {...props} />;
}

type AccordionHeaderProps = Omit<
	ComponentProps<typeof BaseAccordion.Header>,
	"className" | "render"
>;

export function AccordionHeader(props: AccordionHeaderProps) {
	return <BaseAccordion.Header className="ui-accordion-header" {...props} />;
}

type AccordionTriggerProps = Omit<
	ComponentProps<typeof BaseAccordion.Trigger>,
	"className" | "render"
> & { className?: string };

export function AccordionTrigger({
	children,
	className,
	...rest
}: AccordionTriggerProps) {
	return (
		<BaseAccordion.Trigger
			className={cn("ui-accordion-trigger", className)}
			{...rest}
		>
			{children}
			<span aria-hidden="true" className="ui-accordion-indicator">
				<Play fill="currentColor" size={7} strokeWidth={1} />
			</span>
		</BaseAccordion.Trigger>
	);
}

/** 行尾的动作格，放在 AccordionHeader 里、AccordionTrigger 之后。 */
export function AccordionAction({ children }: { children: ReactNode }) {
	return <div className="ui-accordion-action">{children}</div>;
}

type AccordionPanelProps = Omit<
	ComponentProps<typeof BaseAccordion.Panel>,
	"className" | "render"
> & {
	/** 面板里那层内容的类名：内容的留白与字号在这一层上。 */
	contentClassName?: string;
};

export function AccordionPanel({
	children,
	contentClassName,
	...rest
}: AccordionPanelProps) {
	return (
		<BaseAccordion.Panel className="ui-collapsible-panel" {...rest}>
			<div className={cn("ui-collapsible-content", contentClassName)}>
				{children}
			</div>
		</BaseAccordion.Panel>
	);
}

interface AccordionProps extends Omit<AccordionRootProps, "children"> {
	items: readonly { key: string; title: ReactNode; children?: ReactNode }[];
}

/** 按 `items` 一次画完一组项；要在行上套别的东西（比如右键菜单）时直接用各部分拼。 */
export function Accordion({ items, ...rest }: AccordionProps) {
	return (
		<AccordionRoot {...rest}>
			{items.map((item) => (
				<AccordionItem key={item.key} value={item.key}>
					<AccordionHeader>
						<AccordionTrigger>{item.title}</AccordionTrigger>
					</AccordionHeader>
					<AccordionPanel>{item.children}</AccordionPanel>
				</AccordionItem>
			))}
		</AccordionRoot>
	);
}
