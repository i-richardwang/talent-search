import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 首页输入框下面的一组条目。一条是整行可点的一块（`render` 传路由的 `<Link>` 或按钮）；
 * `record` 是做过的事，`prose` 是一句可以拿去用的话。
 */

export function GroupBlock({
	title,
	description,
	count,
	action,
	className,
	children,
}: {
	title: string;
	description?: ReactNode;
	count?: number;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section aria-label={title} className={cn("ui-group-block", className)}>
			<div className="ui-group-block-header">
				<div className="ui-group-block-heading">
					<div className="ui-group-block-title-row">
						<h2 className="ui-group-block-title">{title}</h2>
						{count !== undefined && (
							<span className="ui-group-block-count">{count}</span>
						)}
					</div>
					{description && (
						<p className="ui-group-block-description">{description}</p>
					)}
				</div>
				{action && <div className="ui-group-block-action-slot">{action}</div>}
			</div>
			<div className="ui-group-block-items">{children}</div>
		</section>
	);
}

export function GroupBlockItem({
	icon,
	title,
	description,
	extra,
	variant = "record",
	className,
	render,
	...props
}: Omit<useRender.ComponentProps<"a">, "title" | "children"> & {
	icon: LucideIcon;
	title: ReactNode;
	description?: ReactNode;
	/** 行尾的时间；占住固定的最小宽度，一列时间竖着对齐。 */
	extra?: ReactNode;
	variant?: "record" | "prose";
}) {
	const prose = variant === "prose";
	return useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(props, {
			className: cn(
				"ui-group-block-item",
				prose && "ui-group-block-item-prose",
				className,
			),
			children: (
				<>
					<span className="ui-group-block-item-icon">
						<Icon icon={icon} size={prose ? 18 : 16} />
					</span>
					<span className="ui-group-block-item-text">
						<span className="ui-group-block-item-title">{title}</span>
						{description && (
							<span className="ui-group-block-item-description">
								{description}
							</span>
						)}
					</span>
					{extra && <span className="ui-group-block-item-extra">{extra}</span>}
				</>
			),
		}),
		render,
	});
}

/** 组名行尾的一个文字动作，如「查看全部」。 */
export function GroupBlockAction({
	className,
	type = "button",
	...props
}: ComponentProps<"button">) {
	return (
		<button
			className={cn("ui-group-block-action", className)}
			type={type}
			{...props}
		/>
	);
}
