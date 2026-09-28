import type { ReactNode } from "react";
import { Block } from "./block";
import { Flexbox } from "./flex";
import { Icon, type IconProps } from "./icon";

/*
 * 空态：居中的一列。`middle`（缺省）放在一块面里（表格、抽屉、弹层），`large` 占满一整栏
 * （名单那一栏为空、页面找不到）。没给 `icon` 时放默认图。
 */

interface EmptyProps {
	action?: ReactNode;
	description?: ReactNode;
	icon?: IconProps["icon"];
	size?: "middle" | "large";
	title?: ReactNode;
}

/** 默认图：地上一块空卡片，卡片里三道占位条。 */
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
	size = "middle",
}: EmptyProps) {
	const large = size === "large";
	return (
		<Flexbox
			align="center"
			className={large ? "ui-empty-large" : undefined}
			gap={large ? 16 : 8}
			padding={large ? undefined : 16}
			paddingBlock={large ? 64 : undefined}
		>
			{icon && large ? (
				<Icon className="ui-empty-icon-bare" icon={icon} size={48} />
			) : icon ? (
				<Block
					align="center"
					className="ui-empty-icon-box"
					justify="center"
					variant="outlined"
				>
					<Icon className="ui-empty-icon" icon={icon} size={32} />
				</Block>
			) : (
				<EmptyImage />
			)}
			<Flexbox align="center" gap={large ? 4 : 1}>
				{title && <div className="ui-empty-title">{title}</div>}
				{description && (
					<div className="ui-empty-description">{description}</div>
				)}
			</Flexbox>
			{action && <Flexbox gap={4}>{action}</Flexbox>}
		</Flexbox>
	);
}
