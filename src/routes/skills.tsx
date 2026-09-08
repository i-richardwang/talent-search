import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { dots } from "#/lib/format";
import { skillTable } from "#/server/functions";
import type { SkillEntry, SkillTable } from "#/server/skills";

/**
 * 能力词对照表的管理页：机器把哪些写法并成了哪个词。
 *
 * 只读。整理是 ETL 自动做的（`etl/aliases.py`），这一页存在的理由是让管理员
 * 看得见它在做什么——筛选栏「入职前能力」上一个词后面的人数，是几种写法加起来
 * 的，这里能看到是哪几种。没有改的入口：改了下一轮灌库就被机器盖回去，一个
 * 会被静默撤销的编辑框比没有更糟。
 */
export const Route = createFileRoute("/skills")({
	loader: () => skillTable(),
	head: () => ({ meta: [{ title: "能力词 · 人才搜索" }] }),
	component: Skills,
});

function Skills() {
	const table = Route.useLoaderData();
	return (
		<main className="app-column flex flex-1 flex-col gap-6 py-8">
			<div className="flex flex-col gap-1">
				<h1 className="title-1 font-semibold">能力词</h1>
				<p className="text-muted-foreground text-sm">{summary(table)}</p>
			</div>
			<SkillList entries={table.entries} />
		</main>
	);
}

/** 抬头那一句：语料里有多少个词，机器合并了多少，上次是什么时候。 */
export function summary({ vocabulary, entries }: SkillTable) {
	const merged = entries.filter((e) => e.aliases.length > 0);
	const aliases = merged.reduce((n, e) => n + e.aliases.length, 0);
	const latest = entries.length
		? Math.min(...entries.map((e) => e.reviewedDaysAgo))
		: null;
	return dots(
		`语料里 ${vocabulary} 个能力词`,
		`${merged.length} 个标准词并进了 ${aliases} 种写法`,
		latest === null ? "还没整理过" : `上次整理${daysAgo(latest)}`,
	);
}

function daysAgo(days: number) {
	return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * 表：人多的词在前，和筛选栏同一个顺序，于是筛选栏上排第一的词在这里也排第一。
 * 过滤在客户端做——表就几百行，一次取齐比按键往返快。
 */
export function SkillList({ entries }: { entries: SkillEntry[] }) {
	const [needle, setNeedle] = useState("");
	const shown = entries.filter((e) => matches(e, needle.trim()));
	return (
		<div className="flex flex-col gap-3">
			<Input
				aria-label="按词过滤"
				className="max-w-72"
				onChange={(event) => setNeedle(event.target.value)}
				placeholder="按词过滤"
				type="search"
				value={needle}
			/>
			{shown.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>
							{entries.length === 0 ? "对照表还是空的" : "没有匹配的词"}
						</EmptyTitle>
						<EmptyDescription>
							{entries.length === 0
								? "配置抽取端点后跑一次 ETL，机器会开始整理。"
								: "换个写法试试，别名也在匹配范围里。"}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>标准词</TableHead>
							<TableHead className="text-end">人数</TableHead>
							<TableHead>并进来的写法</TableHead>
							<TableHead className="text-end">上次整理</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{shown.map((e) => (
							<TableRow key={e.canonical}>
								<TableCell className="font-medium">{e.canonical}</TableCell>
								<TableCell className="text-end tabular-nums">
									{e.people}
								</TableCell>
								{/* 这一格允许换行：一个词并进十来种写法是常事，截断就看不到了 */}
								<TableCell className="whitespace-normal text-muted-foreground">
									{e.aliases.length ? e.aliases.join("、") : "—"}
								</TableCell>
								<TableCell className="text-end text-muted-foreground tabular-nums">
									{daysAgo(e.reviewedDaysAgo)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			)}
		</div>
	);
}

function matches(e: SkillEntry, needle: string) {
	if (!needle) return true;
	const lower = needle.toLowerCase();
	return [e.canonical, ...e.aliases].some((w) =>
		w.toLowerCase().includes(lower),
	);
}
