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

/**
 * 技能词表的管理页：哪些写法认成了同一个词、哪个词属于哪个更宽的词。
 *
 * 只读。整理是后台每天自动做的（`src/corpus/vocabulary.ts`），这一页存在的理由是让管理员
 * 看得见它在做什么——筛选栏「入职前技能」上一个词后面的人数，是几种写法加上它下面
 * 的词一起数的，这里能看到是哪几种、下面有谁。没有改的入口：改了下一轮灌库就被盖回去，
 * 一个会被静默撤销的编辑框比没有更糟。想改结论走判定那条路（外部判定方提交），不走这一页。
 *
 * 谁判的、队列里还有几组待判都不上屏：前者是库里的留痕（`skill_term.judge`），排查时查库；
 * 后者是整理任务自己的事，过程在任务台那张卡片的运行记录里。这一页只答「词表认了什么」，
 * 没有第二句话。
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
 * 表：人多的词在前，和筛选栏同一个顺序，于是筛选栏上排第一的词在这里也排第一。
 * 过滤在客户端做——词表是有限集（这一轮一千出头），一次取齐比按键往返快，所以框里
 * 敲一个字就少一批行，不必回车。数据页那个框要回车（几万人得回服务端找），两者形状
 * 因此不同：那边末尾挂着提交按钮，这边起头只有一个漏斗。
 *
 * 也因此这里不翻页，而数据页翻：那边的表是人，会一直长下去，翻页是把库看完的
 * 唯一办法；这边的表是词表本身，看的人是来核对某一个词的，出路是上面那个框。
 * 词表长到翻页比过滤更顺手的那天，这段话就不成立了，那时改的是这一页的形状。
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
			{shown.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>
							{entries.length === 0 ? "还没有技能" : "没有匹配的技能"}
						</EmptyTitle>
						{/* 没匹配上的时候标题已经把话说完了；只有表本身是空的，才需要说该怎么办 */}
						{entries.length === 0 && (
							<EmptyDescription>
								经历处理完成后，这里会列出技能及相关写法。
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
								<TableHead className="text-end">上次更新</TableHead>
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
