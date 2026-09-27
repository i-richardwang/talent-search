import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Icon } from "./icon";

/*
 * 首页输入框下面的一组条目，样式在 group-block.css。`GroupBlock` 是一组：组名一行
 * （12px 半粗、次要色、字距 0.04em，后面可以跟一个数），行尾放这一组的动作，
 * 下面是一列 `GroupBlockItem`，组名与条目之间 12px。
 *
 * 一条是整行可点的一块（`render` 传路由的 `<Link>`，或一个按钮）：左边图标，中间
 * 标题与下面一行说明，右边 `extra`（时间）。块向两边各伸出 10px、上下 9px，12px 圆角，
 * 悬停出 fill-quaternary 的底，于是字和组名、上面的输入框对齐，悬停的底比它们宽一截。
 *
 * 两种条目：`record` 是做过的事（标题 15px 中粗，图标 16px 三级灰），`prose` 是一句
 * 可以拿去用的话（标题 15px 常规，图标 18px 次要色，块至少 58px 高）。
 */

export function GroupBlock({
	title,
	description,
	count,
	action,
	className,
	children,
	...props
}: {
	title: string;
	/** 组名下面一行 13px 的三级灰小字。 */
	description?: ReactNode;
	/** 组名后面的数，画在一块小底上。 */
	count?: number;
	/** 组名行尾的动作。 */
	action?: ReactNode;
	className?: string;
	children: ReactNode;
} & Pick<ComponentProps<"section">, "aria-busy">) {
	return (
		<section
			aria-label={title}
			className={cn("ui-group-block", className)}
			{...props}
		>
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
				{action && <div className="ui-group-block-action">{action}</div>}
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
	/** 行尾的小字（时间），12px 三级灰，占住至少 56px 宽并右对齐，一列时间竖着对齐。 */
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

/** 组名行尾的一个动作，写成 12px 次要色的字（「查看全部」），悬停换成正文色。 */
export function GroupBlockAction({
	className,
	type = "button",
	...props
}: ComponentProps<"button">) {
	return (
		<button
			className={cn("ui-group-block-link", className)}
			type={type}
			{...props}
		/>
	);
}
