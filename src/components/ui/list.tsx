import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "#/lib/utils";

/*
 * 列表，样式在 list.css。`List` 是一个 `<ul>`，项与项之间 4px、四周 4px；
 * 一项 `ListItem` 是一行：左边头像或图标，中间标题（14px 中粗）与说明（12px 三级灰），
 * 右边是 `extra`（12px 的小字）或行尾动作。
 *
 * 给了 `render`（路由的 `<Link>`）或 `href` 的一项整行可点：标题就是那条链接，
 * 链接的 `::after` 铺满整行当点击面，中键、右键照常；这时悬停出 fill-tertiary 的底、
 * 手形光标。没给的一项是静态的一行，没有悬停。`active` 是当前项：fill-secondary 的底，
 * 悬停加深到 fill。
 *
 * `actions` 画在链接外、盖在行尾，平时透明，悬停或焦点落在行内时出现，`extra` 同时隐去；
 * `showAction` 让它一直显示。
 */

export function List({ className, ...props }: ComponentProps<"ul">) {
	return <ul className={cn("ui-list", className)} {...props} />;
}

interface ListItemProps
	extends Omit<useRender.ComponentProps<"a">, "title" | "children"> {
	title: ReactNode;
	description?: ReactNode;
	/** 标题左边的头像或图标，顶端对齐。 */
	avatar?: ReactNode;
	/** 说明下面接着排的内容，例如一行证据。 */
	addon?: ReactNode;
	/** 行尾的小字，例如人数、时间；行尾动作出现时隐去。 */
	extra?: ReactNode;
	/** 行尾的动作，悬停或焦点落在行内时出现。 */
	actions?: ReactNode;
	/** 行尾动作一直显示。 */
	showAction?: boolean;
	/** 当前项。 */
	active?: boolean;
	/** 根元素：放在 `List` 里是 `li`；一行外面还有别的东西（选择框）时由外层出 `li`，这里写 `div`。 */
	as?: "li" | "div";
	/** 加在整行上。 */
	className?: string;
	style?: CSSProperties;
}

export function ListItem({
	title,
	description,
	avatar,
	addon,
	extra,
	actions,
	showAction,
	active,
	as: Root = "li",
	className,
	style,
	render,
	href,
	...props
}: ListItemProps) {
	const clickable = Boolean(render || href);
	const link = useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			"aria-current": active ? "page" : undefined,
			children: title,
			className: "ui-list-item-link",
			href,
		}),
		render,
		enabled: clickable,
	});
	return (
		<Root
			className={cn(
				"ui-list-item",
				clickable && "ui-list-item-clickable",
				active && "ui-list-item-active",
				className,
			)}
			style={style}
		>
			<div className="ui-list-item-container">
				{avatar}
				<div className="ui-list-item-content">
					<div className="ui-list-item-title">{clickable ? link : title}</div>
					{description && (
						<div className="ui-list-item-desc">{description}</div>
					)}
					{addon}
				</div>
			</div>
			{actions && (
				<div
					className="ui-list-item-actions"
					data-show={showAction ? "" : undefined}
				>
					{actions}
				</div>
			)}
			{extra && <div className="ui-list-item-extra">{extra}</div>}
		</Root>
	);
}

/*
 * 可多选的列表视图：一块描边的面，`ListViewHeader` 吸在顶上，下面是一串 `ListViewRow`。
 * 表头和每一行的第一格是选择格（`pick`，放 18px 的 Checkbox），第二格是内容；一行可以
 * 再有第三格 `extra`，贴在行尾、上下居中，放这一行自己的一个小控件。
 * 一行整行可点时，内容里放一条 `ListViewLink`：它的覆盖层铺满整行，选择格和 `extra`
 * 压在它上面。
 * 勾上的一行换成主色一侧最浅的底，由行里的 Checkbox 的勾选状态决定，调用处不另传。
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
	/** 行尾的一格。 */
	extra?: ReactNode;
	/** 当前项：详情正开着的这一行。 */
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

/** 整行可点的那条链接；`render` 传路由的 `<Link>`，中键、右键照常。 */
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
