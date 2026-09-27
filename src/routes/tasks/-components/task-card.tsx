import { Link } from "@tanstack/react-router";
import { PlayIcon, ScrollTextIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { CodeBlock } from "#/components/ui/code-block";
import { Collapse } from "#/components/ui/collapse";
import { Divider } from "#/components/ui/divider";
import { Drawer } from "#/components/ui/drawer";
import { Empty } from "#/components/ui/empty";
import { Skeleton } from "#/components/ui/skeleton";
import { Text } from "#/components/ui/text";
import { toast } from "#/components/ui/toast";
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
import { StatusIcon } from "../../-components/status-badge";
import { TablePager } from "../../-components/table-pager";
import {
	formatDuration,
	LANE_FACTS,
	RUN_STATUS,
	TASK_NAME,
} from "../-lib/labels";

/*
 * 任务页（`routes/tasks/route.tsx`）上一类任务的一组：头上是任务名、最近一次的结果
 * 和「立即运行」；下面白底的面里是库存数、按次列出的运行记录，每次的日志打开才取。
 */

/** 翻到第 `page` 页的地址：只改这一类任务的页码，其余几类留在原来那页。 */
function at(kind: TaskKind, page: number) {
	return (previous: TaskPages): TaskPages => ({
		...previous,
		[kind]: page > 1 ? page : undefined,
	});
}

/** 一次运行的用时；还在跑和中断的那一次没有用时。 */
function durationOf(run: TaskRunView) {
	return run.seconds === null ? null : formatDuration(run.seconds);
}

/** 组头标题下面那一行：最近一次的结果、开始时刻和用时。 */
function Latest({ latest }: { latest: TaskRunView | null }) {
	if (!latest) return <span>还没有运行过</span>;
	const status = RUN_STATUS[latest.outcome];
	const took = durationOf(latest);
	return (
		<span className="inline-flex items-center gap-1.5 tabular-nums">
			<StatusIcon size={14} tone={status.tone} />
			<span>
				{status.label} · {latest.startedAt} 开始
				{took && ` · 用时 ${took}`}
			</span>
		</span>
	);
}

/** 最近一次运行失败时面里的那块提示：结论在标题，那次记下的原始错误收在详情里。 */
export function RunFailed({
	kind,
	error,
}: {
	kind: TaskKind;
	error: string | null;
}) {
	return (
		<Alert
			extra={
				error ? (
					<CodeBlock variant="borderless" wrap>
						{error}
					</CodeBlock>
				) : undefined
			}
			title={`上一次${TASK_NAME[kind]}失败`}
			type="error"
		/>
	);
}

/** 一类任务的一组。`onDone` 在请求运行之后调用，让页面重新取一次状态。 */
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
	const job =
		kind === "sync" || (kind === "review" && judge === "off")
			? null
			: (kind as JobKind);

	async function request() {
		if (!job) return;
		setRequesting(true);
		try {
			const { queued } = await requestTask({ data: job });
			if (!queued)
				toast.warning({
					description: "等排在前面的任务跑完再试。",
					id: "task-queued",
					title: `已有任务在排队，这次${TASK_NAME[kind]}没有加入`,
				});
			onDone();
		} finally {
			setRequesting(false);
		}
	}

	return (
		<li>
			<Collapse
				desc={<Latest latest={latest} />}
				extra={
					job && (
						<Button
							disabled={busy}
							icon={PlayIcon}
							loading={requesting}
							onClick={() => void request()}
							type="primary"
						>
							立即运行
						</Button>
					)
				}
				title={TASK_NAME[kind]}
				variant="filled"
			>
				<div className="flex flex-col gap-4 py-1">
					{latest?.outcome === "failed" && (
						<RunFailed error={latest.error} kind={kind} />
					)}
					{kind === "review" && judge === "off" && (
						<Alert
							title="自动整理已关闭，技能与释义不再更新"
							type="secondary"
						/>
					)}
					<Facts corpus={corpus} kind={kind} />
					{lane.runs.total > 0 && (
						<>
							<Divider />
							<RunHistory lane={lane} />
						</>
					)}
				</div>
			</Collapse>
		</li>
	);
}

/** 库存数的格子：至少 150px 宽，一行最多四格，窄了自动换行。 */
const FACT_COLUMNS =
	"repeat(auto-fill, minmax(max(9.375rem, calc((100% - 3 * var(--spacing) * 2) / 4)), 1fr))";

/** 库存数，一格一个数：名字在上、数在中、构成在下。 */
function Facts({ kind, corpus }: { kind: TaskKind; corpus: CorpusCounts }) {
	return (
		<dl className="grid gap-2" style={{ gridTemplateColumns: FACT_COLUMNS }}>
			{LANE_FACTS[kind](corpus).map((fact) => (
				<div className="flex min-w-0 flex-col" key={fact.label}>
					<dt>
						<Text ellipsis size="lg" weight="medium">
							{fact.label}
						</Text>
					</dt>
					<dd className="flex flex-col gap-1">
						<Text className="tabular-nums" size="2xl" weight="bold">
							{fact.value}
						</Text>
						{fact.note && (
							<Text size="xs" type="secondary">
								{fact.note}
							</Text>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * 按次列出的运行记录，最新的在最前。每次一行描边的面：状态图标、结果、这一类的第几次、
 * 用时，右边是开始时刻和看日志的按钮；出错的那次下面接一行错误。日志只开一个抽屉，
 * 点哪一次换成哪一次。
 */
function RunHistory({ lane }: { lane: TaskLane }) {
	const { kind, runs } = lane;
	const [open, setOpen] = useState(false);
	const [shown, setShown] = useState<LogView | null>(null);

	/*
	 * 抽屉只有一个，点哪一次的日志就换成哪一次、重新取。取回来时要是已经换成了
	 * 别的一次，这份作废。
	 */
	function openLog(run: TaskRunView, seq: number) {
		setShown({ lines: null, failed: false, run, seq });
		setOpen(true);
		const keep = (next: Partial<LogView>) =>
			setShown((now) => (now?.run.id === run.id ? { ...now, ...next } : now));
		void taskLog({ data: { runId: run.id } }).then(
			(lines) => keep({ lines }),
			() => keep({ failed: true }),
		);
	}
	return (
		<section className="flex flex-col gap-2">
			<h3 className="flex items-baseline gap-1.5">
				<Text size="sm" type="secondary" weight="medium">
					运行记录
				</Text>
				<Text size="xs" type="quaternary">
					{runs.total} 次
				</Text>
			</h3>
			<ol className="flex flex-col gap-2">
				{runs.rows.map((run, index) => {
					// 这一类的第几次：列表按时间倒排，第一页第一行是第 total 次
					const seq = runs.total - (runs.from - 1) - index;
					return (
						<RunRow
							key={run.id}
							kind={kind}
							onOpenLog={() => openLog(run, seq)}
							run={run}
							seq={seq}
						/>
					);
				})}
			</ol>
			{runs.pages > 1 && (
				<TablePager
					linkTo={(to) => (
						<Link resetScroll={false} search={at(kind, to)} to="/tasks" />
					)}
					table={runs}
					units={{ row: "次", total: "次运行" }}
				/>
			)}
			{shown && (
				<RunLog
					afterClose={() => setShown(null)}
					kind={kind}
					log={shown}
					onClose={() => setOpen(false)}
					open={open}
				/>
			)}
		</section>
	);
}

function RunRow({
	kind,
	run,
	seq,
	onOpenLog,
}: {
	kind: TaskKind;
	run: TaskRunView;
	seq: number;
	onOpenLog: () => void;
}) {
	const status = RUN_STATUS[run.outcome];
	const took = durationOf(run);
	return (
		<Block
			as="li"
			className="rounded-lg"
			gap={8}
			paddingBlock={8}
			paddingInline={8}
			variant="outlined"
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<StatusIcon tone={status.tone} />
					<Text className="shrink-0" weight="medium">
						{status.label}
					</Text>
					<Text className="shrink-0 tabular-nums" size="xs" type="secondary">
						#{seq}
					</Text>
					{took && (
						<Text className="shrink-0 tabular-nums" size="xs" type="secondary">
							· {took}
						</Text>
					)}
				</div>
				<div className="flex flex-none items-center gap-2">
					<Text className="tabular-nums" size="xs" type="secondary">
						{run.startedAt}
					</Text>
					<ActionIcon
						aria-label={`第 ${seq} 次${TASK_NAME[kind]}的日志`}
						icon={ScrollTextIcon}
						onClick={onOpenLog}
						size="small"
						title="日志"
					/>
				</div>
			</div>
			{run.error && (
				<Text
					className="px-1"
					ellipsis={{ tooltip: true }}
					size="sm"
					type="secondary"
				>
					{run.error}
				</Text>
			)}
		</Block>
	);
}

/** 抽屉里正看着的那一次：还在取时 `lines` 是 null，取不到时 `failed`。 */
type LogView = {
	run: TaskRunView;
	seq: number;
	lines: string[] | null;
	failed: boolean;
};

/**
 * 一次运行的日志，在右侧抽屉里，打开时才取。取不到（服务端连不上、库出错）时说
 * 取不到，不停在加载上；关掉再点一次「日志」重新取。
 */
function RunLog({
	kind,
	log,
	open,
	onClose,
	afterClose,
}: {
	kind: TaskKind;
	log: LogView;
	open: boolean;
	onClose: () => void;
	afterClose: () => void;
}) {
	const { failed, lines, run, seq } = log;
	return (
		<Drawer
			afterClose={afterClose}
			onClose={onClose}
			open={open}
			title={`${TASK_NAME[kind]} #${seq} · ${run.startedAt} 开始`}
			width="var(--container-log)"
		>
			{failed ? (
				<Alert
					title="没能取到这次运行的日志，请关闭后重新打开。"
					type="error"
				/>
			) : lines === null ? (
				<Skeleton.Text rows={8} size="xs" />
			) : lines.length === 0 ? (
				<Empty description="这次运行没有留下输出。" title="没有日志" />
			) : (
				<CodeBlock language="日志" wrap>
					{lines.join("\n")}
				</CodeBlock>
			)}
		</Drawer>
	);
}
