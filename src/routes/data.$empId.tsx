import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Frame, FramePanel } from "#/components/ui/frame";
import {
	Sheet,
	SheetDescription,
	SheetHeader,
	SheetPanel,
	SheetPopup,
	SheetTitle,
} from "#/components/ui/sheet";
import { dots, duration, period } from "#/lib/format";
import type { SegmentView } from "#/server/data";
import { dataEmployee } from "#/server/functions";
import { StatusBadge } from "./-components/status-badge";

/**
 * 一个人的每一段经历：登记的字段和解析出的结果并排展示。
 *
 * 用抽屉从右侧覆盖，而不是跳转到新页面。管理数据的人是顺着表往下看的——看一个、
 * 回到表、再看下一个；跳页的话每次返回，表格都已经滚回顶部。抽屉底下的表保持
 * 原样，关掉就能接着刚才那一行继续。
 *
 * 每一段展示四件事：登记的内容（同步写入）、对齐到哪个序列、抽取出的能力词和做过
 * 的事（派生写入），以及这一段有没有派生到当前版本——没有的话下面那些是上一版的
 * 结果，或者还是空的。
 */
export const Route = createFileRoute("/data/$empId")({
	loader: async ({ params }) => {
		const data = await dataEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Person,
	notFoundComponent: () => (
		<PersonSheet title="没有这个工号">
			<Empty>
				<EmptyHeader>
					<EmptyTitle>这个人不在库里</EmptyTitle>
					<EmptyDescription>
						工号写错了，或者他还没被同步进来。
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</PersonSheet>
	),
});

/**
 * 这一层的壳。**真身和「没有这个工号」共用**——两处各写一遍开合与回列表的路的话，
 * 改一次就会有一处忘掉。
 *
 * 开合是路由说了算（地址栏里有工号这一份档案就在开着），但动画得由组件自己走完：
 * 关的时候先把 `open` 落下去让它滑回右边，滑完了（`onOpenChangeComplete`）才回
 * `/data`——直接导航的话这一层是被卸掉的，不是滑走的。开也同理：挂上来的时候是
 * 开着的就没有起始态可言，所以先挂成关的，紧接着这一帧再打开。
 */
function PersonSheet({
	title,
	description,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
}) {
	const navigate = useNavigate();
	const { q } = Route.useSearch();
	const [open, setOpen] = useState(false);
	useEffect(() => setOpen(true), []);
	return (
		<Sheet
			onOpenChange={setOpen}
			onOpenChangeComplete={(opened) => {
				if (!opened) void navigate({ search: { q }, to: "/data" });
			}}
			open={open}
		>
			{/* 表里的段落带着组织路径，28rem 一行放不下几个字，给到详情栏宽的那一档 */}
			<SheetPopup className="sm:max-w-detail-wide">
				<SheetHeader>
					<SheetTitle>{title}</SheetTitle>
					{description}
				</SheetHeader>
				<SheetPanel className="flex flex-col gap-4">{children}</SheetPanel>
			</SheetPopup>
		</Sheet>
	);
}

function Person() {
	const { employee, segments } = Route.useLoaderData();
	return (
		<PersonSheet
			description={
				<>
					<SheetDescription>
						{dots(
							employee.curDept,
							employee.curTitle,
							employee.curLevel,
							[employee.curSeqL1, employee.curSeqL2, employee.curSeqL3]
								.filter(Boolean)
								.join(" · "),
						)}
					</SheetDescription>
					<p className="text-muted-foreground text-xs">
						{dots(
							employee.hireDate ? `${employee.hireDate} 入职` : null,
							employee.recruitment,
							employee.educationLevel,
							employee.school,
						)}
					</p>
				</>
			}
			title={
				<>
					{employee.name}
					<span className="ms-2 font-mono font-normal text-muted-foreground text-sm">
						{employee.empId}
					</span>
				</>
			}
		>
			{/*
			 * 每一段是托盘里的一块面（`Frame`，排法照上游 `p-frame-3`）：这些段是同一个人
			 * 的一份档案，一段接一段往下读，而面与面之间透出来的那几毫米托盘色说的正是
			 * 「还在同一份里」。
			 */}
			{segments.length === 0 ? (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>还没有经历记录</EmptyTitle>
						<EmptyDescription>
							导入时没有生成经历，所以还没有可解析的内容。
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
		</PersonSheet>
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
							s.derived ? `解析于 ${s.derivedAt}` : null,
						)}
					</p>
				</div>
				{/*
				 * 徽章只在待解析时出现。解析成功是这一页上绝大多数段的常态，给常态
				 * 也发徽章的话，一栏里会是十几块相同的绿色，真正需要注意的那一段反而
				 * 不显眼。解析成功的时间用小字显示，跟这一段的其余事实排在一起。
				 */}
				{!s.derived && <StatusBadge tone="waiting">待解析</StatusBadge>}
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
				<Fact label="技能">
					{s.skills.length ? (
						s.skills.join("、")
					) : (
						<span className="text-muted-foreground">无</span>
					)}
				</Fact>
				<Fact label="职责">
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
 * 事实网格里的一行。标签用 `label` 那一档字号——12px 配次要色的话，标签和内容
 * 完全一样，两栏之间就只剩缩进来区分（详情面板的事实网格同理，
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
