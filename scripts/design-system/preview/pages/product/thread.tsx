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
import { ELAPSED_SHOW_AFTER_MS } from "#/routes/s/$turnId/-lib/elapsed";
import {
	FAULT_COPY,
	FAULT_EXIT_LABEL,
	faultExits,
} from "#/routes/s/$turnId/-lib/interpret";
import { inSentence } from "#/search/condition-label";
import type { InterpretFault, Progress, Turn } from "#/server/turn";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Example, ExampleGrid, Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import {
	ANSWERED_TURN,
	FRESH_TURN,
	LATEST_TURN_ID,
	PENDING_TRACE,
	PENDING_TURN,
	ROOT_TURN_ID,
	THREAD,
} from "../../samples/thread";

type State = "settled" | "asking" | "earlier" | "running" | "failed";

/** 线程在每种状态下的几样输入。 */
const STATES: Record<
	State,
	{
		rounds: Turn[];
		viewing: string;
		progress: Progress | null;
		fault: InterpretFault | null;
	}
> = {
	asking: {
		fault: null,
		progress: null,
		rounds: THREAD.slice(0, 2),
		viewing: THREAD[1]?.id ?? "",
	},
	earlier: {
		fault: null,
		progress: null,
		rounds: THREAD,
		viewing: ROOT_TURN_ID,
	},
	failed: {
		fault: "unreachable",
		progress: { trace: [], startedAt: PENDING_TURN.startedAt },
		rounds: [...THREAD, PENDING_TURN],
		viewing: PENDING_TURN.id,
	},
	running: {
		fault: null,
		progress: { trace: PENDING_TRACE, startedAt: PENDING_TURN.startedAt },
		rounds: [...THREAD, PENDING_TURN],
		viewing: PENDING_TURN.id,
	},
	settled: {
		fault: null,
		progress: null,
		rounds: THREAD,
		viewing: LATEST_TURN_ID,
	},
};

const FAULTS = Object.keys(FAULT_COPY) as InterpretFault[];

/** 一条线程放在一块描边的面里，内存 router 停在记录链的地址上，链接才渲染得出来。 */
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
							{ label: "AI 在问", value: "asking" },
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
				footer={
					<span>{last ?? "在输入框里补充一句需求，或选 AI 给的一项"}</span>
				}
			>
				<div className="mx-auto h-160 w-full max-w-(--container-detail-wide)">
					<Routed url={`/s/${LATEST_TURN_ID}`}>
						<Thread
							{...props}
							key={state}
							onRevise={(conditions) =>
								setLast(`换成了 ${inSentence(conditions)}`)
							}
							onQuery={(input) => {
								setLast(
									input.kind === "sentence"
										? `提交了「${input.text}」`
										: "提交了一组搜索条件",
								);
								return true;
							}}
							onRetry={() => setLast("重试了最后一次需求")}
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
						<TableHead>出错环节</TableHead>
						<TableHead>线程里的提示</TableHead>
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
										progress={{ trace: [], startedAt: FRESH_TURN.startedAt }}
										onQuery={() => true}
										onRetry={() => {}}
										onRevise={() => {}}
										rounds={[FRESH_TURN]}
										understanding={false}
										viewing={FRESH_TURN.id}
										waiting={false}
									/>
								</Column>
							</TableCell>
							<TableCell className="text-fg-secondary text-xs">
								{faultExits(fault)
									.map((exit) => FAULT_EXIT_LABEL[exit])
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
				description="搜不了的要求或者有几种意思的词，AI 用一句话问，下面是几种做法：第一项是名单现在用的，其余点一下就换成那张条件表，记成新的一次修改。"
				title="AI 在问"
			>
				<Column>
					<Thread
						onQuery={() => true}
						onRevise={noop}
						rounds={THREAD.slice(0, 2)}
						understanding
						viewing={THREAD[1]?.id ?? ""}
						waiting={false}
					/>
				</Column>
			</Example>
			<Example
				description="有了下一次，问题收成一行：问话照常，选了的那一项淡一档；下一次不是选项里的哪一张表时只留问话。"
				title="问过的"
			>
				<Column>
					<Thread
						onQuery={() => true}
						onRevise={noop}
						rounds={[...THREAD.slice(0, 2), ANSWERED_TURN]}
						understanding
						viewing={ANSWERED_TURN.id}
						waiting={false}
					/>
				</Column>
			</Example>
			<Example
				description={`刚提交的第一句需求：还没有步骤时只有一行流光的「正在理解你的需求…」，等过 ${ELAPSED_SHOW_AFTER_MS / 1000} 秒跟上已等的秒数。`}
				title="刚提交"
			>
				<Column>
					<Thread
						progress={{ trace: [], startedAt: FRESH_TURN.startedAt }}
						onRevise={noop}
						onQuery={() => true}
						rounds={[FRESH_TURN]}
						understanding
						viewing={FRESH_TURN.id}
						waiting
					/>
				</Column>
			</Example>
			<Example
				description="在条件上直接改的一次没有人说话，线程中间是一条带字的分隔线；指针移到早先几次上，出现查看结果的图标链接。"
				title="直接改条件"
			>
				<Column>
					<Thread
						onRevise={noop}
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
						onRevise={noop}
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
				"一问几选",
			]}
			rules={{
				notes: [
					"线程总是整条链；查看早先一次的结果只换名单，不截断线程，正在看的那一次标「正在查看」。",
					"每次的回应按前后两组条件的差别说加了什么、去掉了什么，条件写进句子用 inSentence。",
					"理解失败时说清是哪个环节出了问题：连不上和报错时需求没被读过，不能说成没读懂；线程里的提示带重试，名单那一列另有同样的出路。",
					"AI 每次最多问一件事：一句问话，第一项是现在用的，其余点一下或按数字键换成那张条件表；不理就照现在的名单。最后一次才能点，有了下一次就收成一行。",
					"检索人才库的过程进行中展开、完成后收起；只给出人数，不给出任何一个人。",
					"消息的时刻与动作（复制、查看这次的结果）悬停才出现；换到哪一次的结果，那一次闪一下。",
				],
				usage: `<Thread\n  onRevise={reviseTo}\n  onQuery={submit}\n  onRetry={retry}\n  rounds={thread}\n  understanding\n  viewing={turnId}\n  waiting={interpreting}\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用线程" },
				{ children: <Faults />, id: "appearance", title: "理解失败" },
				{ children: <Usage />, id: "usage", title: "使用场景" },
			]}
		/>
	);
}
