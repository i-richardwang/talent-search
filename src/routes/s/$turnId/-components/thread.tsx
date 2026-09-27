import { Link, useHydrated } from "@tanstack/react-router";
import {
	ArrowDownIcon,
	CheckIcon,
	EyeIcon,
	PencilLineIcon,
	PlusIcon,
	RotateCwIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Accordion } from "#/components/ui/accordion";
import { ActionIcon } from "#/components/ui/action-icon";
import { Alert } from "#/components/ui/alert";
import { Avatar } from "#/components/ui/avatar";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { CopyButton } from "#/components/ui/copy-button";
import { Divider } from "#/components/ui/divider";
import { Icon } from "#/components/ui/icon";
import { NeuralLoading } from "#/components/ui/neural-loading";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Tag } from "#/components/ui/tag";
import { Text } from "#/components/ui/text";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { conditionLabel, inSentence } from "#/search/condition-label";
import type { QueryInput } from "#/search/spec";
import { changesOf } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import type { InterpretFault, Turn } from "#/server/turn";
import { FAULT_COPY, FAULT_EXIT_LABEL } from "../-lib/interpret";

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

/** 一段时长写成几秒、几分几秒。 */
function lasting(ms: number) {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds} 秒`;
	return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 一轮的时刻怎么写：今天只写时分，今年写月日，更早写年月日；悬停的提示是完整的时刻。
 * 按浏览器的时区算，所以只在水合之后画。
 */
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

/**
 * 从 `since` 起过了多少毫秒，每秒更新一次；`active` 为假时停在 0。
 * 起点是记录落下的时刻，不是这一块画出来的时刻：刷新页面后照样从头接着数。
 */
function useElapsed(since: number, active: boolean) {
	const [elapsed, setElapsed] = useState(0);
	useEffect(() => {
		if (!active) {
			setElapsed(0);
			return;
		}
		const tick = () => setElapsed(Date.now() - since);
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [since, active]);
	return elapsed;
}

/** 等了这么久才补一个「（几秒）」：更短的等待不值得一个在跳的数。 */
const ELAPSED_SHOW_AFTER_MS = 2100;

/** 等待时跟在那句话后面的秒数，四级灰。 */
function Elapsed({ since }: { since: number }) {
	const elapsed = useElapsed(since, true);
	if (elapsed < ELAPSED_SHOW_AFTER_MS) return null;
	return (
		<Text className="shrink-0" type="quaternary">
			（{lasting(elapsed)}）
		</Text>
	);
}

/**
 * 离底多近算「在底下」：300px 以内。模型边跑边长出东西时，在底下就跟着滚；
 * 翻上去超过这个距离就不再拽人，右下角出现回到底部的按钮。
 */
const AT_BOTTOM_PX = 300;

/**
 * 线程跟着长：链上多了一轮就滚到底，人刚说的话不该藏在滚动条底下；最后一轮
 * 边跑边长出东西时，只有人本来就在底下才跟着滚，翻上去看过去的轮次时不拽回来。
 * 回头看早先那一轮的结果不算多了一轮，线程不动。
 *
 * 滚的是这一栏自己的视口，不用 `scrollIntoView`：那个会连外层一起滚，
 * 首帧能把整页顶走。
 *
 * @param growth 最后一轮长到哪了；它一变就重看一次要不要滚。
 */
function useFollow(latestId: string, growth: string) {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [atBottom, setAtBottom] = useState(true);
	const stuck = useRef(true);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const onScroll = () => {
			const near =
				viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <=
				AT_BOTTOM_PX;
			stuck.current = near;
			setAtBottom(near);
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

	const toBottom = () => {
		const viewport = viewportRef.current;
		viewport?.scrollTo({ behavior: "smooth", top: viewport.scrollHeight });
	};

	return { atBottom, toBottom, viewportRef };
}

/**
 * 换到哪一轮的结果，就把那一轮滚进视口并闪一下主色一侧的底（1400ms），
 * 人看得出名单换成了线程里的哪一次。首次画出时不闪：那是默认的样子。
 */
function useLocate(
	viewportRef: React.RefObject<HTMLDivElement | null>,
	viewing: string,
) {
	const shown = useRef(viewing);
	useEffect(() => {
		if (shown.current === viewing) return;
		shown.current = viewing;
		const viewport = viewportRef.current;
		const round = viewport?.querySelector<HTMLElement>(
			`[data-turn="${CSS.escape(viewing)}"]`,
		);
		if (!viewport || !round) return;
		const top = round.offsetTop;
		const bottom = top + round.offsetHeight;
		if (
			top < viewport.scrollTop ||
			bottom > viewport.scrollTop + viewport.clientHeight
		)
			viewport.scrollTo({ behavior: "smooth", top: Math.max(0, top - 8) });
		const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
		const lit = { background: "var(--color-primary-bg)" };
		const off = { background: "transparent" };
		round.animate(
			still
				? [lit, lit]
				: [off, { ...lit, offset: 0.15 }, { ...lit, offset: 0.55 }, off],
			{ duration: 1400, easing: "cubic-bezier(0.215, 0.61, 0.355, 1)" },
		);
	}, [viewing, viewportRef]);
}

/** 最后一轮的状态：还在读、读完了、没理解出来。之前的轮次都已读完。 */
type Phase = "running" | "settled" | "failed";

/**
 * 对话栏：这次找人任务从第一句到最后一句的整条线程，底下是补充需求的输入托盘。
 *
 * 名单是产物，对话是操作面：产物占画布，操作面靠边常驻。一轮是两条消息——
 * 人说的话靠右一块气泡；AI 的回应靠左，顶上是头像与名字，下面先是检索人才库的过程
 * （进行中摊开，完成后收成一行），再是搜索条件因此怎么变了、替人定了什么读法、
 * 哪些要求没有采用。正看着的那一轮，搜不了的要求附带的替代条件挂在回应底下，
 * 点一下就加进条件。直接在条件上改的一轮没有人说话，只在线程中间记一条带字的分隔线。
 *
 * 线程就是记录链，只往后长。消息的时刻和动作（复制、查看那一轮的结果）平时藏着，
 * 指针移到那条消息上才出现；名单跟着换到哪一轮，那一轮就闪一下。动作作用在正看着的
 * 条件上，新的一轮记在最后（`server/turn.ts` 的 `createTurn`）。
 *
 * 理解失败时最后一轮底下是一条提示，带重试；名单那一列另有同样的出路
 * （`result-state.tsx`），窄屏上这一栏收着时那边也看得见。
 */
export function Thread({
	rounds,
	viewing,
	onAdd,
	onQuery,
	onRetry,
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
	/** 再理解一次最后一轮；不给就没有重试钮。 */
	onRetry?: () => void;
	/** 最后一轮还没理解完：可以接着写，先不能提交。 */
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
	const { atBottom, toBottom, viewportRef } = useFollow(
		latest?.id ?? "",
		`${phase}:${latestTrace.length}`,
	);
	useLocate(viewportRef, viewing);
	const previewing = latest?.id !== viewing;

	return (
		<section aria-label="对话" className="flex h-full flex-col">
			<div className="relative min-h-0 flex-1">
				<ScrollArea
					className="size-full"
					disableContentFit
					viewportProps={{
						className: "data-has-overflow-y:overscroll-y-contain",
						ref: viewportRef,
					}}
				>
					<ol className="flex flex-col px-4 pt-2 pb-4">
						{rounds.map((round, i) => (
							<Round
								failure={i === last ? fault : null}
								key={round.id}
								mark={
									round.id !== viewing ? "link" : previewing ? "viewing" : null
								}
								onAdd={onAdd}
								onRetry={onRetry}
								phase={i === last ? phase : "settled"}
								previous={i > 0 ? (rounds[i - 1] ?? null) : null}
								round={round}
								trace={i === last ? latestTrace : (round.trace ?? [])}
							/>
						))}
					</ol>
				</ScrollArea>
				<ActionIcon
					className={cn(
						"absolute end-4 bottom-4 z-raise transition-[opacity,translate] duration-200 ease-out",
						atBottom && "pointer-events-none translate-y-4 opacity-0",
					)}
					glass
					icon={ArrowDownIcon}
					onClick={toBottom}
					style={{ borderRadius: "50%" }}
					tabIndex={atBottom ? -1 : undefined}
					title="跳转到最新"
					variant="outlined"
				/>
			</div>
			{understanding && (
				<div className="flex-none px-3 pb-3">
					<QueryBar
						autoFocus={autoFocus}
						focusKey="/"
						onQuery={onQuery}
						placeholder="补充或修改需求，例如：最好带过团队"
						ref={composer}
						waiting={waiting}
					/>
				</div>
			)}
		</section>
	);
}

/**
 * 一条消息的时刻与动作平时藏着，指针移进这条消息、焦点落进来时淡入（200ms）；
 * 没有悬停的设备上常显，否则摸不到。
 */
const REVEAL =
	"pointer-events-none opacity-0 transition-opacity duration-200 ease-out group-hover/message:pointer-events-auto group-hover/message:opacity-100 group-focus-within/message:pointer-events-auto group-focus-within/message:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100";

/** 一轮落下的时刻，12px 次要色，悬停才出现；水合之前留着同样的高度。 */
function Clock({ at }: { at: number }) {
	const hydrated = useHydrated();
	const clock = hydrated ? clockOf(at) : null;
	return (
		<Text
			className={cn("min-h-5 whitespace-nowrap", REVEAL)}
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

/** 一条消息底下的一组图标动作：浅灰底里一排小号图标按钮。 */
function Actions({ children }: { children: ReactNode }) {
	return (
		<Block
			align="center"
			className={cn("w-fit rounded-sm", REVEAL)}
			horizontal
			padding={2}
			role="menubar"
		>
			{children}
		</Block>
	);
}

/** 查看那一轮的结果：真链接，中键、右键、键盘都照常。 */
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
	mark,
	phase,
	failure,
	trace,
	onAdd,
	onRetry,
}: {
	round: Turn;
	previous: Turn | null;
	/**
	 * 这一轮的记号：别的轮次带查看结果的链接；正看着的一轮不是最后一轮时
	 * 标出来，是最后一轮就什么都不标——那是默认的样子。
	 */
	mark: "link" | "viewing" | null;
	phase: Phase;
	/** 没理解出来时哪一环坏了，不是「这句话没读懂」。 */
	failure: InterpretFault | null;
	trace: readonly TraceStep[];
	onAdd: (conditions: Condition[]) => void;
	onRetry?: () => void;
}) {
	const { said, spec, notes } = round;
	const viewing = mark !== "link";
	const viewingTag = mark === "viewing" && <Tag size="small">正在查看</Tag>;
	const link = mark === "link" && <ViewResult turnId={round.id} />;

	// 直接改条件的一轮没有人说话，也没有 AI 的回应：线程中间一条带字的分隔线
	if (said === null)
		return (
			<li
				aria-current={viewing ? "page" : undefined}
				className="group/message rounded-lg"
				data-turn={round.id}
			>
				<Divider className="my-0 py-5">
					<span className="flex min-w-0 items-center gap-1">
						<Tag className="min-w-0 whitespace-normal" icon={PencilLineIcon}>
							{spec && editText(previous, spec.conditions)}
						</Tag>
						{viewingTag}
						{link && <Actions>{link}</Actions>}
					</span>
				</Divider>
			</li>
		);

	const offers =
		mark !== "link" && phase === "settled"
			? (notes?.declined ?? []).filter((d) => d.instead.length > 0)
			: [];

	return (
		<li
			aria-current={viewing ? "page" : undefined}
			className="flex flex-col rounded-lg"
			data-turn={round.id}
		>
			{/* 人说的话：靠右一块气泡，左边让出 36px，头上是时刻，底下是复制 */}
			<div className="group/message flex flex-col items-end gap-2 py-2 ps-9">
				<Clock at={round.at} />
				<p className="max-w-full whitespace-pre-wrap break-words rounded-lg bg-fill-tertiary px-3 py-2">
					{said}
				</p>
				<Actions>
					<CopyButton content={said} glass={false} size="small" />
				</Actions>
			</div>
			<div className="group/message flex flex-col gap-2 py-2">
				<div className="flex items-center gap-2">
					<Avatar background="var(--color-primary)" size={28} title="AI" />
					<Text className="whitespace-nowrap" weight="medium">
						AI
					</Text>
					<Clock at={lastStepAt(round.at, trace)} />
				</div>
				<div className="flex w-full min-w-0 flex-col gap-2">
					{trace.length > 0 ? (
						<Process
							live={phase === "running"}
							since={round.at}
							steps={trace}
						/>
					) : (
						phase === "running" && (
							<p className="flex items-center gap-1" role="status">
								<Text shiny type="secondary">
									正在理解你的需求…
								</Text>
								<Elapsed since={round.at} />
							</p>
						)
					)}
					{spec && <p>{replyText(previous, spec.conditions)}</p>}
					{notes?.assumed.map((line) => (
						<Text as="p" key={line} type="secondary">
							{line}
						</Text>
					))}
					{notes?.declined.map((item) => (
						<Declined key={item.said} said={item.said} why={item.why} />
					))}
					{failure && <Fault fault={failure} onRetry={onRetry} />}
				</div>
				{offers.length > 0 && <FollowUps offers={offers} onAdd={onAdd} />}
				{(link || viewingTag) && (
					<div className="flex items-center gap-1">
						{viewingTag}
						{link && <Actions>{link}</Actions>}
					</div>
				)}
			</div>
		</li>
	);
}

/** AI 回应的时刻：最后一步落下的时候；没走过步骤就是那一轮落下的时候。 */
function lastStepAt(at: number, trace: readonly TraceStep[]) {
	return trace[trace.length - 1]?.at ?? at;
}

/** 没采用的一条要求：amber 的警示三角，后面一句次要色的话，原因再降一档。 */
function Declined({ said, why }: { said: string; why: string }) {
	return (
		<p className="flex items-start gap-2 px-1.5 py-2">
			<Icon
				aria-hidden="true"
				className="mt-[3px] shrink-0 text-warning"
				icon={TriangleAlertIcon}
				size={16}
			/>
			<span className="min-w-0">
				<Text type="secondary">未采用「{said}」：</Text>
				<Text size="xs" type="tertiary">
					{why}
				</Text>
			</span>
		</p>
	);
}

/**
 * 最后一轮没理解出来：一条描边的提示说哪一环坏了，能重试的带一个重试钮。
 * 按下之后到这一轮重新进入理解之前，钮停在等待态，免得被连按两次。
 */
function Fault({
	fault,
	onRetry,
}: {
	fault: InterpretFault;
	onRetry?: () => void;
}) {
	const [retrying, setRetrying] = useState(false);
	const copy = FAULT_COPY[fault];
	return (
		<Alert
			action={
				copy.retry &&
				onRetry && (
					<Button
						disabled={retrying}
						icon={<RotateCwIcon size={14} />}
						loading={retrying}
						onClick={() => {
							setRetrying(true);
							onRetry();
						}}
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
 * 搜不了的要求附带的替代条件：正看着的那一轮回应底下一列，点一下就加进这一轮的
 * 条件表，记成新的一轮。一枚一枚从下往上浮出来，前后错开 60ms。
 */
function FollowUps({
	offers,
	onAdd,
}: {
	offers: { said: string; instead: Condition[] }[];
	onAdd: (conditions: Condition[]) => void;
}) {
	return (
		<ul aria-label="可以改为" className="mt-2 flex max-w-115 flex-col gap-1.5">
			{offers.map((item, i) => (
				<li key={item.said}>
					<button
						className="group/offer inline-flex cursor-pointer items-center gap-2 rounded-md bg-fill-tertiary py-[7px] ps-2.5 pe-3.5 text-left text-sm transition-[opacity,translate,background-color] duration-320 ease-snap hover:bg-fill-secondary starting:translate-y-2 starting:opacity-0"
						onClick={() => onAdd(item.instead)}
						style={{ transitionDelay: `${i * 60}ms, ${i * 60}ms, 0ms` }}
						type="button"
					>
						<Icon
							aria-hidden="true"
							className="shrink-0 opacity-55 transition-[opacity,color] duration-150 group-hover/offer:text-primary group-hover/offer:opacity-100"
							icon={PlusIcon}
							size={14}
						/>
						<span>
							把「{item.said}」换成 {inSentence(item.instead)}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

/**
 * 一步做了什么，说成动作和对象：查找几个说法、按一组条件预搜。
 * 说的是找了什么，不是调了什么——调的是哪样东西对人没有意义。
 */
function stepTitle(step: TraceStep) {
	if (step.tool === "look_up_words")
		return {
			action: "查找",
			keyword: step.words.map((w) => w.word).join("、"),
		};
	return {
		action: "预搜",
		keyword: step.conditions.map(conditionLabel).join(" + ") || "不限",
	};
}

/** 查找的每个说法在人才库里对应什么、多少人。 */
function wordLine(w: {
	word: string;
	canonical: string | null;
	people: number;
	wide: boolean;
}) {
	if (w.canonical === null) return `人才库中没有「${w.word}」`;
	return [
		w.canonical === w.word
			? `「${w.word}」`
			: `「${w.word}」匹配到「${w.canonical}」`,
		`，${w.people} 人`,
		w.wide ? "，范围较大" : "",
	].join("");
}

/** 行首 24px 的状态格：进行中是在跑的网，完成是绿色的对勾。 */
function StatusCell({ live }: { live: boolean }) {
	return (
		<Block
			align="center"
			className="shrink-0"
			height={24}
			horizontal
			justify="center"
			variant="outlined"
			width={24}
		>
			{live ? (
				<NeuralLoading size={16} />
			) : (
				<Icon
					aria-hidden="true"
					className="text-success"
					icon={CheckIcon}
					size={12}
				/>
			)}
		</Block>
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
 * 检索人才库的过程，一项手风琴：标题行首一枚状态格，箭头紧跟在字后。
 *
 * - 进行中默认摊开，标题是「检索人才库 N 步」带流光；人把它收起来时，标题换成正在做的
 *   那一步，换字时旧的向上淡出、新的从下面升上来（200ms），两秒之后跟上已等了多久。
 * - 完成后自动收起（人在进行中亲手点开过的除外），标题是步数与用时。
 * - 摊开是每一步一行：状态格、动作、对象，预搜的行尾是人数；查找的每个说法各一行结论。
 */
function Process({
	steps,
	live,
	since,
}: {
	steps: readonly TraceStep[];
	live: boolean;
	/** 这一轮落下的时刻：进行中的计时和完成后的用时都从它算。 */
	since: number;
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
	const took = latest ? latest.at - since : 0;

	const title = (
		<span className="flex min-w-0 items-center gap-1.5">
			<StatusCell live={live} />
			{live ? (
				<span className="flex min-h-[22px] min-w-0 items-center gap-1.5">
					<span className="relative min-w-0 overflow-hidden">
						<AnimatePresence initial={false} mode="popLayout">
							<motion.span
								animate={{ opacity: 1, y: 0 }}
								className="flex min-h-[22px] items-center"
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
					<Elapsed since={since} />
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
			classNames={{ trigger: "p-1" }}
			indicatorPlacement="inline"
			items={[
				{
					children: (
						<ol className="flex flex-col gap-2 pt-1 pb-2">
							{steps.map((step) => (
								<StepRow key={step.at} step={step} />
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
			variant="borderless"
		/>
	);
}

/** 摊开后的一步：状态格、动作、对象；预搜的行尾是人数，查找的每个说法各一行结论。 */
function StepRow({ step }: { step: TraceStep }) {
	const { action, keyword } = stepTitle(step);
	return (
		<li className="flex flex-col gap-1 px-1">
			<span className="flex min-w-0 items-center gap-2">
				<StatusCell live={false} />
				<Text className="shrink-0" type="tertiary">
					{action}
				</Text>
				<Text code ellipsis size="xs" type="tertiary">
					{keyword}
				</Text>
				{step.tool === "try_conditions" && (
					<Text
						className="shrink-0 tabular-nums"
						code
						size="xs"
						type="tertiary"
					>
						→ {step.total} 人
					</Text>
				)}
			</span>
			{step.tool === "look_up_words" &&
				step.words.map((w) => (
					<Text
						as="p"
						className="ps-8 tabular-nums"
						key={w.word}
						size="xs"
						type="tertiary"
					>
						{wordLine(w)}
					</Text>
				))}
		</li>
	);
}
