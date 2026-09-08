import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { ScrollArea } from "#/components/ui/scroll-area";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { beginImport, importStatus } from "#/server/functions";
import type { ImportRunView, ImportState } from "#/server/import";

/**
 * 导入的管理页：按一下开始，看着它跑，跑完看它说了什么。
 *
 * 导入是这个应用自己的一次运行，不是外面某个脚本干的事——所以它有一个入口、
 * 一份过程、一份历史，和搜索共用同一个进程与同一个库。命令行那条路
 * （`bun run import`）走同一条锁、同一份记录、同一个过程，只是它等到跑完。
 */
export const Route = createFileRoute("/imports")({
	loader: () => importStatus(),
	head: () => ({ meta: [{ title: "导入 · 人才搜索" }] }),
	component: Imports,
});

/** 还在跑的时候多久重新取一次状态。 */
const POLL_MS = 2000;

/**
 * 一行记录在这一页上说成什么。
 *
 * 判成哪一种不在这一侧——那要问「此刻锁在谁手上」，只有服务端答得了
 * （`src/server/import.ts`）。这里只把它译成字。
 */
const SAID: Record<ImportRunView["outcome"], string> = {
	running: "正在跑",
	interrupted: "中断，没有跑完",
	failed: "失败了",
	done: "成功",
};

function Imports() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const [starting, setStarting] = useState(false);
	const [refused, setRefused] = useState(false);
	const running = state.latest?.outcome === "running";

	/*
	 * 跑的时候自己去问进展。这是唯一一处需要「隔一会儿再看一眼」的界面：一次导入
	 * 几十分钟，而进度长在库里那一行上。停在没跑的时候就不问——按钮按下去之后
	 * 由那次跳转把它重新打开。
	 */
	useEffect(() => {
		if (!running) return;
		const timer = setInterval(() => void router.invalidate(), POLL_MS);
		return () => clearInterval(timer);
	}, [running, router]);

	async function start() {
		setStarting(true);
		try {
			const { started } = await beginImport();
			setRefused(!started);
			await router.invalidate();
		} finally {
			setStarting(false);
		}
	}

	return (
		<main className="app-column flex flex-1 flex-col gap-6 py-8">
			<div className="flex items-start justify-between gap-4">
				<div className="flex flex-col gap-1">
					<h1 className="title-1 font-semibold">导入</h1>
					<p className="text-muted-foreground text-sm">{summary(state)}</p>
				</div>
				<Button disabled={running} loading={starting} onClick={start}>
					{running ? "正在导入" : "开始导入"}
				</Button>
			</div>
			{refused && (
				/*
				 * 按下去没开成，只可能是别处已经有一次在跑。这句话说的是**那一下**，
				 * 所以用过去时，之后那次跑完了它也仍然成立；它活到下一下按下去为止，
				 * 不跟着状态清——两次点击之间那一次刚好跑完的话，下面那条记录说不出
				 * 「你刚才为什么没开成」，那正是最需要它的时候。
				 */
				<Alert>
					<AlertTitle>这次没有开起来</AlertTitle>
					<AlertDescription>按下去的时候已经有一次导入在跑。</AlertDescription>
				</Alert>
			)}
			{state.latest === null ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>还没有导入过</EmptyTitle>
						<EmptyDescription>
							按上面那个按钮，或者在命令行跑 bun run import。不配数据源时读的是
							仓库自带的合成样例。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<>
					{state.latest.outcome === "failed" && (
						/*
						 * 页面级的失败用 `Alert` 的红，和「没能提交」那两处同一档：它说的是
						 * 「这次跑失败了」，读不成命中（绿）、选中（蓝）或查询上的提示（amber）。
						 */
						<Alert variant="error">
							<AlertTitle>这次导入没有跑完</AlertTitle>
							<AlertDescription>{state.latest.error}</AlertDescription>
						</Alert>
					)}
					<RunLog lines={state.latest.log} />
				</>
			)}
			{state.history.length > 0 && <History runs={state.history} />}
		</main>
	);
}

/** 抬头那一句：最近一次是什么时候、读的哪个源、跑成什么样。 */
export function summary({ latest }: ImportState): string {
	if (!latest)
		return "语料由导入建立：读数据源、切段校验、抽取与嵌入，最后原子发布。";
	const what =
		latest.outcome === "done"
			? `用时 ${latest.seconds ?? 0}s`
			: SAID[latest.outcome];
	return `最近一次 ${latest.startedAt} 从 ${latest.source} 读，${what}。`;
}

/**
 * 这一次说过的每一行。
 *
 * 它就是命令行里滚过去的那些字——拒绝了几段、为什么拒绝、合并了哪些写法、
 * 各表最后几行。验收一次导入靠的全是它们，所以从网页按下按钮的人也得看得到。
 * 等宽字体：这些行靠缩进分层级。
 *
 * 它是这一页的主面：占掉标题和历史之外的全部高度、里面自己滚，和 `/s/:id` 上
 * 那两块自滚的面同一个道理。几千行日志不能把页面撑长，所以高度来自版面而不是
 * 内容；`min-h-60` 是屏幕矮的时候留给它的底。
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
export function History({ runs }: { runs: ImportRunView[] }) {
	return (
		<div className="flex flex-col gap-3">
			<h2 className="font-medium text-sm">更早的导入</h2>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>开始</TableHead>
						<TableHead>数据源</TableHead>
						<TableHead className="text-end">用时</TableHead>
						<TableHead>结果</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{runs.map((run) => (
						<TableRow key={run.id}>
							<TableCell className="tabular-nums">{run.startedAt}</TableCell>
							<TableCell className="text-muted-foreground">
								{run.source}
							</TableCell>
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
