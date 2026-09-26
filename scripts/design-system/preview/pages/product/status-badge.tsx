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

/** 四种状态各是什么意思；徽章上的字取任务台的说法（`RUN_STATUS`）。 */
const TONES: [tone: StatusTone, meaning: string][] = [
	["success", "上一次运行完成"],
	["running", "此刻有任务拿着锁在跑"],
	["waiting", "没跑完、也没人在跑；数据页上是「待处理」"],
	["error", "运行出错，错误写在旁边"],
];

const labelOf = (tone: StatusTone) =>
	Object.values(RUN_STATUS).find((status) => status.tone === tone)?.label ??
	tone;

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
				<StatusBadge tone={tone}>{label}</StatusBadge>
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
						<TableHead>徽章</TableHead>
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
			<ul className="w-full">
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
				description="卡片正面只在不正常时挂徽章，失败时下面接一条错误；运行记录每一行都有结果。"
				title="上一次失败的任务"
			>
				<Lane kind="review" />
			</Example>
			<Example
				description="成功是常态：卡片正面不挂徽章，只说上次什么时候跑的；运行记录里照常写结果。"
				title="正常的任务"
			>
				<Lane kind="sync" />
			</Example>
		</ExampleGrid>
	);
}

/** 状态徽章：管理页上一枚描边标签加一个状态点。 */
export function StatusBadgePage() {
	return (
		<DocPage
			facts={[`${TONES.length} 种状态`]}
			rules={{
				notes: [
					"管理页使用共用的状态徽章；常态（成功、已处理）不重复提示。",
					"形状是描边标签加一个小点，不用四种填色标签：填色的绿和 amber 在检索那一侧各有含义。",
					"点不单独出现，总跟着一个说结论的字。",
					"读者是管理员：任务台的每一栏、数据页的每一段共用这一枚。",
				],
				usage: `<StatusBadge tone="error">失败</StatusBadge>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用状态徽章" },
				{ children: <Tones />, id: "appearance", title: "状态" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
