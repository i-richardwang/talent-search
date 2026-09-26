"use client";

import {
	AlertTriangle,
	CheckCircle,
	Info,
	type LucideIcon,
	X,
	XCircle,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconProps } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 提示条，样式在 alert.css：语气色的浅底加一圈同色细边，图标用语气色，文字是正文色。
 * 给了 `onClose` 才有关闭按钮，aria-label 是「关闭提示」，提示条由调用处移除。
 */

type AlertType = "success" | "info" | "warning" | "error" | "secondary";

interface AlertOwnProps {
	/** 放在文字之后的动作。 */
	action?: ReactNode;
	/** 标题下面的说明。 */
	description?: ReactNode;
	/** 换掉语气对应的图标。 */
	icon?: IconProps["icon"];
	/** 按下关闭按钮时调用。 */
	onClose?: () => void;
	/** 主要的那句话。 */
	title: ReactNode;
	type?: AlertType;
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
	description,
	icon,
	onClose,
	role = "alert",
	title,
	type = "info",
	...rest
}: AlertProps) {
	const hasDescription = description !== undefined && description !== null;

	return (
		<div
			{...rest}
			className={cn(
				`ui-alert-tone-${type}`,
				"ui-alert",
				hasDescription ? "ui-alert-detailed" : "ui-alert-centered",
				className,
			)}
			role={role}
		>
			<span aria-hidden="true" className="ui-alert-icon">
				<Icon icon={icon ?? TYPE_ICONS[type]} size={hasDescription ? 18 : 16} />
			</span>
			<div className="ui-alert-content">
				<div className="ui-alert-title">{title}</div>
				{hasDescription && (
					<div className="ui-alert-description">{description}</div>
				)}
			</div>
			{action && <div className="ui-alert-action">{action}</div>}
			{onClose && (
				<button
					aria-label="关闭提示"
					className="ui-alert-close"
					onClick={onClose}
					type="button"
				>
					<X size={14} />
				</button>
			)}
		</div>
	);
}
