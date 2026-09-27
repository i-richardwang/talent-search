import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 导航项，样式在 nav-item.css。一行就是一条链接：`render` 传路由的 `<Link>`，中键、右键
 * 照常。`actions` 画在链接外、盖在行尾，于是链接里不嵌别的动作。
 */

export function NavItem({
	icon,
	active,
	actions,
	children,
	className,
	render,
	...props
}: Omit<useRender.ComponentProps<"a">, "children"> & {
	icon: LucideIcon;
	/** 当前所在的那一项。 */
	active?: boolean;
	/** 行尾的动作，悬停或焦点落在行内时出现。 */
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
						<Icon icon={icon} size={18} />
					</span>
					<span className="ui-nav-item-title">{children}</span>
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

/** 一组导航项，组名在上。 */
export function NavGroup({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section aria-label={title} className="ui-nav-group">
			<h2 className="ui-nav-group-title">{title}</h2>
			{children}
		</section>
	);
}
