import type { Judge } from "#/corpus/judgment";
import type { CorpusCounts, TaskLane } from "#/server/tasks";
import { TaskCard } from "./task-card";

/**
 * 任务页的正文：每类任务一张卡，从上往下排。`busy` 是此刻有没有任务在跑，
 * `onDone` 在某张卡请求运行之后调用，让页面重新取一次状态。
 */
export function TaskBoard({
	lanes,
	corpus,
	judge,
	busy,
	onDone,
}: {
	lanes: TaskLane[];
	corpus: CorpusCounts;
	judge: Judge;
	busy: boolean;
	onDone: () => void;
}) {
	return (
		<ul className="flex flex-col gap-6">
			{lanes.map((lane) => (
				<TaskCard
					busy={busy}
					corpus={corpus}
					judge={judge}
					key={lane.kind}
					lane={lane}
					onDone={onDone}
				/>
			))}
		</ul>
	);
}
