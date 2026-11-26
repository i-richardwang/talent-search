import { Link, useHydrated } from "@tanstack/react-router";
import {
	CheckIcon,
	EyeIcon,
	LoaderCircleIcon,
	PencilLineIcon,
	RotateCwIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Accordion } from "#/components/ui/accordion";
import { ActionIcon } from "#/components/ui/action-icon";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { CopyButton } from "#/components/ui/copy-button";
import { Divider } from "#/components/ui/divider";
import { AnsweredQuestion, Question } from "#/components/ui/question";
import { Tag } from "#/components/ui/tag";
import { Text } from "#/components/ui/text";
import type { TurnNotes } from "#/search/intent";
import { labelsInSentence, type QueryCondition } from "#/search/query";
import {
	changesOf,
	type QueryInput,
	queryOfSpec,
	sameConditions,
} from "#/search/spec";
import type {
	DiscoveryTrace,
	FoundTrace,
	Probe,
	SubmitIssue,
	TraceStep,
} from "#/search/trace";
import type { ThreadTurn } from "#/server/explain";
import type { AttemptFault, Progress, Turn } from "#/server/turn";
import { FAULT_COPY, FAULT_EXIT_LABEL } from "../-lib/attempt";
import { ELAPSED_SHOW_AFTER_MS, lasting, useElapsed } from "../-lib/elapsed";
import { ConditionList } from "./condition-detail";
import { IconCell } from "./icon-cell";
import { ThreadScrollArea } from "./thread-scroll-area";

function diff(previous: Turn | null, spec: QueryCondition[]) {
	if (previous === null) return { added: spec, removed: [] };
	return changesOf(
		previous.spec ? queryOfSpec(previous.spec).conditions : [],
		spec,
	);
}

/**
 * AI 这一轮怎么回的：第一轮列出全部条件，之后列出加了哪几条、说出去掉了哪几条。
 * 模型丢掉一条用户要的条件，在这里就是一行看得见的字；列出的每一条点开是它实际要什么。
 */
function Reply({
	previous,
	spec,
	explained,
}: {
	previous: Turn | null;
	spec: QueryCondition[];
	explained: ThreadTurn["explained"];
}) {
	if (previous === null)
		return spec.length > 0 ? (
			<div className="flex flex-col gap-1">
				<p>已按以下条件搜索：</p>
				<ConditionList conditions={spec} explained={explained} />
			</div>
		) : (
			<p>这段需求还搜不了</p>
		);
	const { added, removed } = diff(previous, spec);
	if (added.length === 0 && removed.length === 0) return <p>搜索条件未变</p>;
	return (
		<div className="flex flex-col gap-1">
			{added.length > 0 && (
				<>
					<p>已添加：</p>
					<ConditionList conditions={added} explained={explained} />
				</>
			)}
			{removed.length > 0 && <p>已移除 {labelsInSentence(removed)}</p>}
		</div>
	);
}

/** 直接改条件的一轮做了什么。条件和上一轮是同一张表的，是名单还没列全时接着往下找。 */
function editText(previous: Turn | null, spec: QueryCondition[]) {
	if (
		previous?.spec &&
		sameConditions(queryOfSpec(previous.spec).conditions, spec)
	)
		return "你选择了继续找";
	const { added, removed } = diff(previous, spec);
	const parts = [
		added.length > 0 ? `添加 ${labelsInSentence(added)}` : null,
		removed.length > 0 ? `移除 ${labelsInSentence(removed)}` : null,
	].filter((part) => part !== null);
	return parts.length > 0
		? `你修改了搜索条件：${parts.join("；")}`
		: "你修改了搜索条件";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 按浏览器的时区算，所以只在水合之后画。 */
function clockOf(at: number) {
	const d = new Date(at);
	const now = new Date();
	const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	const md = `${d.getMonth() + 1}月${d.getDate()}日`;
	const text =
		d.toDateString() === now.toDateString()
			? hm
			: d.getFullYear() === now.getFullYear()
				? `${md} ${hm}`
				: `${d.getFullYear()}年${md}`;
	const full = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}:${pad(d.getSeconds())}`;
	return { full, text };
}

function Elapsed({
	since,
	type,
}: {
	since: number | null;
	type: "tertiary" | "quaternary";
}) {
	const elapsed = useElapsed(since);
	if (elapsed < ELAPSED_SHOW_AFTER_MS) return null;
	return (
		<Text className="shrink-0" type={type}>
			（{lasting(elapsed)}）
		</Text>
	);
}

/**
 * 对话栏：这次找人任务的整条记录链。
 *
 * 动作作用在正看着的条件上，新的一轮记在链尾（`server/turn.ts` 的 `createTurn`）；回答 AI 的
 * 那一问接在最后一轮后面。AI 没处理成时最后一轮底下给重试；名单那一侧另有同样的下一步
 * （`result-state.tsx`、`completeness.tsx`），窄屏上这一栏收着时那边也看得见。
 */
export function Thread({
	earlier,
	latest,
	viewing,
	onQuery,
	onAnswer,
	onRetry,
	waiting,
	understanding,
	composer,
	example,
	progress,
	fault,
	autoFocus = false,
}: {
	/** 链上最后一轮之前的几轮，链头在前。 */
	earlier: readonly ThreadTurn[];
	/** 链上最后一轮：理解属于它。 */
	latest: ThreadTurn;
	/** 名单正显示的那一轮。 */
	viewing: string;
	/** AI 对最后一轮这一次处理的进度；处理完后为 null，读记录上的。 */
	progress: Progress | null;
	/** AI 没处理成最后一轮时哪个环节出了问题；没有出错为 null。 */
	fault: AttemptFault | null;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 选了最后一轮那一问的一句回答。 */
	onAnswer: (text: string) => unknown;
	/** 让 AI 重新处理最后一轮。 */
	onRetry: () => unknown;
	/** 最后一轮还没理解完：可以接着写，先不能提交。 */
	waiting: boolean;
	/** 配了查询理解才有输入框；没配时线程只能看，条件在 chip 上改。 */
	understanding: boolean;
	composer?: Ref<QueryBarHandle>;
	/** 输入框里换上的示范说法（空态请 HR 再说一句时）；没有就用默认的那句。 */
	example?: string | null;
	autoFocus?: boolean;
}) {
	const rounds = [...earlier, latest];
	const last = earlier.length;
	const latestProgress = progress ?? progressOf(latest);
	const phase = latest.settled ? "settled" : fault ? "failed" : "running";

	return (
		<section aria-label="对话" className="flex h-full flex-col">
			<ThreadScrollArea
				latestId={latest.id}
				phase={phase}
				stepCount={latestProgress.trace.length}
				viewing={viewing}
			>
				<ol className="flex flex-col px-4 pb-6">
					{rounds.map((round, i) => (
						<Round
							current={round.id === viewing}
							failure={i === last ? fault : null}
							key={round.id}
							next={rounds[i + 1] ?? null}
							onRetry={onRetry}
							onAnswer={onAnswer}
							running={i === last && phase === "running"}
							previous={rounds[i - 1] ?? null}
							round={round}
							progress={i === last ? latestProgress : progressOf(round)}
						/>
					))}
				</ol>
			</ThreadScrollArea>
			{understanding && (
				<div className="flex-none px-3 pb-3">
					<QueryBar
						autoFocus={autoFocus}
						focusKey="/"
						onQuery={onQuery}
						placeholder={example ?? "补充或修改需求，例如：最好带过团队"}
						ref={composer}
						waiting={waiting}
					/>
				</div>
			)}
		</section>
	);
}

/** 一轮写入的时刻。按浏览器时区写，水合之前留着同样的高度。 */
function Clock({ at }: { at: number }) {
	const hydrated = useHydrated();
	const clock = hydrated ? clockOf(at) : null;
	return (
		<Text
			className="reveal min-h-5 whitespace-nowrap"
			size="xs"
			type="secondary"
		>
			{clock && (
				<time dateTime={new Date(at).toISOString()} title={clock.full}>
					{clock.text}
				</time>
			)}
		</Text>
	);
}

function Actions({ children }: { children: ReactNode }) {
	return (
		<Block
			align="center"
			className="reveal w-fit rounded-md"
			horizontal
			padding={2}
			role="menubar"
		>
			{children}
		</Block>
	);
}

/** 查看那一轮的结果：真链接，中键、右键、键盘都能用。 */
function ViewResult({ turnId }: { turnId: string }) {
	return (
		<ActionIcon
			icon={EyeIcon}
			render={<Link params={{ turnId }} search={{}} to="/s/$turnId" />}
			size="small"
			title="查看这次的结果"
		/>
	);
}

function Round({
	round,
	previous,
	next,
	current,
	running,
	failure,
	progress: { trace, startedAt },
	onAnswer,
	onRetry,
}: {
	round: ThreadTurn;
	previous: Turn | null;
	/** 下一轮；这一轮的问题答没答、答了哪一项，看它。 */
	next: Turn | null;
	current: boolean;
	running: boolean;
	/** 没理解出来时哪个环节出了问题，不是「这句话没读懂」。 */
	failure: AttemptFault | null;
	progress: Progress;
	/** 选了 AI 那一问的一句回答：把它当成下一句话说给 AI。 */
	onAnswer: (answer: string) => unknown;
	onRetry: () => unknown;
}) {
	const { said, spec, notes } = round;
	const resultNav = current ? (
		next && <Tag size="small">正在查看</Tag>
	) : (
		<Actions>
			<ViewResult turnId={round.id} />
		</Actions>
	);

	// 直接改条件的一轮没有人说话，AI 也不回话；改完有新进范围的人要补时，底下是补的过程
	if (said === null)
		return (
			<li aria-current={current ? "page" : undefined} className="group/reveal">
				<Divider className="my-0 py-5">
					<span className="flex min-w-0 items-center gap-1">
						<Tag className="min-w-0 whitespace-normal" icon={PencilLineIcon}>
							{spec && editText(previous, queryOfSpec(spec).conditions)}
						</Tag>
						{resultNav}
					</span>
				</Divider>
				{(trace.length > 0 || failure) && (
					<div className="flex w-full min-w-0 flex-col gap-2 pb-2">
						{trace.length > 0 && (
							<Process live={running} since={startedAt} steps={trace} />
						)}
						{failure && <Fault fault={failure} onRetry={onRetry} />}
					</div>
				)}
			</li>
		);

	return (
		<li aria-current={current ? "page" : undefined} className="flex flex-col">
			<div className="group/reveal flex flex-col items-end gap-2 py-2 ps-9">
				<Clock at={round.at} />
				<p className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-fill-tertiary px-3 py-2">
					{said}
				</p>
				<Actions>
					<CopyButton content={said} size="small" />
				</Actions>
			</div>
			<div className="group/reveal flex flex-col gap-2 py-2">
				<div className="flex items-center gap-2">
					<Text className="whitespace-nowrap" weight="medium">
						AI
					</Text>
					<Clock at={lastStepAt(round.at, trace)} />
				</div>
				<div className="flex w-full min-w-0 flex-col gap-2">
					{trace.length > 0 ? (
						<Process live={running} since={startedAt} steps={trace} />
					) : (
						running && (
							<p className="flex items-center gap-1" role="status">
								<Text shiny type="secondary">
									正在理解你的需求…
								</Text>
								<Elapsed since={startedAt} type="tertiary" />
							</p>
						)
					)}
					{spec && (
						<Reply
							explained={round.explained}
							previous={previous}
							spec={queryOfSpec(spec).conditions}
						/>
					)}
					{spec && notes && (
						<Note next={next} notes={notes} onAnswer={onAnswer} />
					)}
					{failure && <Fault fault={failure} onRetry={onRetry} />}
				</div>
				{resultNav}
			</div>
		</li>
	);
}

function progressOf(turn: Turn): Progress {
	return { trace: turn.trace ?? [], startedAt: turn.startedAt };
}

/** AI 回应的时刻：最后一步完成的时候；没走过步骤就是那一轮写入的时候。 */
function lastStepAt(at: number, trace: readonly TraceStep[]) {
	return trace[trace.length - 1]?.at ?? at;
}

function Fault({
	fault,
	onRetry,
}: {
	fault: AttemptFault;
	onRetry: () => unknown;
}) {
	const copy = FAULT_COPY[fault];
	return (
		<Alert
			action={
				copy.retry && (
					<Button
						icon={RotateCwIcon}
						onClick={onRetry}
						size="small"
						type="fill"
					>
						{FAULT_EXIT_LABEL.retry}
					</Button>
				)
			}
			title={copy.title}
			type="secondary"
			variant="outlined"
		/>
	);
}

/**
 * AI 对 HR 说的那句话。带回答时是一问：最后一轮的问题可以点，点了就是把那句回答说给 AI，
 * 记成新的一轮；有了下一轮就收起来，下一轮说的恰好是其中一句回答时写出答的是哪一句。
 */
function Note({
	notes: { says, choices },
	next,
	onAnswer,
}: {
	notes: TurnNotes;
	next: Turn | null;
	onAnswer: (answer: string) => unknown;
}) {
	if (!choices) return <p>{says}</p>;
	if (next) {
		const picked = choices.others.find((o) => o.label === next.said);
		return <AnsweredQuestion answer={picked?.label ?? null} question={says} />;
	}
	return (
		<Question
			onChoose={(key) => {
				const answer = answerAt(choices, Number(key));
				return answer && onAnswer(answer);
			}}
			options={[
				{ current: true, key: "1", label: choices.current },
				...choices.others.map((o, i) => ({
					description: o.detail,
					key: String(i + 2),
					label: o.label,
				})),
			]}
			question={says}
		/>
	);
}

/**
 * 问题里第 n 项（从 1 数，和选项前的编号一样）是哪句回答。第 1 项是现在用着的那一种，
 * 和没有这一项一样，不用再说。
 */
export function answerAt(
	choices: NonNullable<TurnNotes["choices"]>,
	n: number,
): string | null {
	return choices.others[n - 2]?.label ?? null;
}

/** 说的是找了什么，不是调了什么——调的是哪样东西对人没有意义。 */
function stepTitle(step: TraceStep) {
	switch (step.tool) {
		case "find":
			return { action: "查看人才库里的说法", keyword: "" };
		case "discover":
			return discoveryTitle(step.discovery);
		case "probe":
			return {
				action: "试搜",
				keyword: step.probe.conditions.map((c) => c.label).join("、"),
			};
		case "read":
			return { action: "查看候选人的经历", keyword: "" };
		case "score":
			return { action: "评估经历与要求的匹配程度", keyword: "" };
		case "judge":
			return { action: "判断这些经历是否符合", keyword: "" };
		case "submit":
			return {
				action: "调整搜索条件",
				keyword: [
					...new Set(
						step.issues.flatMap((i) => (i.subject ? [i.subject] : [])),
					),
				].join("、"),
			};
	}
}

function discoveryTitle(d: DiscoveryTrace) {
	if (d.kind === "overview") return { action: "查看人才库概况", keyword: "" };
	if (d.kind === "values") return { action: `查看${d.subject}`, keyword: "" };
	if (d.kind === "names")
		return {
			action: `查找${d.subject}`,
			keyword: d.found.map((f) => f.query).join("、"),
		};
	return { action: "查看人才库", keyword: "" };
}

/** 概况只说有哪些记录、从什么时候起；人数是全库的，不放在名单旁边。 */
function discoveryFindings(d: DiscoveryTrace): string[] {
	if (d.kind === "overview")
		return d.streams.length > 0
			? d.streams.map(
					(s) =>
						`人才库中有${s.label}记录${s.first ? `，${s.first} 起` : "，还没有内容"}`,
				)
			: ["人才库中没有绩效、高潜这类记录"];
	if (d.kind === "values") return [d.values.join("、") || "人才库中没有取值"];
	if (d.kind === "names")
		return d.found.map((f) => findingLine(f.query, f.values));
	return ["这一项人才库中查不到"];
}

/**
 * 试搜只说确定的事：哪一条在人才库中没有人、哪一条这样写搜不了，每一条都找得到却合起来没有人。
 * 不写人数：一条单独搜到的是简历里写到的人，其中谁符合要确认过才知道，和名单上的人数说的不是
 * 一回事；名单上有多少人只在名单上说。
 */
function probeFindings(p: Probe): string[] {
	const problems = p.conditions.flatMap((c) =>
		c.people === null
			? [`${labelsInSentence([c])}：这样写搜不了`]
			: c.people === 0
				? [`人才库中没有符合「${c.label}」的人`]
				: [],
	);
	if (problems.length > 0) return problems;
	return [
		p.total === 0 && p.unread === 0
			? "每一项都找得到，合起来没有人符合"
			: "每一项在人才库中都找得到",
	];
}

/** 整理出的搜索条件哪里还要改：和试搜、查找的说法一致，AI 改完再交。 */
function issueLine({ kind, subject }: SubmitIssue): string {
	if (kind === "wording") return "有一条的说法要换成更直白的话";
	if (kind === "form" || subject === null) return "有的搜索条件没写完整";
	if (kind === "unrunnable") return `「${subject}」这样写搜不了`;
	if (kind === "unfound") return `人才库中没有符合「${subject}」的人`;
	return `「${subject}」找出的太多，名单出不来`;
}

/** 一步查到的结论：人才库里有没有、有哪些写法。人数是全库写过的人，步骤里不记。 */
function findingLine(query: string, values: readonly string[]) {
	if (values.length === 0) return `人才库中没有「${query}」`;
	return `人才库中有「${query}」，包括${values.join("、")}`;
}

/**
 * 按字面在人才库里找到了哪些说法。找的时候用的写法是给搜索用的，不上屏；一种写法什么都
 * 没找到不单独说，整步都没找到才说一句。
 */
function foundLine(f: FoundTrace): string[] {
	if (f.phrases === 0) return [];
	const names = f.top.join("、");
	return [
		f.phrases > f.top.length
			? `人才库中有${names}等 ${f.phrases} 种说法`
			: `人才库中有${names}`,
	];
}

function StatusCell({ live }: { live: boolean }) {
	return live ? (
		<IconCell className="text-fg-secondary" icon={LoaderCircleIcon} spin />
	) : (
		<IconCell className="text-success" icon={CheckIcon} />
	);
}

/** 标题换字时的等待：步骤连着到时只换最后一次，标题不来回跳。 */
const HEADLINE_DEBOUNCE_MS = 320;

function useDebounced(value: string, live: boolean) {
	const [shown, setShown] = useState(value);
	useEffect(() => {
		if (!live) {
			setShown(value);
			return;
		}
		const timer = setTimeout(() => setShown(value), HEADLINE_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [value, live]);
	return live ? shown : value;
}

/**
 * 检索人才库的过程。进行中默认展开；人把它收起来时，标题换成正在做的那一步。
 * 完成后自动收起（人在进行中亲手点开过的除外），标题是步数与用时。
 */
function Process({
	steps,
	live,
	since,
}: {
	steps: readonly TraceStep[];
	live: boolean;
	/** 这一次处理开始的时刻：进行中的计时和完成后的用时都从它算。 */
	since: number | null;
}) {
	const [open, setOpen] = useState(live);
	const openedByHand = useRef(false);
	const wasLive = useRef(live);
	useEffect(() => {
		if (wasLive.current && !live && !openedByHand.current) setOpen(false);
		wasLive.current = live;
	}, [live]);

	const latest = steps[steps.length - 1];
	const current = latest ? stepTitle(latest) : null;
	const count = `检索人才库 ${steps.length} 步`;
	const headline = useDebounced(
		open || !current ? count : `${current.action} ${current.keyword}`,
		live,
	);
	const took = latest && since !== null ? latest.at - since : 0;

	const title = (
		<span className="flex min-w-0 items-center gap-1.5">
			<StatusCell live={live} />
			{live ? (
				<span className="flex min-h-(--text-base--line-height) min-w-0 items-center gap-1.5">
					<span className="relative min-w-0 overflow-hidden">
						<AnimatePresence initial={false} mode="popLayout">
							<motion.span
								animate={{ opacity: 1, y: 0 }}
								className="flex min-h-(--text-base--line-height) items-center"
								exit={{ opacity: 0, y: -8 }}
								initial={{ opacity: 0, y: 8 }}
								key={headline}
								transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
							>
								<Text ellipsis shiny type="secondary">
									{headline}
								</Text>
							</motion.span>
						</AnimatePresence>
					</span>
					<Elapsed since={since} type="quaternary" />
				</span>
			) : (
				<span className="flex min-w-0 items-center gap-1.5">
					<Text ellipsis type="secondary">
						{count}
					</Text>
					{took >= 1000 && (
						<Text className="shrink-0" type="quaternary">
							{lasting(took)}
						</Text>
					)}
				</span>
			)}
		</span>
	);

	return (
		<Accordion
			items={[
				{
					children: (
						<ol className="flex flex-col gap-2 pt-1 pb-2">
							{steps.map((step, i) => (
								// biome-ignore lint/suspicious/noArrayIndexKey: 步骤只追加不改序，位置就是一步的身份；并行的两步可以记在同一毫秒
								<li key={i}>
									<StepRow step={step} />
								</li>
							))}
						</ol>
					),
					key: "process",
					title,
				},
			]}
			onValueChange={(keys) => {
				const next = keys.includes("process");
				if (next) openedByHand.current = true;
				setOpen(next);
			}}
			value={open ? ["process"] : []}
		/>
	);
}

export function stepFindings(step: TraceStep): string[] {
	switch (step.tool) {
		case "find": {
			const lines = step.found.flatMap(foundLine);
			return lines.length > 0 ? lines : ["人才库中没有找到这样的说法"];
		}
		case "discover":
			return discoveryFindings(step.discovery);
		case "probe":
			return probeFindings(step.probe);
		case "read":
			if ("unlisted" in step) return ["这份条件还出不了名单"];
			return [
				step.segments > 0
					? step.left > step.segments
						? `取了 ${step.segments} 段经历，后面还有 ${step.left - step.segments} 段`
						: `取了 ${step.segments} 段经历`
					: step.left > 0
						? "这一次能确认的经历已经到上限"
						: "候选人的经历都确认过了",
			];
		case "score":
			return [
				"unavailable" in step
					? "本轮匹配评分暂不可用，名单按已有依据排序"
					: `已评估 ${step.segments} 段符合要求的经历`,
			];
		case "judge":
			return [`${step.fits} 段符合，${step.unfit} 段不符合`];
		case "submit":
			return step.issues.map(issueLine);
	}
}

function StepRow({ step }: { step: TraceStep }) {
	const { action, keyword } = stepTitle(step);
	return (
		<Accordion
			items={[
				{
					children: (
						<div className="flex flex-col gap-2 py-2">
							{stepFindings(step).map((line) => (
								<Text
									as="p"
									className="tabular-nums"
									key={line}
									size="xs"
									type="tertiary"
								>
									{line}
								</Text>
							))}
							<Divider className="mt-2 mb-0" dashed />
						</div>
					),
					key: "step",
					title: (
						<span className="flex min-w-0 items-center gap-1.5">
							<StatusCell live={false} />
							<span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap py-px text-fg-tertiary">
								<span className="shrink-0">{action}</span>
								<Text code ellipsis size="xs" type="tertiary">
									{keyword}
								</Text>
							</span>
						</span>
					),
				},
			]}
		/>
	);
}
