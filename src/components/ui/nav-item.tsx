import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import {
	AccordionAction,
	AccordionHeader,
	AccordionItem,
	AccordionPanel,
	AccordionRoot,
	AccordionTrigger,
} from "./accordion";
import { ContextMenu } from "./context-menu";
import { Icon } from "./icon";
import { Text } from "./text";

/*
 * 一行就是一条链接：`render` 传路由的 `<Link>`；只打开什么的一行传 `render={<button type="button" />}`。
 * `actions` 画在链接外、盖在行尾，于是链接里不嵌别的动作。
 */

export function NavItem({
	icon,
	iconSize,
	active,
	actions,
	children,
	className,
	render,
	...props
}: Omit<useRender.ComponentProps<"a">, "children"> & {
	icon: LucideIcon;
	/** `small` 给一长串同类的记录（最近搜索）；缺省给几个固定的入口。 */
	iconSize?: "small";
	active?: boolean;
	actions?: ReactNode;
	children: ReactNode;
}) {
	const link = useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			"aria-current": active ? "page" : undefined,
			className: cn("ui-nav-item", active && "ui-nav-item-active", className),
			children: (
				<>
					<span className="ui-nav-item-icon">
						<Icon icon={icon} size={iconSize === "small" ? 14 : 18} />
					</span>
					<Text className="ui-nav-item-title" ellipsis={{ tooltip: true }}>
						{children}
					</Text>
				</>
			),
		}),
		render,
	});
	if (!actions) return link;
	return (
		<div className="ui-nav-item-root">
			{link}
			<div className="ui-nav-item-actions">{actions}</div>
		</div>
	);
}

/** `value` 是展开着的那几组，由使用方记住。 */
export function NavGroups({
	value,
	onValueChange,
	children,
}: {
	value: string[];
	onValueChange: (value: string[]) => void;
	children: ReactNode;
}) {
	return (
		<AccordionRoot
			className="ui-nav-groups"
			onValueChange={onValueChange}
			value={value}
		>
			{children}
		</AccordionRoot>
	);
}

/** `headerMenu` 只挂在组名那一行上，组里的行各有各的右键菜单。 */
export function NavGroup({
	value,
	title,
	action,
	headerMenu,
	children,
}: {
	value: string;
	title: string;
	action?: ReactNode;
	/** `renderDropdownMenuItems(...)` 或下拉菜单的原子件。 */
	headerMenu?: ReactNode;
	children: ReactNode;
}) {
	const header = (
		<AccordionHeader>
			<AccordionTrigger className="ui-nav-group-title">
				{title}
			</AccordionTrigger>
			{action && <AccordionAction>{action}</AccordionAction>}
		</AccordionHeader>
	);
	return (
		<AccordionItem value={value}>
			{headerMenu ? (
				<ContextMenu menu={headerMenu}>{header}</ContextMenu>
			) : (
				header
			)}
			<AccordionPanel contentClassName="ui-nav-group-items">
				{children}
			</AccordionPanel>
		</AccordionItem>
	);
}
