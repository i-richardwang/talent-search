import { useEffect, useRef, useState } from "react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Segmented } from "#/components/ui/segmented";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { toast } from "#/components/ui/toast";
import { PageNotFound, TurnNotFound } from "#/routes/-components/not-found";
import { COMMIT_FAILED } from "#/routes/-lib/commit";
import { Earlier } from "#/routes/s/$turnId/-components/earlier";
import {
	ResultList,
	SKELETON_DELAY,
} from "#/routes/s/$turnId/-components/result-list";
import {
	NoResults,
	NotUnderstood,
} from "#/routes/s/$turnId/-components/result-state";
import { ELAPSED_SHOW_AFTER_MS } from "#/routes/s/$turnId/-lib/elapsed";
import {
	FAULT_COPY,
	FAULT_EXIT_LABEL,
	faultExits,
} from "#/routes/s/$turnId/-lib/interpret";
import type { ListWait } from "#/routes/s/$turnId/-lib/nav-phase";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import { KEYWORD_LABEL } from "#/search/keywords";
import type { InterpretFault, SearchMode } from "#/server/turn";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import { EMPTY_CASES, KEYWORD_SPEC, SPEC } from "../../samples/conditions";
import { EMPTY_OUTCOME, OUTCOME } from "../../samples/people";
import { LATEST_TURN_ID, ROOT_TURN_ID } from "../../samples/thread";

/** 理解失败的每种原因，按产品的文案表列。 */
const FAULTS = Object.keys(FAULT_COPY) as InterpretFault[];

const EMPTIES = Object.values(EMPTY_CASES);

/* ---------- 试用：一次提交从等待走到结果 ---------- */

type Ending = "results" | "empty" | "failed";

type Step = "interpreting" | "searching" | "done";

/** 一次提交的名单那一列：先理解、再搜索、最后得到选定的结果。 */
function Run({ ending, step }: { ending: Ending; step: Step }) {
	const outcome = ending === "empty" ? EMPTY_OUTCOME : OUTCOME;
	const picks = usePicks(LATEST_TURN_ID, outcome);
	const failed = ending === "failed" && step === "done";
	const wait: ListWait | null =
		step === "done" ? null : { list: "skeleton", phase: step };
	const noop = () => {};
	return (
		<Routed url={`/s/${LATEST_TURN_ID}`}>
			<ResultList
				canMore={false}
				empId={undefined}
				failure={failed ? { fault: "unreachable", onRetry: noop } : null}
				growing={false}
				mode="conversation"
				onAll={noop}
				onChange={noop}
				onEditQuery={noop}
				onMore={noop}
				onReviseQuery={noop}
				outcome={outcome}
				picks={picks}
				spec={SPEC}
				turnId={LATEST_TURN_ID}
				wait={wait}
			/>
		</Routed>
	);
}

function Playground() {
	const [ending, setEnding] = useState<Ending>("results");
	const [step, setStep] = useState<Step>("done");
	const timers = useRef<number[]>([]);
	useEffect(() => () => timers.current.forEach(window.clearTimeout), []);
	const play = () => {
		timers.current.forEach(window.clearTimeout);
		setStep("interpreting");
		timers.current =
			ending === "failed"
				? [window.setTimeout(() => setStep("done"), 5000)]
				: [
						window.setTimeout(() => setStep("searching"), 5000),
						window.setTimeout(() => setStep("done"), 6500),
					];
	};
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="这次提交的结局">
					<Segmented<Ending>
						onChange={(next) => {
							setEnding(next);
							setStep("done");
						}}
						options={[
							{ label: "找到人", value: "results" },
							{ label: "没有结果", value: "empty" },
							{ label: "AI 服务不可用", value: "failed" },
						]}
						value={ending}
					/>
				</Control>
				<Control>
					<Button onClick={play}>提交一次</Button>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-4"
				footer={
					<span>
						{step === "interpreting"
							? `正在理解需求：${SKELETON_DELAY / 1000} 秒后换成占位行，表头等过 ${ELAPSED_SHOW_AFTER_MS / 1000} 秒写出已等的秒数`
							: step === "searching"
								? "理解完了，正在搜索"
								: "点「提交一次」看名单那一列怎么从等待走到结果"}
					</span>
				}
			>
				<div className="mx-auto w-full max-w-(--container-page)">
					<Run ending={ending} key={ending} step={step} />
				</div>
			</Stage>
		</div>
	);
}

/* ---------- 理解失败 ---------- */

function Faults() {
	const [last, setLast] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-3">
			<Block className="overflow-hidden" variant="outlined">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>出错环节</TableHead>
							<TableHead>名单那一列</TableHead>
							<TableHead>出路</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{FAULTS.map((fault) => (
							<TableRow key={fault}>
								<TableCell className="font-mono text-xs">{fault}</TableCell>
								<TableCell className="w-full">
									<Routed url={`/s/${LATEST_TURN_ID}`}>
										<NotUnderstood
											fault={fault}
											onRetry={() =>
												setLast(`「${FAULT_COPY[fault].title}」点了重试`)
											}
										/>
									</Routed>
								</TableCell>
								<TableCell className="whitespace-nowrap text-fg-secondary text-xs">
									{faultExits(fault)
										.map((exit) => FAULT_EXIT_LABEL[exit])
										.join("、") || "无"}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Block>
			<p className="text-fg-secondary text-xs">
				{last ??
					"AI 服务连不上或报错时，需求根本没被读过：不说「没读懂」，也不叫人换说法。"}
			</p>
		</div>
	);
}

/* ---------- 空态 ---------- */

function Empties() {
	const [mode, setMode] = useState<SearchMode>("conversation");
	const [last, setLast] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="搜索方式">
					<Segmented<SearchMode>
						onChange={setMode}
						options={[
							{ label: "AI 搜索", value: "conversation" },
							{ label: "关键词搜索", value: "keyword" },
						]}
						value={mode}
					/>
				</Control>
			</Controls>
			<Block className="overflow-hidden" variant="outlined">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>成因</TableHead>
							<TableHead>名单那一列</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{EMPTIES.map(([reason, spec]) => (
							<TableRow key={reason.kind}>
								<TableCell className="font-mono text-xs">
									{reason.kind}
								</TableCell>
								<TableCell className="w-full">
									<NoResults
										mode={mode}
										onChange={() => setLast("清除了筛选，同一次搜索换个看法")}
										onEditQuery={() =>
											setLast(
												mode === "keyword"
													? `光标落进「${KEYWORD_LABEL.what}」框`
													: "光标落进右栏的输入框",
											)
										}
										onReviseQuery={() =>
											setLast("启用了全部条件，记成新的一次搜索")
										}
										outcome={{ ...EMPTY_OUTCOME, empty: reason }}
										spec={mode === "keyword" ? KEYWORD_SPEC : spec}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Block>
			<p className="text-fg-secondary text-xs">
				{last ?? "成因由检索判定，这里只把它写成结论和一条一键就能执行的出路。"}
			</p>
		</div>
	);
}

/* ---------- 找不到 ---------- */

/** 两种找不到：地址指向的页面或搜索记录不存在。 */
const NOT_FOUND = {
	page: PageNotFound,
	turn: TurnNotFound,
} as const;

function NotFound() {
	const [which, setWhich] = useState<keyof typeof NOT_FOUND>("turn");
	const Shown = NOT_FOUND[which];
	return (
		<div className="flex flex-col gap-4">
			<Controls>
				<Control label="地址指向">
					<Segmented<keyof typeof NOT_FOUND>
						onChange={setWhich}
						options={[
							{ label: "不存在的搜索记录", value: "turn" },
							{ label: "不存在的页面", value: "page" },
						]}
						value={which}
					/>
				</Control>
			</Controls>
			<Stage className="min-h-80 items-stretch p-0">
				<Routed url="/s/turn-z9">
					<Shown />
				</Routed>
			</Stage>
		</div>
	);
}

/* ---------- 页面事件 ---------- */

function Events() {
	return (
		<Block className="overflow-hidden" variant="outlined">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>什么时候</TableHead>
						<TableHead>提示</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="whitespace-nowrap">提交没成功</TableCell>
						<TableCell className="w-full">
							<Button onClick={() => toast.error(COMMIT_FAILED)} size="small">
								弹出通知
							</Button>
						</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="whitespace-nowrap">看较早的结果</TableCell>
						<TableCell className="w-full">
							<Routed url={`/s/${ROOT_TURN_ID}`}>
								<Earlier latestId={LATEST_TURN_ID} />
							</Routed>
						</TableCell>
					</TableRow>
				</TableBody>
			</Table>
		</Block>
	);
}

/** 加载、空态与报错：名单那一列在等待、没结果、没理解出来时各说什么，给哪条出路。 */
export function StatesPage() {
	return (
		<DocPage
			facts={[
				"先理解再搜索",
				`${FAULTS.length} 种理解失败`,
				`${EMPTIES.length} 种空态`,
				`${Object.keys(NOT_FOUND).length} 种找不到`,
			]}
			rules={{
				notes: [
					"AI 服务没开启或出错时明说，不退回成一份空名单：理解失败不是没有结果。",
					"理解失败时说清是哪个环节出了问题：连不上和报错时需求没被读过，不能说成没读懂，也不叫人换说法。",
					"空态原因由检索层判定，界面为每种原因都给出文案和出路，不用二手计数重新推断。",
					"空态文案说明当前问题和可执行的出路，标题已说明的内容不重复。",
					"一次动作的结果（提交失败、导出完成）用通知；一直成立的状态（正在看较早的一次）用 Alert；查询条件的注解用行内文字。",
				],
				usage: `<ResultList\n  wait={{ list: "skeleton", phase: "interpreting" }}\n  failure={fault ? { fault, onRetry: retry } : null}\n  …\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用：一次提交" },
				{ children: <Faults />, id: "faults", title: "理解失败" },
				{ children: <Empties />, id: "empty", title: "没有结果" },
				{ children: <NotFound />, id: "not-found", title: "找不到" },
				{ children: <Events />, id: "events", title: "页面事件" },
			]}
		/>
	);
}
