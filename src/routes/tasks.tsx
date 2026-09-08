import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
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
import { cn } from "#/lib/utils";
import { requestTask, tasksStatus } from "#/server/functions";
import type { JobKind } from "#/server/jobs";
import type { TaskLane, TaskRunView, TasksState } from "#/server/tasks";

/**
 * 任务台：语料侧三种任务各自在做什么、做到哪、上一次怎么样。
 *
 * 同步是外面按节奏跑的脚本（`bun run sync`），派生和整理是应用自己持续在做的
 * 后台工作（`src/server/jobs.ts`）；三者都落成 `task_run` 的行，这一页只是把行
 * 译成字。派生和整理可以从这里「现在跑一次」，同步不行——它读的是别处的数据，
 * 什么时候读由外面定。
 */
export const Route = createFileRoute("/tasks")({
	loader: () => tasksStatus(),
	head: () => ({ meta: [{ title: "任务 · 人才搜索" }] }),
	component: Tasks,
});

/** 有任务在跑时多久重新取一次状态；没有的时候慢一些——后台随时可能自己开一轮。 */
const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 10_000;

const NAME: Record<TaskKind, string> = {
	sync: "同步",
	derive: "派生",
	review: "整理",
};

/**
 * 各自的节奏，说给人听。派生和整理的 cron 在 `src/server/jobs.ts` 的 `SCHEDULE`
 * 里——那是服务端模块，从它取一个值会把 pg-boss 拖进客户端包，所以这里另写一份字。
 */
const CADENCE: Record<TaskKind, string> = {
	sync: "命令行 bun run sync",
	derive: "每 5 分钟看一次有没有活",
	review: "每天 03:00",
};

const WHAT: Record<TaskKind, string> = {
	sync: "读数据源，切段校验，增删变了的人和段",
	derive: "给还没派生的段抽能力词、对齐序列、嵌入、连边",
	review: "把能力词的不同写法归并成标准词",
};

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

const TONE: Record<
	TaskRunView["outcome"],
	"info" | "warning" | "error" | "success"
> = {
	running: "info",
	interrupted: "warning",
	failed: "error",
	done: "success",
};

function Tasks() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const running = state.lanes.find(
		(lane) => lane.latest?.outcome === "running",
	);
	// 看哪一栏的过程：默认看正在跑的，没有就看最近动过的那一栏
	const [chosen, setChosen] = useState<TaskKind | null>(null);
	const shown =
		state.lanes.find((lane) => lane.kind === chosen) ??
		running ??
		newest(state.lanes);

	useEffect(() => {
		const timer = setInterval(
			() => void router.invalidate(),
			running ? POLL_BUSY_MS : POLL_IDLE_MS,
		);
		return () => clearInterval(timer);
	}, [running, router]);

	return (
		<main className="app-column flex flex-1 flex-col gap-6 py-8">
			<div className="flex flex-col gap-1">
				<h1 className="title-1 font-semibold">任务</h1>
				<p className="text-muted-foreground text-sm">{summary(state)}</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				{state.lanes.map((lane) => (
					<Lane
						key={lane.kind}
						lane={lane}
						progress={lane.kind === "derive" ? state.derive : null}
						chosen={lane.kind === shown?.kind}
						busy={running !== undefined}
						onChoose={() => setChosen(lane.kind)}
						onDone={() => router.invalidate()}
					/>
				))}
			</div>
			{shown?.latest ? (
				<>
					{shown.latest.outcome === "failed" && (
						/*
						 * 页面级的失败用 `Alert` 的红，和「没能提交」那两处同一档：它说的是
						 * 「这次跑失败了」，读不成命中（绿）、选中（蓝）或查询上的提示（amber）。
						 */
						<Alert variant="error">
							<AlertTitle>这次{NAME[shown.kind]}没有跑完</AlertTitle>
							<AlertDescription>{shown.latest.error}</AlertDescription>
						</Alert>
					)}
					<RunLog lines={shown.latest.log} />
					{shown.history.length > 0 && <History runs={shown.history} />}
				</>
			) : (
				<p className="text-muted-foreground text-sm">
					还没有跑过。先在命令行跑 bun run sync
					把数据同步进来，派生几分钟内会自己接上。
				</p>
			)}
		</main>
	);
}

/** 最近动过的那一栏。 */
function newest(lanes: TaskLane[]): TaskLane | undefined {
	return [...lanes]
		.filter((lane) => lane.latest)
		.sort((a, b) => (b.latest?.id ?? 0) - (a.latest?.id ?? 0))[0];
}

/** 抬头那一句：派生的活还剩多少。 */
export function summary({ derive }: TasksState): string {
	if (derive.total === 0)
		return "语料是空的：同步把人和段搬进来，派生给它们算说法与向量。";
	if (derive.pending === 0) return `${derive.total} 段全部派生到了当前版本。`;
	return `${derive.total} 段里还有 ${derive.pending} 段待派生。`;
}

/** 一种任务的一栏：叫什么、什么节奏、上一次怎么样、能不能现在来一次。 */
function Lane({
	lane,
	progress,
	chosen,
	busy,
	onChoose,
	onDone,
}: {
	lane: TaskLane;
	progress: TasksState["derive"] | null;
	chosen: boolean;
	busy: boolean;
	onChoose: () => void;
	onDone: () => void;
}) {
	const { kind, latest } = lane;
	const [requesting, setRequesting] = useState(false);
	const [declined, setDeclined] = useState(false);
	const job = kind === "sync" ? null : (kind as JobKind);

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
		<Card
			className={cn(
				"flex cursor-pointer flex-col gap-3 p-4 transition-colors",
				chosen ? "ring-2 ring-ring" : "hover:bg-accent/40",
			)}
			onClick={onChoose}
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<h2 className="font-medium">{NAME[kind]}</h2>
					<p className="text-muted-foreground text-xs">{WHAT[kind]}</p>
				</div>
				{latest && (
					<Badge variant={TONE[latest.outcome]}>{SAID[latest.outcome]}</Badge>
				)}
			</div>
			{progress && progress.total > 0 && (
				<div className="flex flex-col gap-1">
					<div className="h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full bg-primary transition-[width]"
							style={{
								width: `${Math.round(((progress.total - progress.pending) / progress.total) * 100)}%`,
							}}
						/>
					</div>
					<p className="text-muted-foreground text-xs tabular-nums">
						{progress.total - progress.pending} / {progress.total} 段
					</p>
				</div>
			)}
			<p className="text-muted-foreground text-xs">
				{latest
					? `上一次 ${latest.startedAt}${latest.seconds === null ? "" : `，用时 ${latest.seconds}s`}`
					: "还没跑过"}
				{" · "}
				{CADENCE[kind]}
			</p>
			{job && (
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="outline"
						disabled={busy}
						loading={requesting}
						onClick={(event) => {
							event.stopPropagation();
							void request();
						}}
					>
						现在跑一次
					</Button>
					{declined && (
						/* 这句话说的是那一下按键，用过去时；活到下一下按下去为止 */
						<span className="text-muted-foreground text-xs">
							按下去的时候已经排着一次了
						</span>
					)}
				</div>
			)}
		</Card>
	);
}

/**
 * 这一次说过的每一行。
 *
 * 它就是命令行里滚过去的那些字——拒绝了几段、为什么拒绝、合并了哪些写法、
 * 各表最后几行。验收一次任务靠的全是它们。等宽字体：这些行靠缩进分层级。
 *
 * 它是这一页的主面：占掉上面几栏和历史之外的全部高度、里面自己滚。几千行
 * 日志不能把页面撑长，所以高度来自版面而不是内容；`min-h-60` 是屏幕矮的时候
 * 留给它的底。
 */
export function RunLog({ lines }: { lines: string[] }) {
	return (
		<Card className="min-h-60 flex-1 p-0">
			<ScrollArea className="p-4">
				<pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
					{lines.length ? lines.join("\n") : "刚开始，还没有说什么"}
				</pre>
			</ScrollArea>
		</Card>
	);
}

/** 更早的几次，一行一次。 */
export function History({ runs }: { runs: TaskRunView[] }) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="font-medium text-sm">更早的几次</h2>
			<Table>
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
		</div>
	);
}
