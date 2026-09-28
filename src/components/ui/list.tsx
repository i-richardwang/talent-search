import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 给了 `render`（路由的 `<Link>`）的一项整行可点：标题就是那条链接，它的 `::after`
 * 铺满整行当点击面。行尾放 `extra` 或 `actions` 之一；`actions` 画在链接外、盖在行尾。
 */

export function List({ className, ...props }: ComponentProps<"ul">) {
	return <ul className={cn("ui-list", className)} {...props} />;
}

interface ListItemProps
	extends Omit<useRender.ComponentProps<"a">, "title" | "children" | "href"> {
	title: ReactNode;
	description?: ReactNode;
	extra?: ReactNode;
	actions?: ReactNode;
	/** 加在整行上，不给链接。 */
	className?: string;
}

export function ListItem({
	title,
	description,
	extra,
	actions,
	className,
	render,
	...props
}: ListItemProps) {
	const clickable = Boolean(render);
	const link = useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			children: title,
			className: "ui-list-item-link",
		}),
		render,
		enabled: clickable,
	});
	return (
		<li
			className={cn(
				"ui-list-item",
				clickable && "ui-list-item-clickable",
				className,
			)}
		>
			<div className="ui-list-item-content">
				<div className="ui-list-item-title">{clickable ? link : title}</div>
				{description && <div className="ui-list-item-desc">{description}</div>}
			</div>
			{actions && <div className="ui-list-item-actions">{actions}</div>}
			{extra && <div className="ui-list-item-extra">{extra}</div>}
		</li>
	);
}

/*
 * 可多选的列表视图。一行整行可点时，内容里放一条 `ListViewLink`，它的覆盖层铺满整行，
 * 选择格 `pick` 和行尾 `extra` 压在它上面。勾上的底由行里 Checkbox 的勾选状态决定，调用处不另传。
 */

export function ListView({ className, ...props }: ComponentProps<"ul">) {
	return <ul className={cn("ui-list-view", className)} {...props} />;
}

export function ListViewHeader({
	pick,
	children,
	className,
}: {
	pick?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<li className={cn("ui-list-view-header", className)}>
			<div className="ui-list-view-pick">{pick}</div>
			<div className="min-w-0">{children}</div>
		</li>
	);
}

export function ListViewRow({
	pick,
	extra,
	current,
	children,
	className,
	...props
}: Omit<ComponentProps<"li">, "children"> & {
	pick?: ReactNode;
	extra?: ReactNode;
	/** 详情正开着的这一行。 */
	current?: boolean;
	children: ReactNode;
}) {
	return (
		<li
			className={cn("ui-list-view-row", className)}
			data-current={current ? "" : undefined}
			{...props}
		>
			<div className="ui-list-view-pick">{pick}</div>
			<div className="min-w-0">{children}</div>
			{extra && <div className="ui-list-view-extra">{extra}</div>}
		</li>
	);
}

/** `render` 传路由的 `<Link>`。 */
export function ListViewLink({
	className,
	render,
	...props
}: useRender.ComponentProps<"a">) {
	return useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			className: cn("ui-list-view-link", className),
		}),
		render,
	});
}
