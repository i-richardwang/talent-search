import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { QueryBar, type QueryBarHandle } from "#/components/query-bar";
import { Button } from "#/components/ui/button";
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { ScrollArea } from "#/components/ui/scroll-area";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { conditionLabel, MODE_GLYPH } from "#/search/condition-label";
import type { QueryInput } from "#/search/spec";
import { changesOf } from "#/search/spec";
import type { TraceStep } from "#/search/trace";
import type { Turn } from "#/server/turn";

/** 一条条件写进一句话里的样子：强度符号加标签，和 chip 上的读法一致。 */
function named(list: readonly Condition[]) {
	return list.map((c) => MODE_GLYPH[c.mode] + conditionLabel(c)).join("、");
}

/**
 * 一轮把条件表改成了什么样。链头没有上一轮，说的是整张表；后面每一轮说加了
 * 什么、去掉了什么。模型丢掉一条用户要的条件，在这里就是一行看得见的字。
 */
function changeText(previous: Turn | null, spec: Condition[]) {
	if (previous === null) return named(spec);
	const { added, removed } = changesOf(previous.spec?.conditions ?? [], spec);
	if (added.length === 0 && removed.length === 0) return "条件没有变化";
	return [
		added.length > 0 ? `加上 ${named(added)}` : null,
		removed.length > 0 ? `去掉 ${named(removed)}` : null,
	]
		.filter((part) => part !== null)
		.join("，");
}

/** 离底多近算「跟在底下」：比一行字矮，人只要往上翻过一行就不再拽他。 */
const STUCK_PX = 8;

/**
 * 线程跟着长：换了一轮就滚到底，人刚说的话不该藏在滚动条底下；当前这一轮
 * 边跑边长出步骤时，只有人本来就看着底下才跟着滚，翻上去看过去的轮次时不拽回来。
 *
 * 滚的是这一栏自己的视口，不用 `scrollIntoView`：那个会连外层一起滚，
 * 首帧能把整页顶走。
 */
function useFollow(turnId: string, length: number) {
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

	// 换轮次强制到底；同一轮长出步骤只在跟着底下时到底
	const seen = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: 长出一步就要重看一次
	useLayoutEffect(() => {
		if (seen.current !== turnId) {
			seen.current = turnId;
			stuck.current = true;
		}
		const viewport = list.current?.closest<HTMLElement>(
			'[data-slot="scroll-area-viewport"]',
		);
		if (viewport && stuck.current) viewport.scrollTop = viewport.scrollHeight;
	}, [turnId, length]);

	return list;
}

/**
 * 对话栏：这次找人任务从第一句到现在的整条线程，底下是接着说的框。
 *
 * 名单是产物，对话是操作面：产物占画布，操作面靠边常驻。线程里每一轮是
 * 「我说了什么」和「条件因此怎么变了」——模型每一轮交回整张表，人不该去逐条
 * 比对前后两排 chip，加了什么、去掉了什么、替人定了什么读法、什么搜不了，
 * 都写在那一轮底下。直接在 chip 上改的一轮没有说话，只记那一步改了什么。
 *
 * 线程就是记录链：过去的一轮那句话是链接，点它画布切到那一轮的名单，地址跟着变，
 * 浏览器后退照样是撤销；从那里接着说就从那里分出新的一支。搜不了的要求附带的替代条件只在
 * 当前这一轮给「加上」——它作用在当前的条件表上，过去的一轮上按下去改的是别的表。
 *
 * 模型交表之前用工具查词、试搜的每一步（`search/trace.ts`）画在那一轮底下：
 * 当前这一轮边跑边长出来（`liveTrace`，由 `useInterpretation` 轮询），过去的
 * 轮次收起来，点开才看。等待和失败不在这里画：整理条件时名单那一列已经在说
 * 「正在整理」，失败挂在吸顶那条底下（`query-deck.tsx`），两处在窄屏上都看得见，
 * 这一栏那时可能收着。
 */
export function Thread({
	rounds,
	onAdd,
	onQuery,
	waiting,
	understanding,
	composer,
	liveTrace = null,
	autoFocus = false,
}: {
	/** 从链头到当前这一轮，链头在前。 */
	rounds: readonly Turn[];
	/** 当前这一轮还在理解时走到的步骤；理解落下后为 null，读记录上的。 */
	liveTrace?: TraceStep[] | null;
	/** 把替代条件加进当前的条件表：派生一条新记录。 */
	onAdd: (conditions: Condition[]) => void;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	/** 当前这一轮还没整理完：可以接着敲，先不能提交。 */
	waiting: boolean;
	/** 配了查询理解才有接着说的框；没配时线程只能看，条件在 chip 上改。 */
	understanding: boolean;
	composer?: React.Ref<QueryBarHandle>;
	autoFocus?: boolean;
}) {
	const last = rounds.length - 1;
	const current = rounds[last];
	const currentTrace = liveTrace ?? current?.trace ?? [];
	const list = useFollow(current?.id ?? "", currentTrace.length);

	return (
		<section aria-label="对话" className="flex h-full flex-col">
			<ScrollArea overscrollContain>
				<ol className="flex flex-col gap-1 px-2 py-3" ref={list}>
					{rounds.map((round, i) => (
						<Round
							current={i === last}
							key={round.id}
							onAdd={onAdd}
							previous={i > 0 ? (rounds[i - 1] ?? null) : null}
							round={round}
							trace={i === last ? currentTrace : (round.trace ?? [])}
						/>
					))}
				</ol>
			</ScrollArea>
			{understanding && (
				<div className="border-border border-t p-3">
					<QueryBar
						autoFocus={autoFocus}
						onQuery={onQuery}
						placeholder="接着说：加条件、改条件、去掉条件"
						ref={composer}
						waiting={waiting}
					/>
				</div>
			)}
		</section>
	);
}

function Round({
	round,
	previous,
	current,
	onAdd,
	trace,
}: {
	round: Turn;
	previous: Turn | null;
	current: boolean;
	onAdd: (conditions: Condition[]) => void;
	trace: readonly TraceStep[];
}) {
	const { said, spec, notes } = round;
	const change = spec ? changeText(previous, spec.conditions) : null;
	const assumed = notes?.assumed ?? [];
	const declined = notes?.declined ?? [];

	// 说了话的一轮先复述那句话；直接改条件的一轮没有话，改动本身就是那一步
	const head = said ?? change;

	/*
	 * 过去的一轮：那句话是回到那一轮名单的文字链接，别的都是字。链接只包那一行——
	 * 过程的折叠按钮、当前轮的「加上」都是动作，动作不能住在链接里。
	 * 当前这一轮不是链接：已经在它上面了。
	 */
	return (
		<li
			aria-current={current ? "step" : undefined}
			className={cn(
				"flex flex-col gap-1 rounded-md px-3 py-2 text-sm",
				current && "bg-muted",
			)}
		>
			{current ? (
				<p className="font-medium">{head}</p>
			) : (
				<p className="font-medium">
					<Link
						className="rounded-xs hover:underline focus-visible:outline-2 focus-visible:outline-ring"
						params={{ turnId: round.id }}
						search={{}}
						to="/s/$turnId"
					>
						{head}
					</Link>
				</p>
			)}
			{trace.length > 0 && <Steps live={current} steps={trace} />}
			{said !== null && change && (
				<p className="text-muted-foreground">{change}</p>
			)}
			{assumed.map((line) => (
				<p className="text-muted-foreground" key={line}>
					{line}
				</p>
			))}
			{declined.map((item) => (
				<p className="flex flex-wrap items-baseline gap-x-2" key={item.said}>
					<span className="text-warning-foreground">
						「{item.said}」搜不了：{item.why}
					</span>
					{current && item.instead.length > 0 && (
						<Button
							onClick={() => onAdd(item.instead)}
							size="xs"
							variant="link"
						>
							<PlusIcon />
							加上 {named(item.instead)}
						</Button>
					)}
				</p>
			))}
		</li>
	);
}

/**
 * 一轮里模型走过的步骤。当前这一轮摊开：人在等的就是它一步步长出来；
 * 过去的轮次收成一行「过程 · N 步」，结论已经在底下，过程点开才看。
 */
function Steps({
	steps,
	live,
}: {
	steps: readonly TraceStep[];
	live: boolean;
}) {
	const list = (
		<ol className="flex flex-col gap-0.5 text-muted-foreground text-xs">
			{steps.map((step) => (
				<li key={step.at}>{stepText(step)}</li>
			))}
		</ol>
	);
	if (live) return list;
	return (
		<Collapsible>
			<CollapsibleTrigger
				render={
					<Button className="-ms-2" size="xs" variant="ghost">
						<ChevronRightIcon className="transition-transform [[data-panel-open]>&]:rotate-90" />
						过程 · {steps.length} 步
					</Button>
				}
			/>
			<CollapsiblePanel>{list}</CollapsiblePanel>
		</Collapsible>
	);
}

/** 一步说成一句：查了什么、得到什么。 */
function stepText(step: TraceStep) {
	if (step.tool === "look_up_words")
		return `查词：${step.words
			.map((w) => {
				const how = w.canonical === null ? "词表里没有" : `${w.people} 人`;
				const as =
					w.canonical && w.canonical !== w.word ? `→${w.canonical}` : "";
				return `${w.word}${as}（${how}${w.wide ? "，太宽" : ""}）`;
			})
			.join("、")}`;
	const what = named(step.conditions) || "空表";
	return `试搜：${what} → ${step.total > 0 ? `${step.total} 人` : "没有人"}`;
}
