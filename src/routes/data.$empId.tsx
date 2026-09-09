import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Frame, FramePanel } from "#/components/ui/frame";
import { dots, duration, period } from "#/lib/format";
import type { SegmentView } from "#/server/data";
import { dataEmployee } from "#/server/functions";
import { StatusBadge } from "./-components/status-badge";

/**
 * 一个人的每一段，原始的一半和派生的一半并排放着。
 *
 * 这一栏开在列表右边，换人不丢列表和找人的词。每一段说四件事：登记的是什么
 * （同步写的）、对到了哪个序列、抽出了哪些能力词和做过的事（派生写的）、以及
 * 这一段派生到当前版本了没有——没有的话下面那些是上一版的，或者还是空的。
 */
export const Route = createFileRoute("/data/$empId")({
	loader: async ({ params }) => {
		const data = await dataEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Person,
	notFoundComponent: () => (
		<Rail>
			<Empty>
				<EmptyHeader>
					<EmptyTitle>没有这个工号</EmptyTitle>
					<EmptyDescription>这个人不在库里，或者工号写错了。</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</Rail>
	),
});

/**
 * 这一栏的壳。**真身和「没有这个工号」共用**——两处各写一遍宽度和那条线的话，
 * 改一次宽度就会有一处忘掉，而忘掉的表现是打错工号时整页的分栏跳一下。
 *
 * 它不像工作台那条详情栏那样吸顶、自己滚：那一栏是浮在一列候选人之上的面板，
 * 扫名单和核对证据来回切；这一页是一份从上到下读的档案，整页一起滚就是对的
 * （AGENTS.md「页面这一层不套 `ScrollArea`」）。宽屏之外它排到表格下面，
 * 因为两栏并排的下限是这 28rem 加上一张读得下的表。
 */
function Rail({ children }: { children: ReactNode }) {
	return (
		<aside className="settle flex w-full shrink-0 flex-col gap-4 xl:w-detail xl:border-border xl:border-s xl:ps-6">
			{children}
		</aside>
	);
}

function Person() {
	const { employee, segments } = Route.useLoaderData();
	return (
		/* key + settle：换人时这一栏整体淡入一次，和工作台的详情面板同一个交代。 */
		<Rail key={employee.empId}>
			<div className="flex flex-col gap-1">
				<h2 className="title-2 font-semibold">
					{employee.name}
					<span className="ms-2 font-mono font-normal text-muted-foreground text-sm">
						{employee.empId}
					</span>
				</h2>
				<p className="text-muted-foreground text-sm">
					{dots(
						employee.curDept,
						employee.curTitle,
						employee.curLevel,
						[employee.curSeqL1, employee.curSeqL2, employee.curSeqL3]
							.filter(Boolean)
							.join(" · "),
					)}
				</p>
				<p className="text-muted-foreground text-xs">
					{dots(
						employee.hireDate ? `${employee.hireDate} 入职` : null,
						employee.recruitment,
						employee.educationLevel,
						employee.school,
					)}
				</p>
			</div>
			{/*
			 * 每一段是托盘里的一块面（`Frame`，排法照上游 `p-frame-3`）：这些段是同一个人
			 * 的一份档案，一段接一段往下读，而面与面之间透出来的那几毫米托盘色说的正是
			 * 「还在同一份里」。
			 */}
			{segments.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>这个人没有经历段</EmptyTitle>
						<EmptyDescription>
							同步没有给他切出段来，派生因此也没有东西可算。
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			) : (
				<Frame>
					{segments.map((segment) => (
						<Segment key={segment.id} segment={segment} />
					))}
				</Frame>
			)}
		</Rail>
	);
}

function Segment({ segment: s }: { segment: SegmentView }) {
	const registered = [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · ");
	const inferred = [s.seqInferredL1, s.seqInferredL2]
		.filter(Boolean)
		.join(" · ");
	return (
		<FramePanel className="flex flex-col gap-3 text-sm">
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<p className="font-medium">
						{s.title || "（无岗位）"}
						<span className="ms-2 font-normal text-muted-foreground">
							{s.kind === "internal" ? s.orgPath || s.org : s.org}
						</span>
					</p>
					<p className="text-muted-foreground text-xs tabular-nums">
						{dots(
							period(s.startDate, s.endDate),
							duration(s.months),
							s.level,
							s.derived ? `派生于 ${s.derivedAt}` : null,
						)}
					</p>
				</div>
				{/*
				 * 徽章只在**待派生**时出现。派生成功是这一页上绝大多数段的常态，
				 * 给常态发一枚徽章，一栏里就是十几块一模一样的绿——真正要人看见的
				 * 那一段反而淹在里面。派生成功的时间是一句小字，跟着这一段的其余事实走。
				 */}
				{!s.derived && <StatusBadge tone="waiting">待派生</StatusBadge>}
			</div>
			<dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 text-xs">
				<Fact label="序列">
					{registered ||
						(inferred ? (
							<>
								{inferred}
								<span className="text-muted-foreground">（对齐）</span>
							</>
						) : (
							<span className="text-muted-foreground">无</span>
						))}
				</Fact>
				<Fact label="能力词">
					{s.skills.length ? (
						s.skills.join("、")
					) : (
						<span className="text-muted-foreground">无</span>
					)}
				</Fact>
				<Fact label="做过的事">
					{s.did.length ? (
						s.did
							.map((d) =>
								d.involvement ? `${d.involvement} · ${d.domain}` : d.domain,
							)
							.join("、")
					) : (
						<span className="text-muted-foreground">无</span>
					)}
				</Fact>
				{s.description && (
					/* 简历原文是这一栏里唯一成段读的东西，行高走 `read-cjk` 那一档 */
					<Fact label="描述">
						<span className="read-cjk block">{s.description}</span>
					</Fact>
				)}
			</dl>
		</FramePanel>
	);
}

/**
 * 事实网格里的一行。标签走 `label` 那一档——12px 加次要色和这一格里的内容
 * 长得一模一样，分区的边界就只剩缩进在扛（详情面板的事实网格同理，
 * 见 `s/$turnId/p.$empId.tsx`）。
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className="label text-muted-foreground">{label}</dt>
			<dd className="whitespace-pre-wrap">{children}</dd>
		</>
	);
}
