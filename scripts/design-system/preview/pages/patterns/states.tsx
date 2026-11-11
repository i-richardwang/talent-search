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
import {
	IncompleteNotice,
	NotCompleted,
} from "#/routes/s/$turnId/-components/completeness";
import { Earlier } from "#/routes/s/$turnId/-components/earlier";
import {
	ResultList,
	SKELETON_DELAY,
} from "#/routes/s/$turnId/-components/result-list";
import {
	ListFailed,
	NoResults,
	ResultHeader,
} from "#/routes/s/$turnId/-components/result-state";
import {
	FAULT_COPY,
	FAULT_EXIT_LABEL,
	faultExits,
} from "#/routes/s/$turnId/-lib/attempt";
import { ELAPSED_SHOW_AFTER_MS } from "#/routes/s/$turnId/-lib/elapsed";
import { type ListWait, listWait } from "#/routes/s/$turnId/-lib/nav-phase";
import { usePicks } from "#/routes/s/$turnId/-lib/picks";
import { KEYWORD_LABEL } from "#/search/keywords";
import type { AttemptFault, SearchMode } from "#/server/turn";
import { Control, Controls } from "../../kit/controls";
import { DocPage } from "../../kit/page";
import { Stage } from "../../kit/stage";
import { Routed } from "../../routed";
import {
	COVERED,
	EMPTY_CASES,
	KEYWORD_SPEC,
	SPEC,
} from "../../samples/conditions";
import {
	EMPTY_OUTCOME,
	INCOMPLETE_EMPTY_OUTCOME,
	INCOMPLETE_OUTCOME,
	OUTCOME,
} from "../../samples/people";
import { LATEST_TURN_ID, ROOT_TURN_ID } from "../../samples/thread";

/** 理解失败的每种原因，按产品的文案表列。 */
const FAULTS = Object.keys(FAULT_COPY) as AttemptFault[];

const EMPTIES = Object.values(EMPTY_CASES);

/* ---------- 试用：一次提交从等待走到结果 ---------- */

type Ending = "results" | "incomplete" | "incompleteEmpty" | "empty" | "failed";

/** `completing` 不在提交一句话的路上：它是直接改条件之后 AI 补人的那一段。 */
type Step = "understanding" | "searching" | "completing" | "done";

const OUTCOMES: Record<Ending, typeof OUTCOME> = {
	results: OUTCOME,
	incomplete: INCOMPLETE_OUTCOME,
	incompleteEmpty: INCOMPLETE_EMPTY_OUTCOME,
	empty: EMPTY_OUTCOME,
	failed: OUTCOME,
};

/** 名单就位之后，这种结局要说明的一句；没有要说明的为 null。 */
const ENDING_NOTE: Record<Ending, string | null> = {
	results: null,
	incomplete:
		"候选人多到一次确认不完：名单上只有 AI 确认过的人，从职级高的人确认起；名单上方说清现在完整覆盖到哪一档，下一步是把条件说得更具体",
	incompleteEmpty:
		"候选人还没确认完、名单上一个人都没有：空态说已经找到哪一档职级，下一步是补充需求，不说成没有这样的人",
	empty: null,
	failed: null,
};

/** 没有导航在进行。 */
const STILL = { growing: false, refreshing: false, replacing: false };

/** 名单在这一步等什么、等的时候长什么样：和工作台用同一个 `listWait`。 */
function waitOf(step: Step): ListWait | null {
	if (step === "done") return null;
	if (step === "searching")
		return listWait(null, null, { ...STILL, replacing: true });
	return listWait(step, null, STILL);
}

/**
 * 一次提交的名单那一列：先理解（AI 在这一步里把搜到的经历看完）、再搜索，最后得到选定的结果。
 * 直接改条件的那一次不经过理解：名单留着，表头写正在补人。
 */
function Run({ ending, step }: { ending: Ending; step: Step }) {
	const outcome = OUTCOMES[ending];
	const picks = usePicks(LATEST_TURN_ID, outcome);
	const failed = ending === "failed" && step === "done";
	const wait = waitOf(step);
	// 名单不完整的说明在名单上方；空名单的原因在空态里说，还在等的时候这句话还没定
	const incomplete =
		step === "done" && outcome.results.length > 0 ? outcome.incomplete : null;
	const noop = () => {};
	return (
		<Routed url={`/s/${LATEST_TURN_ID}`}>
			{incomplete && (
				<div className="mb-4">
					<IncompleteNotice incomplete={incomplete} />
				</div>
			)}
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
		setStep("understanding");
		timers.current =
			ending === "failed"
				? [window.setTimeout(() => setStep("done"), 5000)]
				: [
						window.setTimeout(() => setStep("searching"), 5000),
						window.setTimeout(() => setStep("done"), 6500),
					];
	};
	const edit = () => {
		timers.current.forEach(window.clearTimeout);
		setStep("completing");
		timers.current = [window.setTimeout(() => setStep("done"), 5000)];
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
							{ label: "找到人，候选人较多", value: "incomplete" },
							{ label: "候选人较多，还没找到人", value: "incompleteEmpty" },
							{ label: "没有结果", value: "empty" },
							{ label: "AI 服务不可用", value: "failed" },
						]}
						value={ending}
					/>
				</Control>
				<Control>
					<Button onClick={play}>提交一次</Button>
				</Control>
				<Control>
					<Button onClick={edit}>直接改一次条件</Button>
				</Control>
			</Controls>
			<Stage
				className="items-stretch p-4"
				footer={
					<span>
						{step === "understanding"
							? `正在理解需求，AI 在这一步里把搜到的经历看完：${SKELETON_DELAY / 1000} 秒后换成占位行，表头等过 ${ELAPSED_SHOW_AFTER_MS / 1000} 秒写出已等的秒数`
							: step === "searching"
								? "理解完了，正在搜索"
								: step === "completing"
									? "直接改了条件，名单先按确认过的出、照常可用；AI 在补上新进范围的人，表头在人数后面写在做什么，名单上还没有人时画占位行"
									: (ENDING_NOTE[ending] ??
										"点「提交一次」看名单那一列怎么从等待走到结果；点「直接改一次条件」看 AI 补人时名单的样子")}
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
							<TableHead>下一步</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{FAULTS.map((fault) => (
							<TableRow key={fault}>
								<TableCell className="font-mono text-xs">{fault}</TableCell>
								<TableCell className="w-full">
									<Routed url={`/s/${LATEST_TURN_ID}`}>
										<ListFailed
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

/* ---------- 名单还不完整 ---------- */

/** 名单不空、但还不能算完整的几种时候，各在哪里说、说什么。 */
function Completeness() {
	const [last, setLast] = useState<string | null>(null);
	return (
		<div className="flex flex-col gap-3">
			<Block className="overflow-hidden" variant="outlined">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>什么时候</TableHead>
							<TableHead>在哪里说</TableHead>
							<TableHead>说什么</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						<TableRow>
							<TableCell className="whitespace-nowrap">
								改完条件，AI 正在补人
							</TableCell>
							<TableCell className="whitespace-nowrap text-fg-secondary text-xs">
								名单表头
							</TableCell>
							<TableCell className="w-full">
								<ResultHeader
									order="evidence"
									total={OUTCOME.total}
									wait={waitOf("completing")}
								/>
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="whitespace-nowrap">
								候选人较多，覆盖到某一档职级
							</TableCell>
							<TableCell className="whitespace-nowrap text-fg-secondary text-xs">
								名单上方
							</TableCell>
							<TableCell className="w-full">
								<IncompleteNotice incomplete={COVERED} />
							</TableCell>
						</TableRow>
						<TableRow>
							<TableCell className="whitespace-nowrap">
								候选人较多，最高一档也没覆盖完
							</TableCell>
							<TableCell className="whitespace-nowrap text-fg-secondary text-xs">
								名单上方
							</TableCell>
							<TableCell className="w-full">
								<IncompleteNotice incomplete={{ above: null }} />
							</TableCell>
						</TableRow>
						{FAULTS.map((fault) => (
							<TableRow key={fault}>
								<TableCell className="whitespace-nowrap">
									补人没成 <span className="font-mono text-xs">{fault}</span>
								</TableCell>
								<TableCell className="whitespace-nowrap text-fg-secondary text-xs">
									名单上方
								</TableCell>
								<TableCell className="w-full">
									<NotCompleted
										fault={fault}
										onRetry={() =>
											setLast(`「${FAULT_COPY[fault].title}」点了重试`)
										}
									/>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Block>
			<p className="text-fg-secondary text-xs">
				{last ??
					"名单上已有的人都成立，所以名单照常显示：这几句只说还会不会多出人、多到哪里为止。"}
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
				{last ??
					"成因由检索判定，这里只把它写成结论和一条一键就能执行的下一步。"}
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

/** 加载、空态与报错：名单那一列在等待、没结果、没理解出来时各说什么，给哪条下一步。 */
export function StatesPage() {
	return (
		<DocPage
			facts={[
				"先理解再搜索",
				`${FAULTS.length} 种理解失败`,
				`${EMPTIES.length} 种空态`,
				"名单不完整时的说明",
				`${Object.keys(NOT_FOUND).length} 种找不到`,
			]}
			rules={{
				notes: [
					"AI 服务没开启或出错时明说，不退回成一份空名单：理解失败不是没有结果。",
					"理解失败时说清是哪个环节出了问题：连不上和报错时需求没被读过，不能说成没读懂，也不叫人换说法。",
					"空态原因由检索层判定，界面为每种原因都给出文案和下一步，不用二手计数重新推断。",
					"空态文案说明当前问题和可执行的下一步，标题已说明的内容不重复。",
					"没被 AI 确认过的经历不算数：名单上只有确认过的人。候选人多到一次确认不完时，从职级高的人确认起，名单上方说清完整覆盖到哪一档；名单因此空着时是一种空态，不说成没有这样的人。",
					"HR 直接改条件之后 AI 接着补上新进范围的人：名单照常可用，表头写在做什么；没补成时名单上方说哪个环节出了问题，给重试。",
					"一次动作的结果（提交失败、导出完成）用通知；一直成立的状态（正在看较早的一次）用 Alert；查询条件的注解用行内文字。",
				],
				usage: `<ResultList\n  wait={{ list: "skeleton", phase: "understanding", since: startedAt }}\n  failure={fault ? { fault, onRetry: retry } : null}\n  …\n/>`,
			}}
			sections={[
				{ children: <Playground />, id: "playground", title: "试用：一次提交" },
				{ children: <Faults />, id: "faults", title: "理解失败" },
				{
					children: <Completeness />,
					id: "completeness",
					title: "名单还不完整",
				},
				{ children: <Empties />, id: "empty", title: "没有结果" },
				{ children: <NotFound />, id: "not-found", title: "找不到" },
				{ children: <Events />, id: "events", title: "页面事件" },
			]}
		/>
	);
}
