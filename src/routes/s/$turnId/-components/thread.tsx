import { Link } from "@tanstack/react-router";
import { CheckIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Icon } from "#/components/ui/icon";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Tag } from "#/components/ui/tag";
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
 * 线程跟着长：链上多了一轮就滚到底，人刚说的话不该藏在滚动条底下；最后一轮
 * 边跑边长出东西时，只有人本来就看着底下才跟着滚，翻上去看过去的轮次时不拽回来。
 * 回头看早先那一轮的结果不算多了一轮，线程不动。
 *
 * 滚的是这一栏自己的视口，不用 `scrollIntoView`：那个会连外层一起滚，
 * 首帧能把整页顶走。
 *
 * @param growth 最后一轮长到哪了；它一变就重看一次要不要滚。
 */
function useFollow(latestId: string, growth: string) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const stuck = useRef(true);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const onScroll = () => {
			stuck.current =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <
				STUCK_PX;
		};
		viewport.addEventListener("scroll", onScroll, { passive: true });
		return () => viewport.removeEventListener("scroll", onScroll);
	}, []);

	// 多了一轮强制到底；同一轮长出东西只在跟着底下时到底
	const seen = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 长出一点就要重看一次
	useLayoutEffect(() => {
		if (seen.current !== latestId) {
			seen.current = latestId;
			stuck.current = true;
		}
		const viewport = viewportRef.current;
		if (viewport && stuck.current) viewport.scrollTop = viewport.scrollHeight;
	}, [latestId, growth]);

	return viewportRef;
}

/** 最后一轮的状态：还在读、读完了、没理解出来。之前的轮次都已读完。 */
type Phase = "running" | "settled" | "failed";

/**
 * 对话栏：这次找人任务从第一句到最后一句的整条线程，底下是补充需求的输入托盘，
 * 搜不了的要求附带的替代条件挂在托盘上沿。
 *
 * 名单是产物，对话是操作面：产物占画布，操作面靠边常驻。一轮分两种声音——
 * 人说的话是靠右的一块气泡；模型的回应不加框、靠左铺开：先是检索人才库的
 * 过程（收成一行，点开看每一条结论），再是搜索条件因此怎么变了、替人定了什么
 * 读法、哪些要求没有采用。模型每一轮交回整张表，人不该去逐条比对前后两排 chip。
 * 直接在 chip 上改的一轮没有人说话，只在线程中间记一行改了什么。
 *
 * 线程就是记录链，只往后长。每一轮底下有查看那一轮结果的链接，名单跟着换，
 * 线程不变；正看着的那一轮标出来。动作作用在正看着的条件上，新的一轮记在最后
 * （`server/turn.ts` 的 `createTurn`）。
 *
 * 等待和失败的**动作**不在这里：名单那一列在理解时给等待态、失败时给重试
 * （`result-state.tsx`），窄屏上这一栏收着时那边也看得见。这里只记最后一轮走到哪了。
 */
export function Thread({
	rounds,
	viewing,
	onAdd,
	onQuery,
	waiting,
	understanding,
	composer,
	liveTrace = null,
	fault = null,
	autoFocus = false,
}: {
	/** 整条链，链头在前。 */
	rounds: readonly Turn[];
	/** 名单正显示的那一轮。 */
	viewing: string;
	/** 最后一轮还在理解时走到的步骤；理解落下后为 null，读记录上的。 */
	liveTrace?: TraceStep[] | null;
	/** 最后一轮没理解出来时是哪一环坏了。 */
	fault?: InterpretFault | null;
	/** 把替代条件加进正看着的条件表：记成新的一轮。 */
	onAdd: (conditions: Condition[]) => void;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 最后一轮还没理解完：可以接着敲，先不能提交。 */
	waiting: boolean;
	/** 配了查询理解才有输入框；没配时线程只能看，条件在 chip 上改。 */
	understanding: boolean;
	composer?: React.Ref<QueryBarHandle>;
	autoFocus?: boolean;
}) {
	const last = rounds.length - 1;
	const latest = rounds[last];
	const latestTrace = liveTrace ?? latest?.trace ?? [];
	const phase: Phase = latest?.spec ? "settled" : fault ? "failed" : "running";
	const viewportRef = useFollow(
		latest?.id ?? "",
		`${phase}:${latestTrace.length}`,
	);
	const previewing = latest?.id !== viewing;
	const offers = (
		rounds.find((round) => round.id === viewing && round.spec)?.notes
			?.declined ?? []
	).filter((d) => d.instead.length > 0);

	return (
		<section aria-label="对话" className="flex h-full flex-col">
			<ScrollArea
				className="min-h-0 flex-1"
				disableContentFit
				viewportProps={{
					className: "data-has-overflow-y:overscroll-y-contain",
					ref: viewportRef,
				}}
			>
				<ol className="flex flex-col gap-4 px-4 pt-2 pb-4">
					{rounds.map((round, i) => (
						<Round
							failure={i === last && fault ? FAULT_COPY[fault].title : null}
							key={round.id}
							mark={
								round.id !== viewing ? "link" : previewing ? "viewing" : null
							}
							phase={i === last ? phase : "settled"}
							previous={i > 0 ? (rounds[i - 1] ?? null) : null}
							round={round}
							trace={i === last ? latestTrace : (round.trace ?? [])}
						/>
					))}
				</ol>
			</ScrollArea>
			{understanding ? (
				<div className="flex-none px-3 pb-3">
					<QueryBar
						autoFocus={autoFocus}
						onQuery={onQuery}
						placeholder="补充或修改需求，例如：最好带过团队"
						ref={composer}
						tray={offers.length > 0 && <Offers offers={offers} onAdd={onAdd} />}
						waiting={waiting}
					/>
				</div>
			) : (
				offers.length > 0 && (
					<div className="flex-none px-3 pb-3">
						<Block paddingBlock={8} paddingInline={14}>
							<Offers offers={offers} onAdd={onAdd} />
						</Block>
					</div>
				)
			)}
		</section>
	);
}

/**
 * 搜不了的要求附带的替代条件，点一下就加进正看着的那一轮的条件表。它作用在输入框
 * 将要说的那句话之前，所以挂在输入托盘的上沿。
 */
function Offers({
	offers,
	onAdd,
}: {
	offers: { said: string; instead: Condition[] }[];
	onAdd: (conditions: Condition[]) => void;
}) {
	return (
		<ul aria-label="可以改为" className="flex flex-col gap-1">
			{offers.map((item) => (
				<li className="flex items-center gap-2 text-xs" key={item.said}>
					<span className="min-w-0 flex-1 text-fg-secondary">
						「{item.said}」可改为：{inSentence(item.instead)}
					</span>
					<Button
						className="shrink-0"
						icon={PlusIcon}
						onClick={() => onAdd(item.instead)}
						size="small"
						type="text"
					>
						添加
					</Button>
				</li>
			))}
		</ul>
	);
}

function Round({
	round,
	previous,
	mark,
	phase,
	failure,
	trace,
}: {
	round: Turn;
	previous: Turn | null;
	/**
	 * 这一轮底下的记号：别的轮次给查看结果的链接；正看着的一轮不是最后一轮时
	 * 标出来，是最后一轮就什么都不标——那是默认的样子。
	 */
	mark: "link" | "viewing" | null;
	phase: Phase;
	/** 没理解出来时那一轮底下记一行：哪一环坏了，不是「这句话没读懂」。 */
	failure: string | null;
	trace: readonly TraceStep[];
}) {
	const { said, spec, notes } = round;
	const viewing = mark !== "link";
	const footer =
		mark === "link" ? (
			<ViewResult turnId={round.id} />
		) : mark === "viewing" ? (
			<Tag size="small">正在查看</Tag>
		) : null;

	// 直接改条件的一轮没有人说话，也没有模型的回应：改动本身就是那一步
	if (said === null)
		return (
			<li
				aria-current={viewing ? "page" : undefined}
				className="flex flex-wrap items-center justify-center gap-x-2 text-center text-fg-secondary text-xs"
			>
				<span>{spec && editText(previous, spec.conditions)}</span>
				{footer}
			</li>
		);

	return (
		<li
			aria-current={viewing ? "page" : undefined}
			className="flex flex-col gap-4 text-base"
		>
			<p className="ms-auto w-fit max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-fill-tertiary px-3 py-2">
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
					<p className="text-fg-secondary" key={line}>
						{line}
					</p>
				))}
				{notes?.declined.map((item) => (
					<p className="text-warning" key={item.said}>
						未采用「{item.said}」：{item.why}
					</p>
				))}
				{failure && <p className="text-error">{failure}</p>}
				{footer}
			</div>
		</li>
	);
}

/** 查看那一轮的结果：真链接，中键、右键、键盘都照常。 */
function ViewResult({ turnId }: { turnId: string }) {
	return (
		<Button
			className="w-fit text-fg-secondary"
			outdent
			render={<Link params={{ turnId }} search={{}} to="/s/$turnId" />}
			size="small"
			type="text"
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
 * 检索人才库的过程，收成一行：行首一枚 24px 的状态格（进行中转圈，完成打勾），
 * 进行中那几个字带一道流光，底下一行是刚得出的那条结论；完成后收成「检索过程」。
 * 点开是每一条结论一行，字降一档，和回应本身分开层。
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
	const panelId = useId();
	const rows = steps.flatMap(rowsOf);
	const latest = rows[rows.length - 1];

	return (
		<div>
			{/* 整行是开关：状态方块、那句话和箭头。状态方块贴着左沿，所以四周一样留 4px */}
			<CollapsibleTrigger
				className="w-fit gap-1.5 p-1 text-fg-secondary"
				onOpenChange={setOpen}
				open={open}
				panelId={panelId}
			>
				<Block
					align="center"
					className="shrink-0"
					height={24}
					horizontal
					justify="center"
					variant="outlined"
					width={24}
				>
					<Icon
						aria-hidden="true"
						className={live ? "text-fg-tertiary" : "text-success"}
						icon={live ? Loader2Icon : CheckIcon}
						size={12}
						spin={live}
					/>
				</Block>
				<span className={live ? "shimmer" : undefined}>
					{live ? "正在检索人才库…" : "检索过程"}
				</span>
			</CollapsibleTrigger>
			{live && !open && latest && (
				<p
					className="settle truncate ps-8.5 text-fg-secondary text-xs"
					key={latest.key}
					role="status"
				>
					{latest.text}
				</p>
			)}
			<Collapsible id={panelId} open={open}>
				<ol className="flex flex-col gap-1 ps-8.5 pt-1 pb-3 text-fg-secondary text-xs tabular-nums">
					{rows.map((row) => (
						<li key={row.key}>{row.text}</li>
					))}
				</ol>
			</Collapsible>
		</div>
	);
}
