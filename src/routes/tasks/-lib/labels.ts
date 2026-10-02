import type { TaskKind } from "#/lib/task";
import type { StatusTone } from "#/routes/-components/status-badge";
import type { CorpusCounts, TaskRunView } from "#/server/tasks";

/** 三种任务在管理页上的名字。 */
export const TASK_NAME: Record<TaskKind, string> = {
	sync: "同步",
	derive: "解析",
	review: "整理",
};

/** 一次任务运行的结果：那一行的标题和它的状态。 */
export const RUN_STATUS: Record<
	TaskRunView["outcome"],
	{ label: string; tone: StatusTone }
> = {
	running: { label: "正在运行", tone: "running" },
	interrupted: { label: "中断", tone: "interrupted" },
	failed: { label: "失败", tone: "error" },
	done: { label: "成功", tone: "success" },
};

/**
 * 一格统计数：名字、数，数下面可选一行构成。构成的每一项数在前、说它是什么在后
 * （`21,267 公司内`）。
 */
type LaneFact = {
	label: string;
	value: number;
	parts?: { value: number; label: string }[];
};

/** 每类任务说库里此刻有什么：同步说构成，解析说还剩多少，整理说归并与释义。 */
export const LANE_FACTS: Record<
	TaskKind,
	(corpus: CorpusCounts) => LaneFact[]
> = {
	derive: (corpus) => [
		{
			label: "待处理经历",
			parts: [{ label: "条经历", value: corpus.segments }],
			value: corpus.pending,
		},
		{ label: "说法", value: corpus.phrases },
	],
	review: (corpus) => [
		{ label: "技能", value: corpus.words },
		{ label: "已归并写法", value: corpus.merged },
		{
			label: "释义",
			parts: [{ label: "条该写", value: corpus.glossable }],
			value: corpus.glossed,
		},
	],
	sync: (corpus) => [
		{ label: "人", value: corpus.employees },
		{
			label: "经历",
			parts: [
				{ label: "公司内", value: corpus.internal },
				{ label: "入职前", value: corpus.external },
			],
			value: corpus.segments,
		},
	],
};

/** 用时写成 `42s`、`3m 7s`、`1h 23m`、`1d 2h 5m`：一小时以内到秒，以上到分。 */
export function formatDuration(seconds: number): string {
	const units: [suffix: string, size: number][] = [
		["d", 86_400],
		["h", 3_600],
		["m", 60],
		["s", 1],
	];
	const last = seconds < 3_600 ? "s" : "m";
	const lastIndex = units.findIndex(([suffix]) => suffix === last);
	const first = units.findIndex(([, size]) => seconds >= size);
	const from = first === -1 ? lastIndex : Math.min(first, lastIndex);
	let rest = Math.max(0, seconds);
	return units
		.slice(from, lastIndex + 1)
		.map(([suffix, size]) => {
			const value = Math.floor(rest / size);
			rest -= value * size;
			return `${value}${suffix}`;
		})
		.join(" ");
}
