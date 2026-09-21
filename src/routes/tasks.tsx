import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
	Card,
	CardFrame,
	CardFrameAction,
	CardFrameFooter,
	CardFrameHeader,
	CardFrameTitle,
	CardPanel,
} from "#/components/ui/card";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog";
import { Spinner } from "#/components/ui/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { Judge } from "#/corpus/judgment";
import { TASK_KINDS, type TaskKind } from "#/db/schema";
import { dots } from "#/lib/format";
import { requestTask, taskLog, tasksStatus } from "#/server/functions";
import type { JobKind } from "#/server/jobs";
import type {
	CorpusCounts,
	TaskLane,
	TaskPages,
	TaskRunView,
} from "#/server/tasks";
import { AdminPage } from "./-components/admin-page";
import { PageNav } from "./-components/page-nav";
import { StatusBadge, type StatusTone } from "./-components/status-badge";
import { pageOf } from "./-lib/paging";

const NAME: Record<TaskKind, string> = {
	sync: "同步",
	derive: "解析",
	review: "整理",
};

export const Route = createFileRoute("/tasks")({
	validateSearch: (search: Record<string, unknown>): TaskPages => {
		const pages: TaskPages = {};
		for (const kind of TASK_KINDS) {
			const page = pageOf(search[kind]);
			if (page) pages[kind] = page;
		}
		return pages;
	},
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) => tasksStatus({ data: deps }),
	head: () => ({ meta: [{ title: "任务 · 人才搜索" }] }),
	component: Tasks,
});

function at(kind: TaskKind, page: number) {
	return (previous: TaskPages): TaskPages => ({
		...previous,
		[kind]: page > 1 ? page : undefined,
	});
}

const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 10_000;

const RESULT: Record<TaskRunView["outcome"], string> = {
	running: "正在运行",
	interrupted: "中断",
	failed: "失败",
	done: "成功",
};

const TONE: Record<TaskRunView["outcome"], StatusTone> = {
	running: "running",
	interrupted: "waiting",
	failed: "error",
	done: "success",
};

function alertTone(latest: TaskRunView | null): StatusTone | null {
	const outcome = latest?.outcome;
	return outcome === undefined || outcome === "done" ? null : TONE[outcome];
}

export const facts: Record<TaskKind, (corpus: CorpusCounts) => string> = {
	derive: (corpus) =>
		corpus.pending > 0
			? `还有 ${corpus.pending} 条经历待处理`
			: "经历已全部处理",
	review: (corpus) =>
		dots(
			`技能 ${corpus.words} 个，已归并 ${corpus.merged} 种写法`,
			`释义 ${corpus.glossed}/${corpus.glossable} 条`,
		),
	sync: (corpus) =>
		dots(
			`${corpus.employees} 人`,
			`${corpus.segments} 条经历（公司内 ${corpus.internal}、入职前 ${corpus.external}）`,
		),
};

function when(latest: TaskRunView | null): string {
	if (!latest) return "还没有运行过";
	if (latest.outcome === "running") return `${latest.startedAt} 开始`;
	return `上次运行 ${latest.startedAt}`;
}

function Tasks() {
	const { corpus, judge, lanes, running } = Route.useLoaderData();
	const router = useRouter();

	useEffect(() => {
		const timer = setInterval(
			() => void router.invalidate(),
			running ? POLL_BUSY_MS : POLL_IDLE_MS,
		);
		return () => clearInterval(timer);
	}, [running, router]);

	return (
		<AdminPage title="任务">
			<ul className="flex flex-col gap-6">
				{lanes.map((one) => (
					<LaneCard
						busy={running}
						corpus={corpus}
						judge={judge}
						key={one.kind}
						lane={one}
						onDone={() => router.invalidate()}
					/>
				))}
			</ul>
		</AdminPage>
	);
}

function LaneCard({
	lane,
	corpus,
	busy,
	judge,
	onDone,
}: {
	lane: TaskLane;
	corpus: CorpusCounts;
	busy: boolean;
	judge: Judge;
	onDone: () => void;
}) {
	const { kind, latest } = lane;
	const [requesting, setRequesting] = useState(false);
	const [declined, setDeclined] = useState(false);
	const job =
		kind === "sync" || (kind === "review" && judge === "off")
			? null
			: (kind as JobKind);
	const tone = alertTone(latest);

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
							立即运行
						</Button>
					</CardFrameAction>
				)}
			</CardFrameHeader>
			<Card>
				<CardPanel className="flex flex-col gap-4">
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
						{tone && latest && (
							<StatusBadge tone={tone}>{RESULT[latest.outcome]}</StatusBadge>
						)}
						<p className="text-muted-foreground text-xs">{when(latest)}</p>
						{declined && (
							<p className="text-muted-foreground text-xs">已有任务在排队</p>
						)}
					</div>
					{latest?.outcome === "failed" && (
						<Alert variant="error">
							<AlertTitle>这次{NAME[kind]}失败</AlertTitle>
							<AlertDescription>{latest.error}</AlertDescription>
						</Alert>
					)}
					<p className="text-sm">{facts[kind](corpus)}</p>
					{kind === "review" && judge === "off" && (
						<p className="text-muted-foreground text-xs">
							自动整理已关闭，技能与释义不再更新
						</p>
					)}
				</CardPanel>
				{lane.total > 0 && <RunHistory lane={lane} />}
			</Card>
			{lane.pages > 1 && <RunPages lane={lane} />}
		</CardFrame>
	);
}

function RunHistory({ lane }: { lane: TaskLane }) {
	const { kind, runs } = lane;
	return (
		<div className="px-3.5 pb-3">
			<Table className="table-fixed">
				<TableHeader>
					<TableRow>
						<TableHead className="w-28">开始</TableHead>
						<TableHead className="w-20 text-end">用时</TableHead>
						<TableHead>结果</TableHead>
						<TableHead className="w-20">
							<span className="sr-only">日志</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						<TableRow className="hover:bg-transparent" key={run.id}>
							<TableCell className="tabular-nums">{run.startedAt}</TableCell>
							<TableCell className="text-end tabular-nums">
								{run.seconds === null ? "—" : `${run.seconds}s`}
							</TableCell>
							<TableCell>
								<span className="flex items-center gap-2">
									<StatusBadge tone={TONE[run.outcome]}>
										{RESULT[run.outcome]}
									</StatusBadge>
									{run.error && (
										<span
											className="min-w-0 truncate text-muted-foreground"
											title={run.error}
										>
											{run.error}
										</span>
									)}
								</span>
							</TableCell>
							<TableCell className="text-end">
								<RunLog kind={kind} run={run} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function RunPages({ lane }: { lane: TaskLane }) {
	const { kind, page, pages, total } = lane;
	return (
		<CardFrameFooter className="flex items-center justify-between gap-2 p-2">
			<p className="whitespace-nowrap text-muted-foreground text-sm">
				共 <strong className="font-medium text-foreground">{total}</strong>{" "}
				次运行
			</p>
			<PageNav
				linkTo={(to) => (
					<Link resetScroll={false} search={at(kind, to)} to="/tasks" />
				)}
				page={page}
				pages={pages}
			/>
		</CardFrameFooter>
	);
}

function RunLog({ kind, run }: { kind: TaskKind; run: TaskRunView }) {
	const [lines, setLines] = useState<string[] | null>(null);

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) return;
				setLines(null);
				void taskLog({ data: { runId: run.id } }).then(setLines);
			}}
		>
			<DialogTrigger
				aria-label={`${run.startedAt} 那次${NAME[kind]}的日志`}
				render={<Button size="sm" variant="ghost" />}
			>
				日志
			</DialogTrigger>
			<DialogPopup className="sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>运行日志</DialogTitle>
					<DialogDescription>
						{NAME[kind]} · {run.startedAt} 开始
					</DialogDescription>
				</DialogHeader>
				{lines === null ? (
					<DialogPanel className="flex items-center justify-center py-10">
						<Spinner />
					</DialogPanel>
				) : (
					<DialogPanel
						className="whitespace-pre-wrap font-mono text-xs leading-relaxed"
						render={<pre />}
					>
						{lines.length > 0 ? lines.join("\n") : "这次运行没有输出"}
					</DialogPanel>
				)}
			</DialogPopup>
		</Dialog>
	);
}
