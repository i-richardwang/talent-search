import type { ReactNode } from "react";
import { Badge } from "#/components/ui/badge";
import { cn } from "#/lib/utils";

/**
 * 管理页上的状态徽章：一枚点加一个词。
 *
 * 形状照 coss 自己给状态列排的那一种（`Badge variant="outline"` 加一枚
 * `size-1.5` 的圆点），不是四种填色徽章。两个理由：
 *
 * 1. **填色的绿 / 蓝 / amber 在这个产品里各有主人**（AGENTS.md 的色相一节：
 *    绿是受控字段命中、蓝是选中、amber 是要留意的状态）。运行状态是另一件事，
 *    借它们的填色就是给同一块颜色发第二个含义。点小得多，读起来是「状态灯」，
 *    不会和检索那三件事撞。
 * 2. 一页上同时有四种状态（成功、正在跑、中断、失败），四块填色是四个抢眼的
 *    色块；而这一页的主角是日志，不是徽章。
 *
 * 两个读者：任务台的每一栏（一次运行的结果）和数据页的每一段（派生到当前
 * 版本没有）。各画各的话，第三个用到状态的地方就会长出第三种点。
 */
export type StatusTone = "success" | "running" | "waiting" | "error";

/** 点的颜色。语义令牌，不挑具体色号——深浅两套由令牌层管。 */
const DOT: Record<StatusTone, string> = {
	error: "bg-destructive",
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
		<Badge variant="outline">
			<StatusDot tone={tone} />
			{children}
		</Badge>
	);
}

/** 徽章左边那枚点。它不单独出现——只有点没有字的话，人得先学会哪种颜色是哪件事。 */
function StatusDot({ tone }: { tone: StatusTone }) {
	return (
		<span
			aria-hidden="true"
			className={cn("size-1.5 shrink-0 rounded-full", DOT[tone])}
		/>
	);
}
