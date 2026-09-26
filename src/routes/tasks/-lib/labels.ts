import type { TaskKind } from "#/db/schema";
import { dots } from "#/lib/format";
import type { StatusTone } from "#/routes/-components/status-badge";
import type { CorpusCounts, TaskRunView } from "#/server/tasks";

/** 三种任务在管理页上的名字。 */
export const TASK_NAME: Record<TaskKind, string> = {
	sync: "同步",
	derive: "解析",
	review: "整理",
};

/** 一次任务运行的结果：徽章上的字和它的状态。 */
export const RUN_STATUS: Record<
	TaskRunView["outcome"],
	{ label: string; tone: StatusTone }
> = {
	running: { label: "正在运行", tone: "running" },
	interrupted: { label: "中断", tone: "waiting" },
	failed: { label: "失败", tone: "error" },
	done: { label: "成功", tone: "success" },
};

/** 每类任务的卡片上说库里此刻有什么：同步说构成，解析说还剩多少，整理说归并与释义。 */
export const LANE_FACTS: Record<TaskKind, (corpus: CorpusCounts) => string> = {
	derive: (corpus) =>
		corpus.pending > 0
			? `还有 ${corpus.pending} 条经历待处理`
			: "经历已全部处理",
	review: (corpus) =>
		dots(
			`技能 ${corpus.words} 个，已归并 ${corpus.merged} 种写法`,
			`释义 ${corpus.glossed}/${corpus.glossable} 条`,
		),
	sync: (corpus) =>
		dots(
			`${corpus.employees} 人`,
			`${corpus.segments} 条经历（公司内 ${corpus.internal}、入职前 ${corpus.external}）`,
		),
};
