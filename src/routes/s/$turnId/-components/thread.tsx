import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Button } from "#/components/ui/button";
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { Frame } from "#/components/ui/frame";
import { ScrollArea } from "#/components/ui/scroll-area";
import type { Condition } from "#/search/condition";
import { conditionLabel, inSentence } from "#/search/condition-label";
import type { QueryInput } from "#/search/spec";
import { changesOf } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import type { InterpretFault, Turn } from "#/server/turn";
import { FAULT_COPY } from "../-lib/interpret";

/** 这一轮比上一轮加了哪些、去了哪些。链头没有上一轮，整张表都算加的。 */
function diff(previous: Turn | null, spec: Condition[]) {
	if (previous === null) return { added: spec, removed: [] };
	return changesOf(previous.spec?.conditions ?? [], spec);
}

/**
 * 模型这一轮交回的条件怎么说。链头说按哪些条件搜；后面每一轮说添加了什么、
 * 移除了什么。模型丢掉一条用户要的条件，在这里就是一行看得见的字。
 */
function replyText(previous: Turn | null, spec: Condition[]) {
	if (previous === null)
		return spec.length > 0
			? `已按以下条件搜索：${inSentence(spec)}`
			: "没有整理出可用的搜索条件";
	const { added, removed } = diff(previous, spec);
	if (added.length === 0 && removed.length === 0) return "搜索条件未变";
	return [
		added.length > 0 ? `已添加 ${inSentence(added)}` : null,
		removed.length > 0 ? `已移除 ${inSentence(removed)}` : null,
	]
		.filter((part) => part !== null)
		.join("；");
}

/** 用户直接在条件上改的一轮怎么记：没有人说话，改动本身就是那一步。 */
function editText(previous: Turn | null, spec: Condition[]) {
	const { added, removed } = diff(previous, spec);
	const parts = [
		added.length > 0 ? `添加 ${inSentence(added)}` : null,
		removed.length > 0 ? `移除 ${inSentence(removed)}` : null,
	].filter((part) => part !== null);
	return parts.length > 0
		? `你修改了搜索条件：${parts.join("；")}`
		: "你修改了搜索条件";
}

/** 离底多近算「跟在底下」：比一行字矮，人只要往上翻过一行就不再拽他。 */
const STUCK_PX = 8;

/**
 * 线程跟着长：换了一轮就滚到底，人刚说的话不该藏在滚动条底下；当前这一轮
 * 边跑边长出东西时，只有人本来就看着底下才跟着滚，翻上去看过去的轮次时不拽回来。
 *
 * 滚的是这一栏自己的视口，不用 `scrollIntoView`：那个会连外层一起滚，
 * 首帧能把整页顶走。
 *
 * @param growth 当前这一轮长到哪了；它一变就重看一次要不要滚。
 */
function useFollow(turnId: string, growth: string) {
	const list = useRef<HTMLOListElement>(null);
	const stuck = useRef(true);

	useEffect(() => {
		const viewport = list.current?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (!viewport) return;
		const onScroll = () => {
			stuck.current =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
				STUCK_PX;
		};
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, []);

	// 换轮次强制到底；同一轮长出东西只在跟着底下时到底
	const seen = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 长出一点就要重看一次
	useLayoutEffect(() => {
		if (seen.current !== turnId) {
			seen.current = turnId;
			stuck.current = true;
		}
		const viewport = list.current?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (viewport && stuck.current) viewport.scrollTop = viewport.scrollHeight;
	}, [turnId, growth]);

	return list;
}

/** 当前这一轮的状态：还在读、读完了、没理解出来。过去的轮次都已读完。 */
type Phase = "running" | "settled" | "failed";

/**
 * 对话栏：这次找人任务从第一句到现在的整条线程，底下是补充需求的输入框。
 *
 * 名单是产物，对话是操作面：产物占画布，操作面靠边常驻。一轮分两种声音——
 * 人说的话是靠右的一块气泡；模型的回应不加框、靠左铺开：先是检索人才库的
 * 过程（收成一行，点开看每一条结论），再是搜索条件因此怎么变了、替人定了什么
 * 读法、哪些要求没有采用。模型每一轮交回整张表，人不该去逐条比对前后两排 chip。
 * 直接在 chip 上改的一轮没有人说话，只在线程中间记一行改了什么。
 *
 * 线程就是记录链：过去的一轮底下有回到那一轮名单的链接，地址跟着变，浏览器后退
 * 照样是撤销；在那一轮上补充需求，就从那里分出新的一支。
 *
 * 等待和失败的**动作**不在这里：名单那一列在理解时给等待态、失败时给重试
 * （`result-state.tsx`），窄屏上这一栏收着时那边也看得见。这里只记这一轮走到哪了。
 */
export function Thread({
	rounds,
	onAdd,
	onQuery,
	waiting,
	understanding,
	composer,
	liveTrace = null,
	fault = null,
	autoFocus = false,
}: {
	/** 从链头到当前这一轮，链头在前。 */
	rounds: readonly Turn[];
	/** 当前这一轮还在理解时走到的步骤；理解落下后为 null，读记录上的。 */
	liveTrace?: TraceStep[] | null;
	/** 当前这一轮没理解出来时是哪一环坏了。 */
	fault?: InterpretFault | null;
	/** 把替代条件加进当前的条件表：派生一条新记录。 */
	onAdd: (conditions: Condition[]) => void;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 当前这一轮还没整理完：可以接着敲，先不能提交。 */
	waiting: boolean;
	/** 配了查询理解才有输入框；没配时线程只能看，条件在 chip 上改。 */
	understanding: boolean;
	composer?: React.Ref<QueryBarHandle>;
	autoFocus?: boolean;
}) {
	const last = rounds.length - 1;
	const current = rounds[last];
	const currentTrace = liveTrace ?? current?.trace ?? [];
	const phase: Phase = current?.spec ? "settled" : fault ? "failed" : "running";
	const list = useFollow(current?.id ?? "", `${phase}:${currentTrace.length}`);
	const offers =
		phase === "settled"
			? (current?.notes?.declined ?? []).filter((d) => d.instead.length > 0)
			: [];

	return (
		<section aria-label="对话" className="flex h-full flex-col">
			<ScrollArea overscrollContain>
				<ol className="flex flex-col gap-6 px-4 py-4" ref={list}>
					{rounds.map((round, i) => (
						<Round
							current={i === last}
							key={round.id}
							failure={i === last && fault ? FAULT_COPY[fault].title : null}
							phase={i === last ? phase : "settled"}
							previous={i > 0 ? (rounds[i - 1] ?? null) : null}
							round={round}
							trace={i === last ? currentTrace : (round.trace ?? [])}
						/>
					))}
				</ol>
			</ScrollArea>
			{(understanding || offers.length > 0) && (
				<div className="p-3 pt-1">
					{/* 贴着框的一块托盘：框上方放点一下就能办的事——搜不了的要求附带的替代
					    条件。它作用在当前的条件表上，所以只跟着当前这一轮，不留在历史里。 */}
					<Frame>
						{offers.length > 0 && (
							<ul aria-label="可以改为" className="flex flex-col px-2 py-1">
								{offers.map((item) => (
									<li
										className="flex items-center gap-2 text-xs"
										key={item.said}
									>
										<span className="min-w-0 flex-1 text-muted-foreground">
											「{item.said}」可改为：{inSentence(item.instead)}
										</span>
										<Button
											className="shrink-0"
											onClick={() => onAdd(item.instead)}
											size="xs"
											variant="ghost"
										>
											<PlusIcon />
											添加
										</Button>
									</li>
								))}
							</ul>
						)}
						{understanding && (
							<QueryBar
								autoFocus={autoFocus}
								onQuery={onQuery}
								placeholder="补充或修改需求，例如：最好带过团队"
								ref={composer}
								waiting={waiting}
							/>
						)}
					</Frame>
				</div>
			)}
		</section>
	);
}

function Round({
	round,
	previous,
	current,
	phase,
	failure,
	trace,
}: {
	round: Turn;
	previous: Turn | null;
	current: boolean;
	phase: Phase;
	/** 没理解出来时那一轮底下记一行：哪一环坏了，不是「这句话没读懂」。 */
	failure: string | null;
	trace: readonly TraceStep[];
}) {
	const { said, spec, notes } = round;
	// 当前这一轮不给链接：已经在它上面了
	const back = current ? null : <BackTo turnId={round.id} />;

	// 直接改条件的一轮没有人说话，也没有模型的回应：改动本身就是那一步
	if (said === null)
		return (
			<li
				aria-current={current ? "step" : undefined}
				className="flex flex-wrap items-center justify-center gap-x-2 text-center text-muted-foreground text-xs"
			>
				<span>{spec && editText(previous, spec.conditions)}</span>
				{back}
			</li>
		);

	return (
		<li
			aria-current={current ? "step" : undefined}
			className="flex flex-col gap-2 text-sm"
		>
			<p className="ms-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-xl bg-muted px-3.5 py-2">
				{said}
			</p>
			<div className="flex flex-col gap-1.5">
				{trace.length > 0 ? (
					<Process live={phase === "running"} steps={trace} />
				) : (
					phase === "running" && (
						<p className="shimmer w-fit text-xs" role="status">
							正在理解你的需求…
						</p>
					)
				)}
				{spec && <p>{replyText(previous, spec.conditions)}</p>}
				{notes?.assumed.map((line) => (
					<p className="text-muted-foreground" key={line}>
						{line}
					</p>
				))}
				{notes?.declined.map((item) => (
					<p className="text-warning-foreground" key={item.said}>
						未采用「{item.said}」：{item.why}
					</p>
				))}
				{failure && <p className="text-destructive-foreground">{failure}</p>}
				{back}
			</div>
		</li>
	);
}

/** 回到过去那一轮的结果：真链接，中键、右键、键盘都照常。 */
function BackTo({ turnId }: { turnId: string }) {
	return (
		<Button
			className="-ms-2 w-fit text-muted-foreground"
			render={<Link params={{ turnId }} search={{}} to="/s/$turnId" />}
			size="xs"
			variant="ghost"
		>
			查看这次的结果
		</Button>
	);
}

/**
 * 一步里的一行，说成结论：一个词在人才库里对应什么、多少人；一组条件预搜出多少人。
 * 查词一步查几个词就是几行。说的是找到了什么，不是调了什么——调了几次工具对人
 * 没有意义。
 */
type StepRow = { key: string; text: string };

function rowsOf(step: TraceStep): StepRow[] {
	if (step.tool === "look_up_words")
		return step.words.map((w) => ({
			key: `${step.at}:${w.word}`,
			text:
				w.canonical === null
					? `人才库中没有「${w.word}」`
					: [
							w.canonical === w.word
								? `「${w.word}」`
								: `「${w.word}」匹配到「${w.canonical}」`,
							`，${w.people} 人`,
							w.wide ? "，范围较大" : "",
						].join(""),
		}));
	return [
		{
			key: `${step.at}`,
			text: `预搜「${step.conditions.map(conditionLabel).join(" + ") || "不限"}」：${step.total} 人`,
		},
	];
}

/**
 * 检索人才库的过程，收成一行：进行中那几个字带一道流光，底下一行是刚得出的
 * 那条结论；完成后收成「检索过程」。点开是每一条结论一行，字降一档，和回应本身
 * 分开层。
 *
 * 开合只归人管：进行中不自动摊开，完成后不自动收起。
 */
function Process({
	steps,
	live,
}: {
	steps: readonly TraceStep[];
	live: boolean;
}) {
	const [open, setOpen] = useState(false);
	const rows = steps.flatMap(rowsOf);
	const latest = rows[rows.length - 1];

	return (
		<Collapsible onOpenChange={setOpen} open={open}>
			<CollapsibleTrigger
				render={
					<Button
						className="-ms-2 text-muted-foreground"
						size="xs"
						variant="ghost"
					>
						<span className={live ? "shimmer" : undefined}>
							{live ? "正在检索人才库…" : "检索过程"}
						</span>
						<ChevronRightIcon className="transition-transform [[data-panel-open]>&]:rotate-90" />
					</Button>
				}
			/>
			{live && !open && latest && (
				<p
					className="settle truncate text-muted-foreground text-xs"
					key={latest.key}
					role="status"
				>
					{latest.text}
				</p>
			)}
			<CollapsiblePanel>
				<ol className="mt-1 flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-muted-foreground text-xs tabular-nums">
					{rows.map((row) => (
						<li key={row.key}>{row.text}</li>
					))}
				</ol>
			</CollapsiblePanel>
		</Collapsible>
	);
}
