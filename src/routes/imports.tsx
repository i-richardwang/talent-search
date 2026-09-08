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
 * （`bun run import`）跑的是同一个函数，只是多一份回显。
 */
export const Route = createFileRoute("/imports")({
	loader: () => importStatus(),
	head: () => ({ meta: [{ title: "导入 · 人才搜索" }] }),
	component: Imports,
});

/** 还在跑的时候多久重新取一次状态。 */
const POLL_MS = 2000;

/**
 * 一行记录在这一页上是三种样子中的哪一种。
 *
 * 判据住在页面这一侧：它读的是**给页面看的那份视图**（用时算在库里、错误是一句
 * 话），服务端那边没有第二个读者。放过去还会把整个 `#/server/import` 拖进客户端
 * 包——那个模块碰连接，构建当场就红。
 */
export function runOutcome(run: {
	seconds: number | null;
	error: string | null;
}): "running" | "failed" | "done" {
	if (run.seconds === null) return "running";
	return run.error ? "failed" : "done";
}

function Imports() {
	const state = Route.useLoaderData();
	const router = useRouter();
	const [starting, setStarting] = useState(false);
	const [refused, setRefused] = useState(false);
	const running =
		state.latest !== null && runOutcome(state.latest) === "running";

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
				 * 按下去没开成，只可能是别处已经有一次在跑。多数时候下面那条记录
				 * 自己就说明了这件事，但两次点击之间那一次刚好跑完的话就说明不了
				 * ——那正是最需要一句话的时候。
				 */
				<Alert>
					<AlertTitle>这次没有开起来</AlertTitle>
					<AlertDescription>
						已经有一次导入在跑，等它结束再试。
					</AlertDescription>
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
					{state.latest.error && (
						/*
						 * 红只在这里用，全站没有第二处：它说的是「这次跑失败了」，读不成
						 * 命中（绿）、选中（蓝）或查询上的提示（amber）里的任何一件事。
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
	const what = {
		running: "正在跑",
		failed: "失败了",
		done: `用时 ${latest.seconds ?? 0}s`,
	}[runOutcome(latest)];
	return `最近一次 ${latest.startedAt} 从 ${latest.source} 读，${what}。`;
}

/**
 * 这一次说过的每一行。
 *
 * 它就是命令行里滚过去的那些字——拒绝了几段、为什么拒绝、合并了哪些写法、
 * 各表最后几行。验收一次导入靠的全是它们，所以从网页按下按钮的人也得看得到。
 * 等宽字体：这些行靠缩进分层级。
 */
export function RunLog({ lines }: { lines: string[] }) {
	return (
		<Card className="h-100 p-0">
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
								{run.error ?? "成功"}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
