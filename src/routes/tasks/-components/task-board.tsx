import type { Judge } from "#/corpus/judgment";
import type { TaskLane } from "#/server/tasks";
import { TaskCard } from "./task-card";

/**
 * 任务页的正文：每类任务一组，组距与管理页外壳的块距相同。`busy` 是此刻有没有任务
 * 在跑，`onDone` 在某张卡请求运行之后调用，让页面重新取一次状态。
 */
export function TaskBoard({
	lanes,
	judge,
	busy,
	onDone,
}: {
	lanes: TaskLane[];
	judge: Judge;
	busy: boolean;
	onDone: () => void | Promise<void>;
}) {
	return (
		<ul className="flex flex-col gap-9">
			{lanes.map((lane) => (
				<TaskCard
					busy={busy}
					judge={judge}
					key={lane.kind}
					lane={lane}
					onDone={onDone}
				/>
			))}
		</ul>
	);
}
