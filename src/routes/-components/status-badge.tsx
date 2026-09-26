import type { ReactNode } from "react";
import { Tag } from "#/components/ui/tag";
import { cn } from "#/lib/utils";

/**
 * 管理页上的状态徽章：一枚描边标签（`Tag variant="outlined"`）里一个状态点加一个词。
 * 绿和 amber 的填色留给检索那一侧（受控字段命中、需要留意），运行状态只用点的颜色。
 *
 * 两个读者：任务页每类任务的运行结果，和数据页每一段经历有没有处理到当前版本。
 */
export type StatusTone = "success" | "running" | "waiting" | "error";

/** 点的颜色。语义令牌，深浅两套由令牌层管。 */
const STATUS_DOT: Record<StatusTone, string> = {
	error: "bg-error",
	running: "bg-info",
	success: "bg-success",
	waiting: "bg-warning",
};

export function StatusBadge({
	tone,
	children,
}: {
	tone: StatusTone;
	children: ReactNode;
}) {
	return (
		<Tag size="small" variant="outlined">
			{/* 点不单独出现：只有点没有字的话，人得先学会哪种颜色是哪件事。 */}
			<span
				aria-hidden="true"
				className={cn("size-1.5 shrink-0 rounded-full", STATUS_DOT[tone])}
			/>
			{children}
		</Tag>
	);
}
