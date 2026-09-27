import type { ReactNode } from "react";
import { cn } from "#/lib/utils";
import { Block } from "./block";
import { Flexbox, type FlexboxProps } from "./flex";
import { Icon, type IconProps } from "./icon";

/*
 * 空态：居中的一列，样式在 empty.css。两档尺寸：
 *
 * - `middle`（缺省）放在一块面里（表格、抽屉、弹层）：间距 8、四周 16；给了 `icon`
 *   就放进一块 48px 见方的描边面（图标边长 32），没给放默认图；标题 16px 粗体、
 *   说明 14px 三级灰，标题与说明间隔 1px。
 * - `large` 占满一整栏（名单那一栏为空、页面找不到）：间距 16、上下 64；图标 48px、
 *   不加框、四级灰；标题 16px 半粗、说明 13px 次要色，标题与说明间隔 4px。
 *
 * 动作在最下面，几个动作间隔 4px。
 *
 * 标题与说明各是一个 div，基础字色 `--color-fg`；`titleProps.as` 为 `h1` 时标题换成
 * `<h1>`，字号与字重不变。默认图的 `<title>` 是「暂无数据」。
 */

interface EmptyProps extends Omit<FlexboxProps, "title"> {
	action?: ReactNode;
	description?: ReactNode;
	icon?: IconProps["icon"];
	/** @default "middle" */
	size?: "middle" | "large";
	title?: ReactNode;
	titleProps?: { as: "h1" };
}

/** 默认图：地上一块空卡片，卡片里三道占位条。颜色在 empty.css。 */
function EmptyImage() {
	return (
		<svg
			className="ui-empty-image"
			height="41"
			viewBox="0 0 64 41"
			width="64"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>暂无数据</title>
			<ellipse
				className="ui-empty-image-shadow"
				cx="32"
				cy="35"
				rx="26"
				ry="5"
			/>
			<rect
				className="ui-empty-image-card"
				height="30"
				rx="4"
				width="36"
				x="14"
				y="2.5"
			/>
			<rect
				className="ui-empty-image-line"
				height="3"
				rx="1.5"
				width="22"
				x="21"
				y="10"
			/>
			<rect
				className="ui-empty-image-line"
				height="3"
				rx="1.5"
				width="22"
				x="21"
				y="16"
			/>
			<rect
				className="ui-empty-image-line"
				height="3"
				rx="1.5"
				width="13"
				x="21"
				y="22"
			/>
		</svg>
	);
}

export function Empty({
	title,
	description,
	icon,
	action,
	titleProps,
	size = "middle",
	className,
	...rest
}: EmptyProps) {
	const Title = titleProps?.as ?? "div";
	const large = size === "large";
	return (
		<Flexbox
			align="center"
			className={cn(large && "ui-empty-large", className)}
			gap={large ? 16 : 8}
			padding={large ? undefined : 16}
			paddingBlock={large ? 64 : undefined}
			{...rest}
		>
			{icon && large ? (
				<Icon className="ui-empty-icon-bare" icon={icon} size={48} />
			) : icon ? (
				<Block
					align="center"
					flex="none"
					height={48}
					justify="center"
					style={{ marginBottom: 4 }}
					variant="outlined"
					width={48}
				>
					<Icon className="ui-empty-icon" icon={icon} size={32} />
				</Block>
			) : (
				<EmptyImage />
			)}
			<Flexbox align="center" gap={large ? 4 : 1}>
				{title && <Title className="ui-empty-title">{title}</Title>}
				{description && (
					<div className="ui-empty-description">{description}</div>
				)}
			</Flexbox>
			{action && <Flexbox gap={4}>{action}</Flexbox>}
		</Flexbox>
	);
}
