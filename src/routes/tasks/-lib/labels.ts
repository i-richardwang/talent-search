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

type Count = { value: number; label: string };

type LaneFacts = {
	progress?: { label: string; done: number; total: number };
	counts: (Count & { parts?: Count[] })[];
};

/** 每类任务在库里的现状。 */
export const LANE_FACTS: Record<TaskKind, (corpus: CorpusCounts) => LaneFacts> =
	{
		derive: (corpus) => ({
			counts: [
				{ label: "条说法", value: corpus.phrases },
				{ label: "段 AI 未能作答", value: corpus.unanswered },
			],
			progress: {
				done: corpus.derived,
				label: corpus.staging
					? "段已按新标准解析，解析完之前检索沿用上一版"
					: "段经历已解析",
				total: corpus.segments,
			},
		}),
		review: (corpus) => ({
			counts: [
				{ label: "个技能", value: corpus.words },
				{ label: "种写法已归并", value: corpus.merged },
			],
			progress: {
				done: corpus.glossed,
				label: "条说法已写释义",
				total: corpus.glossable,
			},
		}),
		sync: (corpus) => ({
			counts: [
				{ label: "人", value: corpus.employees },
				{
					label: "段经历",
					parts: [
						{ label: "公司内", value: corpus.internal },
						{ label: "入职前", value: corpus.external },
					],
					value: corpus.segments,
				},
			],
		}),
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
