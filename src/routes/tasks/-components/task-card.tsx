import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	ChevronDownIcon,
	PlayIcon,
	ScrollTextIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Alert } from "#/components/ui/alert";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { CodeBlock } from "#/components/ui/code-block";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Divider } from "#/components/ui/divider";
import { Drawer } from "#/components/ui/drawer";
import { Empty } from "#/components/ui/empty";
import { GroupCard } from "#/components/ui/group-card";
import { Icon } from "#/components/ui/icon";
import { Skeleton } from "#/components/ui/skeleton";
import { Text } from "#/components/ui/text";
import { toast } from "#/components/ui/toast";
import type { Judge } from "#/corpus/judgment";
import type { TaskKind } from "#/db/schema";
import { integer } from "#/lib/format";
import { cn } from "#/lib/utils";
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
import { ago } from "../../-lib/recent";
import {
	formatDuration,
	LANE_FACTS,
	RUN_STATUS,
	TASK_NAME,
} from "../-lib/labels";

/** 一次运行开始了多久：最近的写「3 分钟前」，精确时刻放在悬停提示里。 */
const agoOf = (run: TaskRunView) =>
	ago({ ageSeconds: run.ageSeconds, at: run.startedAt });

/** 翻到第 `page` 页的地址：只改这一类任务的页码，其余几类的页码不动。 */
function at(kind: TaskKind, page: number) {
	return (previous: TaskPages): TaskPages => ({
		...previous,
		[kind]: page > 1 ? page : undefined,
	});
}

/** 一次运行的用时；还在跑、中断的那一次和不到一秒就结束的那一次不写用时。 */
function durationOf(run: TaskRunView) {
	return run.seconds ? formatDuration(run.seconds) : null;
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
				{status.label} · <span title={latest.startedAt}>{agoOf(latest)}</span>
				开始
				{took && ` · 用时 ${took}`}
			</span>
		</span>
	);
}

/**
 * 任务页上一类任务的一组：任务名、最近一次的结果和「立即运行」，下面是统计数和按次
 * 列出的运行记录。`onDone` 在请求运行之后调用，让页面重新取一次状态。
 */
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
			<GroupCard
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
			>
				<div className="flex flex-col gap-6">
					{kind === "review" && judge === "off" && (
						<Alert
							title="自动整理已关闭，技能与释义不再更新"
							type="secondary"
						/>
					)}
					<Facts corpus={corpus} kind={kind} />
					{lane.runs.total > 0 && (
						<>
							<Divider className="my-0" dashed />
							<RunHistory lane={lane} />
						</>
					)}
				</div>
			</GroupCard>
		</li>
	);
}

/** 一行最多四格（扣掉三道 `gap-2`），每格不窄于 9.375rem，放不下就换行。 */
const FACT_COLUMNS =
	"repeat(auto-fill, minmax(max(9.375rem, calc((100% - 3 * var(--spacing) * 2) / 4)), 1fr))";

/** 统计数，一格一个数，构成写在数下面。 */
function Facts({ kind, corpus }: { kind: TaskKind; corpus: CorpusCounts }) {
	return (
		<dl className="grid gap-2" style={{ gridTemplateColumns: FACT_COLUMNS }}>
			{LANE_FACTS[kind](corpus).map((fact) => (
				<div className="flex min-w-0 flex-col" key={fact.label}>
					<dt className="leading-8">
						<Text ellipsis={{ tooltip: true }} size="lg" weight="medium">
							{fact.label}
						</Text>
					</dt>
					<dd className="flex flex-col gap-4">
						<Text
							className="leading-tight tabular-nums"
							size="2xl"
							weight="bold"
						>
							{integer(fact.value)}
						</Text>
						{fact.parts && (
							<span className="flex flex-wrap gap-x-3 gap-y-1 text-fg-tertiary text-xs">
								{fact.parts.map((part) => (
									<span className="flex gap-1" key={part.label}>
										<span className="font-bold tabular-nums">
											{integer(part.value)}
										</span>
										<span>{part.label}</span>
									</span>
								))}
							</span>
						)}
					</dd>
				</div>
			))}
		</dl>
	);
}

/**
 * 按次列出的运行记录，最新的在最前。点一行打开那一次的日志；出错的那次错误收在行下，
 * 只有最新那次一开始就展开。
 */
function RunHistory({ lane }: { lane: TaskLane }) {
	const { kind, runs } = lane;
	const panelId = useId();
	const [expanded, setExpanded] = useState(true);
	const [open, setOpen] = useState(false);
	const [shown, setShown] = useState<LogView | null>(null);

	// 日志抽屉只有一个；取回来时要是已经点了别的一次，这份作废
	function openLog(run: TaskRunView) {
		setShown({ lines: null, failed: false, run });
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
			<CollapsibleTrigger
				onOpenChange={setExpanded}
				open={expanded}
				panelId={panelId}
			>
				<Icon className="text-fg-tertiary" icon={CalendarClockIcon} size={16} />
				<Text size="sm" type="secondary" weight="medium">
					运行记录
				</Text>
			</CollapsibleTrigger>
			<Collapsible id={panelId} open={expanded}>
				<div className="flex flex-col gap-2 pt-1">
					<ol className="flex flex-col gap-0.5">
						{runs.rows.map((run, index) => (
							<RunRow
								defaultExpanded={runs.page === 1 && index === 0}
								key={run.id}
								kind={kind}
								onOpenLog={() => openLog(run)}
								run={run}
							/>
						))}
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
				</div>
			</Collapsible>
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
	defaultExpanded,
	onOpenLog,
}: {
	kind: TaskKind;
	run: TaskRunView;
	defaultExpanded: boolean;
	onOpenLog: () => void;
}) {
	const status = RUN_STATUS[run.outcome];
	const took = durationOf(run);
	const [showError, setShowError] = useState(defaultExpanded);
	const title = `${agoOf(run)}开始的${TASK_NAME[kind]}`;
	return (
		<Block
			as="li"
			className="group/reveal"
			clickable
			gap={4}
			onClick={onOpenLog}
			paddingBlock={4}
			paddingInline={8}
			variant="borderless"
		>
			<div className="flex min-h-7 items-center justify-between gap-2">
				<div className="flex min-w-0 items-center gap-2">
					<StatusIcon tone={status.tone} />
					<Text className="shrink-0" weight="medium">
						{status.label}
					</Text>
					{took && (
						<Text className="shrink-0 tabular-nums" size="xs" type="secondary">
							· {took}
						</Text>
					)}
				</div>
				<div className="flex flex-none items-center gap-2">
					<Text
						className="tabular-nums"
						size="xs"
						title={run.startedAt}
						type="secondary"
					>
						{agoOf(run)}
					</Text>
					{run.error && (
						<ActionIcon
							aria-expanded={showError}
							aria-label={`${showError ? "收起" : "展开"}${title}的错误`}
							className={cn(
								"transition-transform duration-200",
								!showError && "-rotate-90",
							)}
							icon={ChevronDownIcon}
							onClick={(event) => {
								event.stopPropagation();
								setShowError((now) => !now);
							}}
							size="small"
							title={showError ? "收起错误" : "展开错误"}
						/>
					)}
					<ActionIcon
						aria-label={`${title}的日志`}
						className="reveal"
						icon={ScrollTextIcon}
						onClick={(event) => {
							event.stopPropagation();
							onOpenLog();
						}}
						size="small"
						title="日志"
					/>
				</div>
			</div>
			{run.error && showError && (
				<Text
					className="cursor-text whitespace-pre-wrap break-words px-1"
					onClick={(event) => event.stopPropagation()}
					size="sm"
					type="tertiary"
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
	lines: string[] | null;
	failed: boolean;
};

/** 一次运行的日志，打开时才取；取不到时说取不到，不停在加载上。 */
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
	const { failed, lines, run } = log;
	return (
		<Drawer
			afterClose={afterClose}
			onClose={onClose}
			open={open}
			title={`${TASK_NAME[kind]} · ${run.startedAt} 开始`}
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
				<CodeBlock language="日志">{lines.join("\n")}</CodeBlock>
			)}
		</Drawer>
	);
}
