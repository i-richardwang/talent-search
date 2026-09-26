import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Modal } from "#/components/ui/modal";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import type { Judge } from "#/corpus/judgment";
import type { TaskKind } from "#/db/schema";
import { requestTask, taskLog } from "#/server/functions";
import type { JobKind } from "#/server/jobs";
import type {
	CorpusCounts,
	TaskLane,
	TaskPages,
	TaskRunView,
} from "#/server/tasks";
import { StatusBadge, type StatusTone } from "../../-components/status-badge";
import { TablePager } from "../../-components/table-pager";
import { LANE_FACTS, RUN_STATUS, TASK_NAME } from "../-lib/labels";

/*
 * 任务页（`routes/tasks/route.tsx`）上一类任务的一张卡：最近一次的状态、库存数、立即运行，
 * 以及按次列出的运行记录，每次的日志打开才取。
 */

/** 翻到第 `page` 页的地址：只改这一类任务的页码，其余几类留在原来那页。 */
function at(kind: TaskKind, page: number) {
	return (previous: TaskPages): TaskPages => ({
		...previous,
		[kind]: page > 1 ? page : undefined,
	});
}

function alertTone(latest: TaskRunView | null): StatusTone | null {
	const outcome = latest?.outcome;
	return outcome === undefined || outcome === "done"
		? null
		: RUN_STATUS[outcome].tone;
}

function when(latest: TaskRunView | null): string {
	if (!latest) return "还没有运行过";
	if (latest.outcome === "running") return `${latest.startedAt} 开始`;
	return `上次运行 ${latest.startedAt}`;
}

/** 最近一次运行失败时卡片上的那块提示，原因是那次运行记下的错误。 */
export function RunFailed({
	kind,
	error,
}: {
	kind: TaskKind;
	error: string | null;
}) {
	return (
		<Alert
			description={error}
			title={`这次${TASK_NAME[kind]}失败`}
			type="error"
		/>
	);
}

/** 一类任务的卡片。`onDone` 在请求运行之后调用，让页面重新取一次状态。 */
export function TaskCard({
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
		<Block as="li" className="overflow-hidden" variant="outlined" width="100%">
			<div className="flex min-h-12 items-center justify-between gap-2 border-b px-4 py-2">
				<h2 className="font-semibold text-base">{TASK_NAME[kind]}</h2>
				{job && (
					<Button
						disabled={busy}
						loading={requesting}
						onClick={() => void request()}
						size="small"
					>
						立即运行
					</Button>
				)}
			</div>
			<div className="flex flex-col gap-4 p-4">
				<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
					{tone && latest && (
						<StatusBadge tone={tone}>
							{RUN_STATUS[latest.outcome].label}
						</StatusBadge>
					)}
					<p className="text-fg-secondary text-xs">{when(latest)}</p>
					{declined && (
						<p className="text-fg-secondary text-xs">已有任务在排队</p>
					)}
				</div>
				{latest?.outcome === "failed" && (
					<RunFailed error={latest.error} kind={kind} />
				)}
				<p className="text-base">{LANE_FACTS[kind](corpus)}</p>
				{kind === "review" && judge === "off" && (
					<p className="text-fg-secondary text-xs">
						自动整理已关闭，技能与释义不再更新
					</p>
				)}
			</div>
			{lane.runs.total > 0 && <RunHistory lane={lane} />}
		</Block>
	);
}

function RunHistory({ lane }: { lane: TaskLane }) {
	const { kind, runs } = lane;
	return (
		<Table
			className="border-t"
			footer={
				runs.pages > 1 ? (
					<TablePager
						linkTo={(to) => (
							<Link resetScroll={false} search={at(kind, to)} to="/tasks" />
						)}
						table={runs}
						units={{ row: "次", total: "次运行" }}
					/>
				) : undefined
			}
			size="small"
			tableLayout="fixed"
		>
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
				{runs.rows.map((run) => (
					<TableRow key={run.id}>
						<TableCell className="tabular-nums">{run.startedAt}</TableCell>
						<TableCell className="text-end tabular-nums">
							{run.seconds === null ? "—" : `${run.seconds}s`}
						</TableCell>
						<TableCell>
							<span className="flex items-center gap-2">
								<StatusBadge tone={RUN_STATUS[run.outcome].tone}>
									{RUN_STATUS[run.outcome].label}
								</StatusBadge>
								{run.error && (
									<span
										className="min-w-0 truncate text-fg-secondary"
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
	);
}

/**
 * 一次运行的日志：打开对话框时才去取。取不到（服务端连不上、库出错）时对话框里
 * 说取不到，不停在加载上；再点一次「日志」重新取。
 */
function RunLog({ kind, run }: { kind: TaskKind; run: TaskRunView }) {
	const [open, setOpen] = useState(false);
	const [lines, setLines] = useState<string[] | null>(null);
	const [failed, setFailed] = useState(false);

	return (
		<>
			<Button
				aria-label={`${run.startedAt} 那次${TASK_NAME[kind]}的日志`}
				onClick={() => {
					setOpen(true);
					setLines(null);
					setFailed(false);
					void taskLog({ data: { runId: run.id } }).then(setLines, () =>
						setFailed(true),
					);
				}}
				size="small"
				type="text"
			>
				日志
			</Button>
			<Modal
				className="max-w-3xl"
				noFooter
				loading={lines === null && !failed}
				onCancel={() => setOpen(false)}
				open={open}
				title={`运行日志 · ${TASK_NAME[kind]} · ${run.startedAt} 开始`}
			>
				{failed ? (
					<Alert
						title="没能取到这次运行的日志，请关闭后重新打开。"
						type="error"
					/>
				) : (
					<pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
						{lines && lines.length > 0 ? lines.join("\n") : "这次运行没有输出"}
					</pre>
				)}
			</Modal>
		</>
	);
}
