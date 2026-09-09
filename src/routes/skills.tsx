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
import type { SkillEntry } from "#/server/skills";
import { AdminPage } from "./-components/admin-page";

/**
 * 能力词对照表的管理页：机器把哪些写法并成了哪个词。
 *
 * 只读。整理是后台每天自动做的（`src/corpus/aliases.ts`），这一页存在的理由是让管理员
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
		<AdminPage title="能力词">
			<SkillList entries={table.entries} />
		</AdminPage>
	);
}

function daysAgo(days: number) {
	return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * 表：人多的词在前，和筛选栏同一个顺序，于是筛选栏上排第一的词在这里也排第一。
 * 过滤在客户端做——表就几百行，一次取齐比按键往返快，所以框里敲一个字就少一批行，
 * 不必回车。数据页那个框要回车（几万人得回服务端找），两者形状因此不同：
 * 那边末尾挂着提交按钮，这边起头只有一枚漏斗。
 *
 * 表照 coss 的排法摆：`CardFrame` 裹一张 `variant="card"` 的表。裸表是一堆
 * 靠发丝线切开的行直接坐在画布上——那正是后台的长相，而这套系统里「一块内容」
 * 就该是一块有顶光边的面。
 */
function SkillList({ entries }: { entries: SkillEntry[] }) {
	const [needle, setNeedle] = useState("");
	const shown = entries.filter((e) => matches(e, needle.trim()));
	return (
		<div className="flex flex-col gap-3">
			<InputGroup className="max-w-72">
				<InputGroupInput
					aria-label="按词过滤"
					onChange={(event) => setNeedle(event.target.value)}
					placeholder="按词过滤"
					type="search"
					value={needle}
				/>
				<InputGroupAddon>
					<FilterIcon />
				</InputGroupAddon>
			</InputGroup>
			{shown.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>
							{entries.length === 0 ? "对照表还是空的" : "没有匹配的词"}
						</EmptyTitle>
						{/* 没匹配上的时候标题已经把话说完了；只有表本身是空的，才需要说该怎么办 */}
						{entries.length === 0 && (
							<EmptyDescription>
								配置抽取端点，派生跑过之后整理会开始归并。
							</EmptyDescription>
						)}
					</EmptyHeader>
				</Empty>
			) : (
				<CardFrame>
					<Table variant="card">
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
				</CardFrame>
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
