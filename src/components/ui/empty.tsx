import type { ReactNode } from "react";
import { Block } from "./block";
import { Flexbox, type FlexboxProps } from "./flex";
import { Icon, type IconProps } from "./icon";

/*
 * 空态：居中的一列，间距 8、四周 16。上面是图：给了 `icon` 就放进一块 48px 见方的
 * 描边面（图标边长 32），没给放默认图。下面标题 16px 粗体、说明 14px 三级灰，
 * 动作在最下面。样式在 empty.css。
 *
 * 标题与说明各是一个 div，基础字色 `--color-fg`；`titleProps.as` 为 `h1` 时标题换成
 * `<h1>`，字号与字重不变。默认图的 `<title>` 是「暂无数据」。
 */

interface EmptyProps extends Omit<FlexboxProps, "title"> {
	action?: ReactNode;
	description?: ReactNode;
	icon?: IconProps["icon"];
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
	...rest
}: EmptyProps) {
	const Title = titleProps?.as ?? "div";
	return (
		<Flexbox align="center" gap={8} padding={16} {...rest}>
			{icon ? (
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
			<Flexbox align="center" gap={1}>
				{title && <Title className="ui-empty-title">{title}</Title>}
				{description && (
					<div className="ui-empty-description">{description}</div>
				)}
			</Flexbox>
			{action && <Flexbox gap={4}>{action}</Flexbox>}
		</Flexbox>
	);
}
