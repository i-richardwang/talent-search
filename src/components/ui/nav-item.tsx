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
 * 导航项，样式在 nav-item.css。一行就是一条链接：`render` 传路由的 `<Link>`，中键、右键
 * 照常；不去别处、只打开什么的一行（「更多」）传 `render={<button type="button" />}`。
 * `actions` 画在链接外、盖在行尾，于是链接里不嵌别的动作。标题放不下时截断，
 * 指针停在被截断的标题上时提示完整的一行。
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
	/** `small` 是 14px 的图标，给一长串同类的记录（最近搜索）；缺省 18px，给几个固定的入口。 */
	iconSize?: "small";
	/** 当前所在的那一项。 */
	active?: boolean;
	/** 行尾的动作：指针进入这一行、键盘焦点落到动作上、或动作的弹层开着时出现。 */
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

/**
 * 导航栏里的几组，每组可以收起。行为是 `Accordion`：`value` 是展开着的那几组，
 * 由使用方记住；组名后面一枚小三角，开着朝下。组与组之间 8px。
 */
export function NavGroups({
	value,
	onValueChange,
	className,
	children,
}: {
	value: string[];
	onValueChange: (value: string[]) => void;
	className?: string;
	children: ReactNode;
}) {
	return (
		<AccordionRoot
			className={cn("ui-nav-groups", className)}
			indicatorPlacement="inline"
			onValueChange={onValueChange}
			value={value}
		>
			{children}
		</AccordionRoot>
	);
}

/**
 * 一组导航项，放在 `NavGroups` 里。组名一行整行可点，点一下收起或展开；`action`
 * 在行尾，指针进入这一行或焦点落进来时出现。给了 `headerMenu` 时，在组名那一行上
 * 按右键打开它（组里的行各有各的右键菜单）。
 */
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
	/** 组名那一行的右键菜单：`renderDropdownMenuItems(...)` 或下拉菜单的原子件。 */
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
