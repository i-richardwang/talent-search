"use client";

import {
	CheckCircle,
	Info,
	type LucideIcon,
	TriangleAlert,
	X,
	XCircle,
} from "lucide-react";
import type { AriaRole, ReactNode } from "react";
import { Icon, type IconProps } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/* 提示条。给 `onClose` 时有关闭钮，由调用处移除。 */

type AlertType = "success" | "info" | "warning" | "error" | "secondary";
type AlertVariant = "filled" | "outlined";

interface AlertProps {
	/** 放在文字之后。 */
	action?: ReactNode;
	/** 换掉语气对应的图标。 */
	icon?: IconProps["icon"];
	onClose?: () => void;
	role?: AriaRole;
	title: ReactNode;
	type?: AlertType;
	variant?: AlertVariant;
}

const TYPE_ICONS = {
	error: XCircle,
	info: Info,
	secondary: TriangleAlert,
	success: CheckCircle,
	warning: TriangleAlert,
} satisfies Record<AlertType, LucideIcon>;

export function Alert({
	action,
	icon,
	onClose,
	role = "alert",
	title,
	type = "info",
	variant = "filled",
}: AlertProps) {
	return (
		<div
			className={cn(`ui-alert-tone-${type}`, "ui-alert", `ui-alert-${variant}`)}
			role={role}
		>
			<span aria-hidden="true" className="ui-alert-icon">
				<Icon icon={icon ?? TYPE_ICONS[type]} size={16} />
			</span>
			<div className="ui-alert-title">{title}</div>
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
