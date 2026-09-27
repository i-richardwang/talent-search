import { useState } from "react";
import { Block } from "#/components/ui/block";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import {
	StatusBadge,
	StatusIcon,
	type StatusTone,
} from "#/routes/-components/status-badge";
import { TaskCard } from "#/routes/tasks/-components/task-card";
import { RUN_STATUS } from "#/routes/tasks/-lib/labels";
import type { TaskLane } from "#/server/tasks";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import { CORPUS_COUNTS, TASK_LANES } from "../../samples/admin";

/** 五种状态各是什么意思；字取任务台的说法（`RUN_STATUS`），待处理是数据页的。 */
const TONES: [tone: StatusTone, meaning: string][] = [
	["success", "运行完成"],
	["running", "此刻有任务拿着锁在跑"],
	["interrupted", "没跑完、也没人在跑"],
	["error", "运行出错，错误写在下面"],
	["pending", "数据页：这一段还没有解析到当前版本"],
];

const labelOf = (tone: StatusTone) =>
	Object.values(RUN_STATUS).find((status) => status.tone === tone)?.label ??
	"待处理";

function Playground() {
	const [tone, setTone] = useState<StatusTone>("running");
	const [label, setLabel] = useState("正在运行");
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control className="grow" htmlFor="status-label" label="状态文字">
					<Input
						id="status-label"
						onChange={(event) => setLabel(event.target.value)}
						value={label}
						variant="filled"
					/>
				</Control>
				<Control label="状态">
					<Segmented<StatusTone>
						onChange={setTone}
						options={TONES.map(([value]) => ({ label: labelOf(value), value }))}
						value={tone}
					/>
				</Control>
			</Controls>
			<Stage>
				<div className="flex flex-col items-center gap-4">
					<StatusBadge tone={tone}>{label}</StatusBadge>
					<span className="inline-flex items-center gap-2 font-medium">
						<StatusIcon tone={tone} />
						{label}
					</span>
				</div>
			</Stage>
		</div>
	);
}

function Tones() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>状态</TableHead>
						<TableHead>表格里</TableHead>
						<TableHead>运行记录里</TableHead>
						<TableHead>什么时候出现</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{TONES.map(([tone, meaning]) => (
						<TableRow key={tone}>
							<TableCell className="font-mono text-xs">{tone}</TableCell>
							<TableCell>
								<StatusBadge tone={tone}>{labelOf(tone)}</StatusBadge>
							</TableCell>
							<TableCell>
								<span className="inline-flex items-center gap-2">
									<StatusIcon tone={tone} />
									{labelOf(tone)}
								</span>
							</TableCell>
							<TableCell className="text-fg-secondary text-xs">
								{meaning}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

/** 任务台上的一栏：产品的任务卡片，喂样例的运行记录。 */
function Lane({ kind }: { kind: TaskLane["kind"] }) {
	const lane = TASK_LANES.find((item) => item.kind === kind);
	if (!lane) return null;
	return (
		<Routed url="/tasks">
			<ul className="w-full list-none">
				<TaskCard
					busy={false}
					corpus={CORPUS_COUNTS}
					judge="model"
					lane={lane}
					onDone={() => {}}
				/>
			</ul>
		</Routed>
	);
}

function Usage() {
	return (
		<ExampleGrid>
			<Example
				description="组头说最近一次的结果；失败时白面里先是一条提示，原始错误收在详情里；每次运行一行，开头是状态图标。"
				title="上一次失败的任务"
			>
				<Lane kind="review" />
			</Example>
			<Example
				description="成功也在组头说一句，带绿色的对勾；中断那次是 amber 的感叹号。"
				title="正常的任务"
			>
				<Lane kind="sync" />
			</Example>
		</ExampleGrid>
	);
}

/** 运行状态：表格里的点加字，运行记录里的圈形图标。 */
export function StatusBadgePage() {
	return (
		<DocPage
			facts={[`${TONES.length} 种状态`]}
			rules={{
				notes: [
					"一种状态一个颜色：成功绿、正在运行 amber 转圈、中断 amber 感叹号、失败红、待处理四级灰。",
					"表格和一段经历的角上用点加 12px 的次要色字，不套标签的底；正在运行时点换成 10px 的转圈。",
					"任务台每次运行那一行用 16px 的圈形图标，旁边是那一行的标题。",
					"点不单独出现，总跟着一个说结论的字；数据页上已处理是常态，不标。",
				],
				usage: `<StatusBadge tone="error">失败</StatusBadge>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用运行状态" },
				{ children: <Tones />, id: "appearance", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
