import { type ReactNode, useState } from "react";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { Thread } from "#/routes/s/$turnId/-components/thread";
import { FAULT_COPY } from "#/routes/s/$turnId/-lib/interpret";
import { inSentence } from "#/search/condition-label";
import type { TraceStep } from "#/search/trace";
import type { InterpretFault, Turn } from "#/server/turn";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import {
	FRESH_TURN,
	LATEST_TURN_ID,
	PENDING_TRACE,
	PENDING_TURN,
	ROOT_TURN_ID,
	THREAD,
} from "../../samples/thread";

type State = "settled" | "earlier" | "running" | "failed";

/** 线程在每种状态下的几样输入。 */
const STATES: Record<
	State,
	{
		rounds: Turn[];
		viewing: string;
		liveTrace: TraceStep[] | null;
		fault: InterpretFault | null;
	}
> = {
	earlier: {
		fault: null,
		liveTrace: null,
		rounds: THREAD,
		viewing: ROOT_TURN_ID,
	},
	failed: {
		fault: "unreachable",
		liveTrace: [],
		rounds: [...THREAD, PENDING_TURN],
		viewing: PENDING_TURN.id,
	},
	running: {
		fault: null,
		liveTrace: PENDING_TRACE,
		rounds: [...THREAD, PENDING_TURN],
		viewing: PENDING_TURN.id,
	},
	settled: {
		fault: null,
		liveTrace: null,
		rounds: THREAD,
		viewing: LATEST_TURN_ID,
	},
};

const FAULTS: InterpretFault[] = [
	"unconfigured",
	"unreachable",
	"rejected",
	"unanswered",
	"broken",
];

/** 一条线程放在一块描边的面里，站在记录链的地址上，链接画得出来。 */
function Column({ children }: { children: ReactNode }) {
	return (
		<Routed url={`/s/${LATEST_TURN_ID}`}>
			<Block
				className="overflow-hidden"
				gap={0}
				variant="outlined"
				width="100%"
			>
				{children}
			</Block>
		</Routed>
	);
}

function Playground() {
	const [state, setState] = useState<State>("settled");
	const [understanding, setUnderstanding] = useState(true);
	const [last, setLast] = useState<string | null>(null);
	const props = STATES[state];
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="最后一次需求">
					<Segmented<State>
						onChange={setState}
						options={[
							{ label: "已理解", value: "settled" },
							{ label: "看较早的结果", value: "earlier" },
							{ label: "理解中", value: "running" },
							{ label: "理解失败", value: "failed" },
						]}
						value={state}
					/>
				</Control>
				<Control>
					<Checkbox checked={understanding} onChange={setUnderstanding}>
						开启 AI 搜索
					</Checkbox>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-0"
				footer={<span>{last ?? "在输入框里补充一句需求，或点「添加」"}</span>}
			>
				<div className="mx-auto h-160 w-full max-w-(--container-detail-wide)">
					<Routed url={`/s/${LATEST_TURN_ID}`}>
						<Thread
							{...props}
							key={state}
							onAdd={(conditions) =>
								setLast(`添加了 ${inSentence(conditions)}`)
							}
							onQuery={(input) => {
								setLast(
									input.kind === "sentence"
										? `提交了「${input.text}」`
										: "提交了一组搜索条件",
								);
								return true;
							}}
							understanding={understanding}
							waiting={state === "running"}
						/>
					</Routed>
				</div>
			</Stage>
		</div>
	);
}

function Faults() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>哪一环</TableHead>
						<TableHead>线程里记的一行</TableHead>
						<TableHead>名单那一列的出路</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{FAULTS.map((fault) => (
						<TableRow key={fault}>
							<TableCell className="font-mono text-xs">{fault}</TableCell>
							<TableCell className="min-w-72">
								<Column>
									<Thread
										fault={fault}
										liveTrace={[]}
										onAdd={() => {}}
										onQuery={() => true}
										rounds={[FRESH_TURN]}
										understanding={false}
										viewing={FRESH_TURN.id}
										waiting={false}
									/>
								</Column>
							</TableCell>
							<TableCell className="text-fg-secondary text-xs">
								{[
									FAULT_COPY[fault].retry && "重试",
									FAULT_COPY[fault].keyword && "改用关键词搜索",
								]
									.filter(Boolean)
									.join("、") || "无"}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</Block>
	);
}

function Usage() {
	const noop = () => {};
	return (
		<ExampleGrid>
			<Example
				description="搜不了的要求用 amber 记在回应里；附带的替代条件停在输入框上方，点「添加」记成新的一次修改。"
				title="搜不了的要求"
			>
				<Column>
					<Thread
						onAdd={noop}
						onQuery={() => true}
						rounds={THREAD.slice(0, 2)}
						understanding
						viewing={THREAD[1]?.id ?? ""}
						waiting={false}
					/>
				</Column>
			</Example>
			<Example
				description="刚提交的第一句需求：还没有步骤时只有一行流光的「正在理解你的需求…」。"
				title="刚提交"
			>
				<Column>
					<Thread
						liveTrace={[]}
						onAdd={noop}
						onQuery={() => true}
						rounds={[FRESH_TURN]}
						understanding
						viewing={FRESH_TURN.id}
						waiting
					/>
				</Column>
			</Example>
			<Example
				description="在条件上直接改的一次没有人说话，线程中间只记一行改了什么；早先几次底下是查看结果的链接。"
				title="直接改条件"
			>
				<Column>
					<Thread
						onAdd={noop}
						onQuery={() => true}
						rounds={THREAD}
						understanding={false}
						viewing={LATEST_TURN_ID}
						waiting={false}
					/>
				</Column>
			</Example>
			<Example
				description="没开启 AI 搜索时线程只能看，没有输入框；条件在名单上方的条件上改。"
				title="只读的线程"
			>
				<Column>
					<Thread
						onAdd={noop}
						onQuery={() => true}
						rounds={THREAD.slice(0, 1)}
						understanding={false}
						viewing={ROOT_TURN_ID}
						waiting={false}
					/>
				</Column>
			</Example>
		</ExampleGrid>
	);
}

/** 对话线程：一次找人任务从第一句到最后一句，底下是补充需求的输入框。 */
export function ThreadPage() {
	return (
		<DocPage
			facts={[
				`${Object.keys(STATES).length} 种末尾状态`,
				`${FAULTS.length} 种出错`,
				"替代条件托盘",
			]}
			rules={{
				notes: [
					"线程总是整条链；查看早先一次的结果只换名单，不截断线程，正在看的那一次标「正在查看」。",
					"每次的回应按前后两组条件的差别说加了什么、去掉了什么，条件写进句子用 inSentence。",
					"理解失败时说哪一环坏了：连不上和报错时需求没被读过，不能说成没读懂；等待和重试的动作在名单那一列。",
					"替代条件的「添加」跟着正在看的那一次，放在输入框上方。",
					"AI 查过的结论收成一行「检索过程」，只交出数，不交出任何一个人。",
				],
				usage: `<Thread\n  onAdd={addConditions}\n  onQuery={submit}\n  rounds={thread}\n  understanding\n  viewing={turnId}\n  waiting={interpreting}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用线程" },
				{ children: <Faults />, id: "appearance", title: "理解失败" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
