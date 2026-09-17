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

/**
 * 任务台：语料侧三种任务各自管着多少东西、上一次的结果、还剩多少活。
 *
 * 同步是外面按节奏跑的脚本（`bun run sync`），解析和整理是应用自己持续在做的
 * 后台任务（`src/server/jobs.ts`）；三者都落成 `task_run` 的行。解析和整理可以
 * 从这里立即运行一次，同步不行——它读的是别处的数据，什么时候读由外面定。
 *
 * **卡片上是此刻的语料，不是一次运行的回放。** 每张卡片上那一行数问的是库
 * （`corpusCounts`），不是上一次跑的记录：一次运行说过的「人群 20 人」是那一刻的
 * 快照，跑完就开始过期，照着它显示数字等于在屏幕上留一个没人维护的旧值。
 *
 * 运行记录只列结果：什么时候开始、用了多久、成功还是失败。一次运行说过的那上千行
 * 是排查用的，收在它自己那一行的「日志」里，打开才去取——它既不是这一页要回答的
 * 问题，也不该跟着每两秒一次的轮询一起搬。跑过几百次的一栏往前翻页看，每一栏各翻
 * 各的（`/tasks?derive=3`）。
 *
 * 三栏竖着排，一栏一张卡片，管着这一栏的全部事——此刻怎么样、库里有多少、它自己的
 * 「立即运行」，以及跑过的记录。**三张卡片上的每一样都是摊开的**：哪一栏出了事、
 * 上一次之前那次是什么结果，都是扫一眼就看见的，不在任何一个要先点开的地方；
 * 也因此没有切换，卡片不可点。
 *
 * 卡片的排法照 coss 文档站首页那种展示卡：`CardFrame` 托盘上是抬头（名字和右侧
 * 一个动作），托盘里嵌着一块 `Card` 装内容——状态、语料数和那张运行记录表都在
 * 这块面上；托盘底下收一条 `CardFrameFooter` 放翻页。外面再落一圈离开 5px 的
 * 发丝线。
 */
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

/**
 * 把这一栏翻到第 `page` 页，另外两栏停在原处——三栏各看各的历史，翻一栏不该
 * 把别的两栏弹回第一页。第一页不写进地址（`-lib/paging.ts`）。
 */
function at(kind: TaskKind, page: number) {
	return (previous: TaskPages): TaskPages => ({
		...previous,
		[kind]: page > 1 ? page : undefined,
	});
}

/** 有任务在跑时多久重新取一次状态；没有的时候慢一些——后台随时可能自己开一轮。 */
const POLL_BUSY_MS = 2000;
const POLL_IDLE_MS = 10_000;

/**
 * 一次运行的结果在这一页上说成什么。
 *
 * 判成哪一种不在这一侧——那要问「此刻锁在谁手上」，只有服务端答得了
 * （`src/server/tasks.ts`）。这里只把它译成字。
 */
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

/**
 * 这一栏此刻要不要提示，提示哪一种：正在运行的，和没跑完的。
 *
 * 成功不报——常态不发徽章，三张卡片上三块一模一样的绿等于没有信息，而这块板
 * 真正要人看见的是「有一栏出事了」。运行记录里每一行都带结果，那是另一件事：
 * 在一列里挨着扫的时候，成功也得占一个位置。
 */
function alertTone(latest: TaskRunView | null): StatusTone | null {
	const outcome = latest?.outcome;
	return outcome === undefined || outcome === "done" ? null : TONE[outcome];
}

/**
 * 每张卡片答的那件事：这一栏管的东西，此刻库里有多少。
 *
 * 三张各说各的一份数，不重样（`AGENTS.md`「同一份数据只画一遍」）：同步说搬进来
 * 多少，解析说还剩多少活，整理说词表是什么样。
 */
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

/**
 * 卡片上那行小字：这一次什么时候开始的，或者上一次什么时候。
 *
 * 不带用时。用时是拿来比几次运行的，它在运行记录那张表里有一列；摆在这里就成了
 * 同一个数写两遍，而卡片正面要答的只是「这份语料是什么时候的」。
 */
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
			{/* 卡片外面那圈发丝线离开 5px，所以卡片之间的间距也得宽一档，不然两圈线贴在一起 */}
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

/**
 * 一种任务的那张卡片：名字、此刻怎么样、这一栏管的东西有多少，以及「立即运行」。
 *
 * 一张卡片管一栏的全部事，所以按钮和运行记录都在卡片里——这块板不可点，卡片里套一个
 * 按钮不会变成「能点的块里套能点的块」。同步没有「立即运行」：它读的是别处的
 * 数据，什么时候读由外面定。
 */
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
	/** 整理此刻由谁判，`off` 就是整理关掉了。只对整理那一栏有意义 */
	judge: Judge;
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
							/* 说的是刚才按的那一下，留到下一次按下为止 */
							<p className="text-muted-foreground text-xs">已有任务在排队</p>
						)}
					</div>
					{latest?.outcome === "failed" && (
						/*
						 * 失败用 `Alert` 的红，和「没能提交」那两处同一档：它说的是「这次跑
						 * 失败了」，读不成命中（绿）、选中（蓝）或要留意的状态（amber）。
						 */
						<Alert variant="error">
							<AlertTitle>这次{NAME[kind]}失败</AlertTitle>
							<AlertDescription>{latest.error}</AlertDescription>
						</Alert>
					)}
					<p className="text-sm">{facts[kind](corpus)}</p>
					{kind === "review" && judge === "off" && (
						/* 关掉的那一栏永远不会再有新记录，也没有「立即运行」，得说出来，
						   不然它只是看着闲着。 */
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

/**
 * 这一栏跑过的记录，最新的一次在最上面。
 *
 * 三列答的是同一个问题的三面——什么时候开始、用了多久、结果是什么；失败那一行
 * 在结果后面接着说为什么，因为一次失败的运行，除了「失败」之外唯一要说的就是它。
 *
 * 一次不落地往前翻（`server/tasks.ts` 的 `RUNS_PAGE`）：一栏跑过几百次，而「上一次
 * 之前那次是不是也失败了」正是出事时要问的。只有一页时不放翻页件，那一页就是全部。
 *
 * **列宽由表定，不由内容定**（`table-fixed`，`p-table-8` 同样）：三列是定宽的，剩下
 * 的都归结果那一列，失败的原因再长也只是在自己那一格里截断。让内容定宽的话，一句
 * 英文报错就能把这张表连同它外面的卡片一起撑出屏幕。
 *
 * 表和上面那几行是同一块面上的东西，中间没有第二圈边：`variant="card"` 那种自带
 * 面的表是给托盘用的（`p-table-7/8`），摆在卡片里就成了面里套面。这里只有分行的
 * 线。横向留白给到 3.5，加上单元格自己的 2.5，第一列的字正好落在卡片内容的那条
 * 竖线上（`CardPanel` 的 6）。
 */
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
						{/* 每一行末尾那个按钮不需要列名，但表头得有这一格才对得齐 */}
						<TableHead className="w-20">
							<span className="sr-only">日志</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						/*
						 * 行不可点——能点的只有末尾那个「日志」。默认那层 hover 也是按页面
						 * 底色调的，落在卡片这块面上不是同一个灰。
						 */
						<TableRow className="hover:bg-transparent" key={run.id}>
							<TableCell className="tabular-nums">{run.startedAt}</TableCell>
							<TableCell className="text-end tabular-nums">
								{run.seconds === null ? "—" : `${run.seconds}s`}
							</TableCell>
							{/*
							 * 一格一行字：表里的一行是拿来挨着扫的，高度一变，几次运行就
							 * 不再是一列等距的东西。失败的原因跟在结果后面同一行，长了
							 * 就截断——这一行完整的说法在「日志」里，最近那次还在卡片
							 * 正面的提示里。
							 */}
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

/**
 * 翻页那一条：一共跑过多少次，以及往前往后。
 *
 * 它说的是「这一页」和「全部」的关系，不是表里的一行，所以住在托盘尾巴上那条
 * `CardFrameFooter` 里，不在卡片那块面里——`p-table-8` 和 coss 自己的 calcom
 * 例子都是这么摆的，`/data` 那张表同一处。只有一页时整条不出现。
 */
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
					/*
					 * `resetScroll={false}`：三栏各有各的记录，翻的是其中一栏的一页，
					 * 读的人得留在这一栏上。默认那下滚回页首，等于每翻一页都把人从
					 * 正在看的那张卡片上拽走。`/data` 不这样——那一页整页就是一张表，
					 * 翻到下一页本来就该从第一行看起。
					 */
					<Link resetScroll={false} search={at(kind, to)} to="/tasks" />
				)}
				page={page}
				pages={pages}
			/>
		</CardFrameFooter>
	);
}

/**
 * 一次运行说过的每一行，打开才取。
 *
 * 这些行是**排查用的**：拒绝了几段、为什么拒绝、合并了哪些写法。一轮整理能说上千行，
 * 它们回答不了这一页的任何一个问题，所以既不摆在卡片上，也不跟着状态一起载入
 * （`src/server/tasks.ts` 的 `taskLog`）——每两秒一次的轮询不必搬着它们走。
 *
 * 取回来就是那一次的全文，不跟着正在跑的那一轮往下续：要盯着一行行看的人用的是
 * 命令行，这里给的是一次运行完整的记录。
 */
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
					/*
					 * 等宽字体：这些行靠缩进分层级。行高比正文松一档，几百行连着扫才不
					 * 糊成一片。高度由弹层给（`max-h-full`），里面自己滚。
					 */
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
