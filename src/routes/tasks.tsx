import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardFrame,
	CardFrameAction,
	CardFrameHeader,
	CardFrameTitle,
	CardPanel,
} from "#/components/ui/card";
import {
	Collapsible,
	CollapsiblePanel,
	CollapsibleTrigger,
} from "#/components/ui/collapsible";
import { ScrollArea } from "#/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { TaskKind } from "#/db/schema";
import { dots } from "#/lib/format";
import { requestTask, tasksStatus } from "#/server/functions";
import type { JobKind } from "#/server/jobs";
import type { CorpusCounts, TaskLane, TaskRunView } from "#/server/tasks";
import { AdminPage } from "./-components/admin-page";
import { StatusBadge, type StatusTone } from "./-components/status-badge";

const NAME: Record<TaskKind, string> = {
	sync: "同步",
	derive: "解析",
	review: "整理",
};

/**
 * 任务台：语料侧三种任务各自管着多少东西、上一次怎么样、还剩多少活。
 *
 * 同步是外面按节奏跑的脚本（`bun run sync`），派生和整理是应用自己持续在做的
 * 后台工作（`src/server/jobs.ts`）；三者都落成 `task_run` 的行。派生和整理可以
 * 从这里「现在跑一次」，同步不行——它读的是别处的数据，什么时候读由外面定。
 *
 * **屏幕上是此刻的语料，不是一份终端回放。** 每张卡片上那一行数问的是库
 * （`corpusCounts`），不是上一次跑的记录：一次运行说过的「人群 20 人」是那一刻的
 * 快照，跑完就开始过期，照着它报数等于在屏幕上留一个没人维护的旧值。上千行的过程
 * 收在每张卡片自己的折叠里，要排查的时候才展开。
 *
 * 三栏竖着排，一栏一张卡片，管着这一栏的全部事——节奏、此刻怎么样、库里有多少、
 * 它自己的「现在跑一次」，以及展开来的过程。三张同时在场才叫一块板：要点开才知道
 * 哪一栏出了事，就等于没有板；也因此没有切换，卡片不可点。
 *
 * 卡片的排法照 coss 文档站首页那种展示卡：`CardFrame` 托盘上是抬头（名字、节奏、
 * 右侧一个动作），托盘里嵌着一块 `Card` 装内容，外面再落一圈离开 5px 的发丝线。
 */
export const Route = createFileRoute("/tasks")({
	loader: () => tasksStatus(),
	head: () => ({ meta: [{ title: "任务 · 人才搜索" }] }),
	component: Tasks,
});

/** 有任务在跑时多久重新取一次状态；没有的时候慢一些——后台随时可能自己开一轮。 */
const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 10_000;

/**
 * 一行记录在这一页上说成什么。
 *
 * 判成哪一种不在这一侧——那要问「此刻锁在谁手上」，只有服务端答得了
 * （`src/server/tasks.ts`）。这里只把它译成字。
 */
const SAID: Record<TaskRunView["outcome"], string> = {
	running: "正在跑",
	interrupted: "中断，没有跑完",
	failed: "失败了",
	done: "成功",
};

const TONE: Record<TaskRunView["outcome"], StatusTone> = {
	running: "running",
	interrupted: "waiting",
	failed: "error",
	done: "success",
};

/**
 * 这一栏此刻要不要报一声，报哪一种：正在跑的，和没跑完的。
 *
 * 成功不报——常态不发徽章，三张卡片上三块一模一样的绿等于没有信息，而这块板
 * 真正要人看见的是「有一栏出事了」。
 */
function alertTone(lane: TaskLane): StatusTone | null {
	const outcome = lane.latest?.outcome;
	return outcome === undefined || outcome === "done" ? null : TONE[outcome];
}

/**
 * 每张卡片答的那件事：这一栏管的东西，此刻库里有多少。
 *
 * 三张各说各的一份数，不重样（`AGENTS.md`「同一份数据只画一遍」）：同步说搬进来
 * 多少，解析说还剩多少活，整理说词表并成了什么样。
 */
export const facts: Record<TaskKind, (corpus: CorpusCounts) => string> = {
	derive: (corpus) =>
		corpus.pending > 0
			? `还有 ${corpus.pending} 条经历待解析`
			: "经历已全部解析",
	review: (corpus) =>
		`技能 ${corpus.words} 个，其中 ${corpus.merged} 个已合并写法`,
	sync: (corpus) =>
		dots(
			`${corpus.employees} 人`,
			`${corpus.segments} 条经历（公司内 ${corpus.internal}、入职前 ${corpus.external}）`,
		),
};

/** 卡片上那行小字：这一次从几点开始，或者上一次几点、用了多久。 */
function when(latest: TaskLane["latest"]): string {
	if (!latest) return "还没跑过";
	if (latest.outcome === "running") return `${latest.startedAt} 开始`;
	return dots(
		`上一次 ${latest.startedAt}`,
		latest.seconds === null ? null : `用时 ${latest.seconds}s`,
	);
}

function Tasks() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const running = state.lanes.find((one) => one.latest?.outcome === "running");

	useEffect(() => {
		const timer = setInterval(
			() => void router.invalidate(),
			running ? POLL_BUSY_MS : POLL_IDLE_MS,
		);
		return () => clearInterval(timer);
	}, [running, router]);

	return (
		<AdminPage title="任务">
			{/* 卡片外面那圈发丝线离开 5px，所以卡片之间的沟槽也得宽一档，不然两圈线贴在一起 */}
			<ul className="flex flex-col gap-6">
				{state.lanes.map((one) => (
					<LaneCard
						busy={running !== undefined}
						closed={state.judge === "off"}
						corpus={state.corpus}
						key={one.kind}
						lane={one}
						onDone={() => router.invalidate()}
					/>
				))}
			</ul>
		</AdminPage>
	);
}

/**
 * 一种任务的那张卡片：名字、节奏、此刻怎么样、这一次做成了什么，以及「现在跑一次」。
 *
 * 一张卡片管一栏的全部事，所以按钮和折叠都在卡片里——这块板不可点，卡片里套一个
 * 按钮不会变成「能点的块里套能点的块」。同步没有「现在跑一次」：它读的是别处的
 * 数据，什么时候读由外面定。
 */
function LaneCard({
	lane,
	corpus,
	busy,
	closed,
	onDone,
}: {
	lane: TaskLane;
	corpus: CorpusCounts;
	busy: boolean;
	/** 整理是不是关掉了（`REVIEW_JUDGE=off`），只对整理那一栏有意义 */
	closed: boolean;
	onDone: () => void;
}) {
	const { kind, latest } = lane;
	const [requesting, setRequesting] = useState(false);
	const [declined, setDeclined] = useState(false);
	/*
	 * 整理关掉的时候后台那一轮直接返回（`src/server/jobs.ts`），按下去什么都不会
	 * 发生——那就不给按钮。画一个按了没反应的按钮比没有按钮糟。
	 */
	const job =
		kind === "sync" || (kind === "review" && closed) ? null : (kind as JobKind);
	const tone = alertTone(lane);

	async function request() {
		if (!job) return;
		setRequesting(true);
		try {
			const { queued } = await requestTask({ data: job });
			setDeclined(!queued);
			onDone();
		} finally {
			setRequesting(false);
		}
	}

	return (
		/* 那圈离开 5px 的发丝线是 coss 文档站首页展示卡的一部分，照抄它的写法 */
		<CardFrame
			className="w-full after:pointer-events-none after:absolute after:-inset-[5px] after:-z-1 after:rounded-[calc(var(--radius-xl)+4px)] after:border after:border-border/64"
			render={<li />}
		>
			<CardFrameHeader>
				<CardFrameTitle render={<h2>{NAME[kind]}</h2>} />
				{job && (
					<CardFrameAction>
						<Button
							disabled={busy}
							loading={requesting}
							onClick={() => void request()}
							size="sm"
							variant="outline"
						>
							现在跑一次
						</Button>
					</CardFrameAction>
				)}
			</CardFrameHeader>
			<Card>
				<CardPanel className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
						{tone && latest && (
							<StatusBadge tone={tone}>{SAID[latest.outcome]}</StatusBadge>
						)}
						<p className="text-muted-foreground text-xs">{when(latest)}</p>
						{declined && (
							/* 这句话说的是那一下按键，用过去时；活到下一下按下去为止 */
							<p className="text-muted-foreground text-xs">
								按下去的时候已经排着一次了
							</p>
						)}
					</div>
					{latest?.outcome === "failed" && (
						/*
						 * 失败用 `Alert` 的红，和「没能提交」那两处同一档：它说的是「这次跑
						 * 失败了」，读不成命中（绿）、选中（蓝）或要留意的状态（amber）。
						 */
						<Alert variant="error">
							<AlertTitle>这次{NAME[kind]}没有跑完</AlertTitle>
							<AlertDescription>{latest.error}</AlertDescription>
						</Alert>
					)}
					<p className="text-sm">{facts[kind](corpus)}</p>
					{kind === "review" && closed && (
						/* 关掉的那一栏永远不会再有新记录，卡片上得说出来，不然它只是看着闲着 */
						<p className="text-muted-foreground text-xs">
							自动整理已关闭，词表不再更新
						</p>
					)}
					{latest && <Detail lane={lane} />}
				</CardPanel>
			</Card>
		</CardFrame>
	);
}

/**
 * 收起来的那一半：这一次的全部输出，和更早的几次。
 *
 * 它们是排查用的，不是这一页平时要答的问题，所以默认收着——`Collapsible` 关着的
 * 时候面根本不挂载，那上千行也就不进 DOM。
 */
function Detail({ lane }: { lane: TaskLane }) {
	const { latest, history } = lane;
	return (
		<Collapsible className="flex flex-col gap-3">
			<CollapsibleTrigger
				className="-ms-2 self-start data-panel-open:[&_svg]:rotate-180"
				render={<Button size="sm" variant="ghost" />}
			>
				<ChevronDownIcon className="size-4" />
				输出与更早的几次
			</CollapsibleTrigger>
			<CollapsiblePanel>
				<div className="flex flex-col gap-4">
					{latest && (
						/* 内边距归里面的 `pre`，于是滚动条贴着这块面的边走 */
						<Card className="h-(--task-log-height) p-0">
							<RunLog lines={latest.log} />
						</Card>
					)}
					{history.length > 0 && <History runs={history} />}
				</div>
			</CollapsiblePanel>
		</Collapsible>
	);
}

/** 贴着末尾看的时候，多出来的行还算不算「贴着」。半行的余量。 */
const TAIL_SLACK = 16;

/**
 * 这一次说过的每一行——命令行里滚过去的那些字。等宽字体：这些行靠缩进分层级；
 * 行高比正文松一档，几百行连着扫才不糊成一片。
 *
 * **高度是版面给的，不是内容给的**（`--task-log-height`），里面自己滚：一轮整理
 * 能说上千行，跟着长的话这一栏就有几十屏，而底下两栏会被推到看不见。
 *
 * 新的行进来时跟着末尾走，除非人自己往上翻过——正在跑的那一栏每两秒来一批，
 * 不跟就等于看不到；跟得太死则是把正在读上文的人拽回底部。所以只在「这一批
 * 进来之前人本来就贴着末尾」时才跟：那一刻的位置由现在的位置减去这一批长出来的
 * 高度还原出来，不必去监听滚动。
 */
function RunLog({ lines }: { lines: string[] }) {
	const tail = useRef<HTMLPreElement>(null);
	const seen = useRef(0);

	useEffect(() => {
		if (lines.length === 0) return;
		const view = tail.current?.closest("[data-slot=scroll-area-viewport]");
		if (!(view instanceof HTMLElement)) return;
		const grew = view.scrollHeight - seen.current;
		seen.current = view.scrollHeight;
		const wasAtEnd =
			view.scrollHeight - view.scrollTop - view.clientHeight - grew <
			TAIL_SLACK;
		if (wasAtEnd) view.scrollTop = view.scrollHeight;
	}, [lines.length]);

	return (
		<ScrollArea overscrollContain>
			<pre
				className="whitespace-pre-wrap p-4 font-mono text-xs leading-relaxed"
				ref={tail}
			>
				{lines.length ? lines.join("\n") : "刚开始，还没有说什么"}
			</pre>
		</ScrollArea>
	);
}

/** 更早的几次，一行一次。 */
function History({ runs }: { runs: TaskRunView[] }) {
	return (
		<CardFrame>
			<Table variant="card">
				<TableHeader>
					<TableRow>
						<TableHead>开始</TableHead>
						<TableHead className="text-end">用时</TableHead>
						<TableHead>结果</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						<TableRow key={run.id}>
							<TableCell className="tabular-nums">{run.startedAt}</TableCell>
							<TableCell className="text-end tabular-nums">
								{run.seconds === null ? "—" : `${run.seconds}s`}
							</TableCell>
							<TableCell className="whitespace-normal text-muted-foreground">
								{run.error ?? SAID[run.outcome]}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</CardFrame>
	);
}
