"use client";

import {
	AlertTriangle,
	CheckCircle,
	ChevronRight,
	Info,
	type LucideIcon,
	X,
	XCircle,
} from "lucide-react";
import { type HTMLAttributes, type ReactNode, useState } from "react";
import { Icon, type IconProps } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 提示条，样式在 alert.css。图标用语气色，标题是正文色，说明是次要色。
 *
 * - `variant`：filled 是语气色的浅底加一圈同色细边（默认），outlined 是透明底加一圈
 *   次级边，borderless 没有底和边，贴着别的内容排。
 * - 关闭：`closable` 时提示条按下关闭钮就自己收起，并调 `onClose`；只给 `onClose`
 *   时也有关闭钮，提示条由调用处移除。关闭钮的 aria-label 是「关闭提示」。
 * - `extra` 是收着的详情：提示条下面一行「显示详情」，按下展开，前面的箭头转 90°。
 *   有 `extra` 时提示条和详情合成一块面，底和边画在外层。`extraDefaultExpand`
 *   让它一开始就展开，`extraLabel` 换掉「显示详情」这几个字。
 */

type AlertType = "success" | "info" | "warning" | "error" | "secondary";
type AlertVariant = "filled" | "outlined" | "borderless";

interface AlertOwnProps {
	/** 放在文字之后的动作。 */
	action?: ReactNode;
	/** 有关闭钮，按下后提示条自己收起。 */
	closable?: boolean;
	/** 标题下面的说明。 */
	description?: ReactNode;
	/** 收着的详情，按「显示详情」展开。 */
	extra?: ReactNode;
	/** 详情一开始就展开。 */
	extraDefaultExpand?: boolean;
	/** 展开详情那一行的字，默认「显示详情」。 */
	extraLabel?: ReactNode;
	/** 换掉语气对应的图标。 */
	icon?: IconProps["icon"];
	/** 按下关闭钮时调用；只给它不给 `closable` 时，提示条由调用处移除。 */
	onClose?: () => void;
	/** 标题前的图标，默认有。 */
	showIcon?: boolean;
	/** 主要的那句话。 */
	title: ReactNode;
	type?: AlertType;
	variant?: AlertVariant;
}

type AlertProps = AlertOwnProps &
	Omit<HTMLAttributes<HTMLDivElement>, keyof AlertOwnProps | "children">;

const TYPE_ICONS = {
	error: XCircle,
	info: Info,
	secondary: AlertTriangle,
	success: CheckCircle,
	warning: AlertTriangle,
} satisfies Record<AlertType, LucideIcon>;

export function Alert({
	action,
	className,
	closable = false,
	description,
	extra,
	extraDefaultExpand = false,
	extraLabel = "显示详情",
	icon,
	onClose,
	role = "alert",
	showIcon = true,
	title,
	type = "info",
	variant = "filled",
	...rest
}: AlertProps) {
	const [closed, setClosed] = useState(false);
	const [expanded, setExpanded] = useState(extraDefaultExpand);
	if (closed) return null;

	const hasDescription = description !== undefined && description !== null;
	const hasExtra = extra !== undefined && extra !== null && extra !== false;
	const tone = `ui-alert-tone-${type}`;

	const root = (
		<div
			{...(hasExtra ? {} : rest)}
			className={cn(
				!hasExtra && tone,
				"ui-alert",
				`ui-alert-${variant}`,
				hasDescription ? "ui-alert-detailed" : "ui-alert-centered",
				hasExtra && "ui-alert-unified",
				!hasExtra && className,
			)}
			role={role}
		>
			{showIcon && (
				<span aria-hidden="true" className="ui-alert-icon">
					<Icon
						icon={icon ?? TYPE_ICONS[type]}
						size={hasDescription ? 18 : 16}
					/>
				</span>
			)}
			<div className="ui-alert-content">
				<div className="ui-alert-title">{title}</div>
				{hasDescription && (
					<div className="ui-alert-description">{description}</div>
				)}
			</div>
			{action && <div className="ui-alert-action">{action}</div>}
			{(closable || onClose) && (
				<button
					aria-label="关闭提示"
					className="ui-alert-close"
					onClick={() => {
						onClose?.();
						if (closable) setClosed(true);
					}}
					type="button"
				>
					<X size={14} />
				</button>
			)}
		</div>
	);

	if (!hasExtra) return root;

	return (
		<div
			{...rest}
			className={cn(
				tone,
				"ui-alert-container",
				`ui-alert-container-${variant}`,
				className,
			)}
		>
			{root}
			<details
				className={cn("ui-alert-extra", `ui-alert-extra-${variant}`)}
				onToggle={(event) => setExpanded(event.currentTarget.open)}
				open={expanded}
			>
				<summary className="ui-alert-extra-header">
					<ChevronRight
						aria-hidden="true"
						className="ui-alert-extra-indicator"
						size={14}
					/>
					<span>{extraLabel}</span>
				</summary>
				<div className="ui-alert-extra-content">{extra}</div>
			</details>
		</div>
	);
}
