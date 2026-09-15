import { createFileRoute } from "@tanstack/react-router";
import { FilterIcon } from "lucide-react";
import { useState } from "react";
import { CardFrame } from "#/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "#/components/ui/input-group";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { skillTable } from "#/server/functions";
import type { SkillEntry, SkillTable } from "#/server/skills";
import { AdminPage } from "./-components/admin-page";
import { reviewingOf, reviewStatus } from "./-lib/review-status";

/**
 * 技能词表的管理页：哪些写法认成了同一个词、哪个词属于哪个更宽的词，谁下的结论。
 *
 * 只读。整理是后台每天自动做的（`src/corpus/vocabulary.ts`），这一页存在的理由是让管理员
 * 看得见它在做什么——筛选栏「入职前技能」上一个词后面的人数，是几种写法加上它下面
 * 的词一起数的，这里能看到是哪几种、下面有谁。没有改的入口：改了下一轮灌库就被盖回去，
 * 一个会被静默撤销的编辑框比没有更糟。想改结论走判卷那条路（外部裁判交卷），不走这一页。
 *
 * 判卷可以交给外部 agent（`REVIEW_JUDGE`），所以表上多一列「判定」，页顶多一句
 * 此刻谁在判。归外部时那句话带上「还有几道题等人答」：没有它，一页停止增长的
 * 词表和一页正常工作的词表长得一模一样。
 */
export const Route = createFileRoute("/skills")({
	loader: () => skillTable(),
	head: () => ({ meta: [{ title: "技能 · 人才搜索" }] }),
	component: Skills,
});

function Skills() {
	const table = Route.useLoaderData();
	return (
		<AdminPage title="技能">
			<SkillList table={table} />
		</AdminPage>
	);
}

function daysAgo(days: number) {
	return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * 「判定」那一格：库里存的是 `model:qwen3` 这样的字，屏幕上不给这种字。
 *
 * 名字照出——外部接上好几个工具时，管理员要认得出是哪一个。
 */
function judgedBy(judge: string): string {
	const [kind, ...rest] = judge.split(":");
	const name = rest.join(":");
	if (kind === "model") return `模型 ${name}`;
	if (kind === "agent") return `外部 ${name}`;
	return judge;
}

/**
 * 表：人多的词在前，和筛选栏同一个顺序，于是筛选栏上排第一的词在这里也排第一。
 * 过滤在客户端做——表就几百行，一次取齐比按键往返快，所以框里敲一个字就少一批行，
 * 不必回车。数据页那个框要回车（几万人得回服务端找），两者形状因此不同：
 * 那边末尾挂着提交按钮，这边起头只有一个漏斗。
 *
 * 表照 coss 的排法摆：`CardFrame` 裹一张 `variant="card"` 的表。裸表是一堆
 * 靠发丝线切开的行直接坐在画布上——那正是后台的长相，而这套系统里「一块内容」
 * 就该是一块有顶光边的面。
 */
function SkillList({ table }: { table: SkillTable }) {
	const { entries } = table;
	const [needle, setNeedle] = useState("");
	const shown = entries.filter((e) => matches(e, needle.trim()));
	return (
		<div className="flex flex-col gap-3">
			{/*
			 * 「谁在判」放在筛选框旁边，不放在页面标题下：标题下那句是概述，而这句
			 * 说的是这张表当前的状态，属于表本身（`-components/admin-page.tsx`）。
			 */}
			<div className="flex flex-wrap items-center justify-between gap-3">
				<InputGroup className="max-w-72">
					<InputGroupInput
						aria-label="搜索技能"
						onChange={(event) => setNeedle(event.target.value)}
						placeholder="搜索技能"
						type="search"
						value={needle}
					/>
					<InputGroupAddon>
						<FilterIcon />
					</InputGroupAddon>
				</InputGroup>
				{/* 当前由谁判词表（写法该不该合并、词属于哪个更宽的词）。任务台整理那张
				    卡片显示同一句话，文案只有一个出处（`-lib/review-status.ts`）。 */}
				<p className="text-muted-foreground text-xs">
					{reviewStatus(reviewingOf(table))}
				</p>
			</div>
			{shown.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>
							{entries.length === 0 ? "还没有技能" : "没有匹配的技能"}
						</EmptyTitle>
						{/* 没匹配上的时候标题已经把话说完了；只有表本身是空的，才需要说该怎么办 */}
						{entries.length === 0 && (
							<EmptyDescription>
								配置抽取端点并完成解析后，这里会列出合并结果。
							</EmptyDescription>
						)}
					</EmptyHeader>
				</Empty>
			) : (
				<CardFrame>
					<Table variant="card">
						<TableHeader>
							<TableRow>
								<TableHead>技能</TableHead>
								<TableHead className="text-end">人数</TableHead>
								<TableHead>属于</TableHead>
								<TableHead>其他写法</TableHead>
								<TableHead>判定</TableHead>
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
									<TableCell className="text-muted-foreground">
										{e.parent ?? "—"}
									</TableCell>
									{/* 这一格允许换行：一个词并进十来种写法是常事，截断就看不到了 */}
									<TableCell className="whitespace-normal text-muted-foreground">
										{e.aliases.length ? e.aliases.join("、") : "—"}
									</TableCell>
									<TableCell className="text-muted-foreground">
										{judgedBy(e.judge)}
									</TableCell>
									<TableCell className="text-end text-muted-foreground tabular-nums">
										{daysAgo(e.reviewedDaysAgo)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardFrame>
			)}
		</div>
	);
}

function matches(e: SkillEntry, needle: string) {
	if (!needle) return true;
	const lower = needle.toLowerCase();
	return [e.canonical, e.parent ?? "", ...e.aliases].some((w) =>
		w.toLowerCase().includes(lower),
	);
}
