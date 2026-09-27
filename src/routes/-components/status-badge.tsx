import {
	CircleAlertIcon,
	CircleCheckIcon,
	CircleDashedIcon,
	CircleXIcon,
	type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 管理页上的运行状态。一种状态一个颜色，任务台和数据页读同一张表（`STATUS`）：
 * 成功是绿，正在运行是 amber 的转圈，中断是 amber 的感叹号，失败是红，待处理是四级灰。
 *
 * 两种画法：表格和一段经历的角上是 `StatusBadge`（6px 的点加 12px 的次要色字，正在运行
 * 时点换成 10px 的转圈）；任务台上一次运行那一行是 `StatusIcon`（16px 的圈形图标）。
 * 点不单独出现，总跟着一个说结论的字；图标旁边总有那一行的标题。
 */
export type StatusTone =
	| "success"
	| "running"
	| "interrupted"
	| "error"
	| "pending";

const STATUS: Record<
	Exclude<StatusTone, "running">,
	{ color: string; dot: string; icon: LucideIcon }
> = {
	error: { color: "text-error", dot: "bg-error", icon: CircleXIcon },
	interrupted: {
		color: "text-warning",
		dot: "bg-warning",
		icon: CircleAlertIcon,
	},
	pending: {
		color: "text-fg-quaternary",
		dot: "bg-fg-quaternary",
		icon: CircleDashedIcon,
	},
	success: { color: "text-success", dot: "bg-success", icon: CircleCheckIcon },
};

/** 正在运行：一圈淡环上转着一段实弧，中间一个实心点。颜色跟着 `currentColor`。 */
function RunningRing({ size }: { size: number }) {
	const ring = "color-mix(in srgb, currentColor 35%, transparent)";
	return (
		<svg
			aria-hidden="true"
			className="shrink-0 text-warning"
			fill="none"
			height={size}
			viewBox="0 0 16 16"
			width={size}
		>
			<circle cx="8" cy="8" r="6.5" stroke={ring} strokeWidth="1.5" />
			<path
				className="origin-center motion-safe:animate-spin"
				d="M14.5 8 A 6.5 6.5 0 0 1 8 14.5"
				stroke="currentColor"
				strokeLinecap="round"
				strokeWidth="1.5"
			/>
			<circle cx="8" cy="8" fill="currentColor" r="2.5" />
		</svg>
	);
}

/** 表格里、一段经历角上的状态：点（或转圈）加一个词。 */
export function StatusBadge({
	tone,
	children,
}: {
	tone: StatusTone;
	children: ReactNode;
}) {
	return (
		<span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-fg-secondary text-xs">
			{tone === "running" ? (
				<RunningRing size={10} />
			) : (
				<span
					aria-hidden="true"
					className={cn("size-1.5 shrink-0 rounded-full", STATUS[tone].dot)}
				/>
			)}
			{children}
		</span>
	);
}

/** 一次运行那一行开头的图标，默认 16px；组头说明那一行里用 14px。 */
export function StatusIcon({
	tone,
	size = 16,
}: {
	tone: StatusTone;
	size?: 14 | 16;
}) {
	if (tone === "running") return <RunningRing size={size} />;
	return (
		<Icon
			aria-hidden
			className={cn("shrink-0", STATUS[tone].color)}
			icon={STATUS[tone].icon}
			size={size}
		/>
	);
}
