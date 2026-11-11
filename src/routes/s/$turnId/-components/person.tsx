import { Link } from "@tanstack/react-router";
import { BriefcaseBusinessIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { NavHeaderTitle } from "#/components/ui/app-layout";
import { CopyButton } from "#/components/ui/copy-button";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { Empty } from "#/components/ui/empty";
import { Icon } from "#/components/ui/icon";
import { Skeleton } from "#/components/ui/skeleton";
import { Text } from "#/components/ui/text";
import { dots } from "#/lib/format";
import type { EmployeeDetail, Evidence } from "#/search/result";
import { countedOf } from "../-lib/claim-lines";
import { CareerBar } from "./career-bar";
import { PaneHeader } from "./pane-header";
import { Timeline } from "./timeline";

/* 一个人的详情（`p.$empId.tsx` 的三种内容）：详情、换人途中的骨架、找不到这个工号。 */

/** 详情的外壳：页头吸在顶上，滚到哪都看得见在看谁。骨架和详情共用它，换人时页头不跳。 */
function Pane({
	title,
	close,
	children,
}: {
	title: ReactNode;
	close?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="pb-16" data-pane="detail">
			<PaneHeader
				className="sticky top-0 z-stick bg-container"
				right={close}
				title={title}
			/>
			<div className="flex flex-col gap-4 px-4 pt-4">{children}</div>
		</div>
	);
}

/** 「任职经历」一节：标题和时间线。 */
function Career({ children }: { children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="flex items-center gap-2 px-2 py-1">
				<Icon
					className="text-fg-tertiary"
					icon={BriefcaseBusinessIcon}
					size={16}
				/>
				<Text size="sm" type="secondary" weight="medium">
					任职经历
				</Text>
			</h3>
			<div className="px-3 py-1">{children}</div>
		</section>
	);
}

/** 详情顶上的几条属性。骨架按同一张表画标签，换人时标签一栏不跳。 */
const ATTRIBUTES: {
	label: string;
	value: (e: EmployeeDetail["employee"]) => ReactNode;
}[] = [
	{ label: "部门", value: (e) => e.curDept || "—" },
	{ label: "岗位", value: (e) => dots(e.curTitle, e.curLevel) || "—" },
	{
		label: "序列",
		value: (e) => dots(e.curSeqL1, e.curSeqL2, e.curSeqL3) || "—",
	},
	{
		label: "入职时间",
		value: (e) => <span className="tabular-nums">{e.hireDate ?? "—"}</span>,
	},
	{ label: "招聘渠道", value: (e) => e.recruitment || "—" },
	{
		label: "学历",
		value: (e) =>
			dots(
				e.educationLevel,
				e.school,
				e.schoolTier,
				e.overseasEducated ? "海外学历" : "",
			) || "—",
	},
];

/** 骨架里各条属性值的宽：长短错开，看得出是几行不同的字。 */
const PENDING_WIDTHS = ["60%", "45%", "70%", "30%", "40%", "55%"];

/** 骨架里的时间轴画几段：一屏里看得见的段数，够看出是一条时间轴。 */
const PENDING_STAGES = [0, 1, 2] as const;

/**
 * 换人途中的骨架，和详情同一个形状，属性标签是真的字。等过 `p.$empId.tsx` 的
 * `pendingMs` 才画，快的时候上一个人留着，直到下一个人画出来。
 */
export function PersonPending() {
	return (
		<Pane title={<Skeleton.Text className="w-32" />}>
			<Descriptions>
				{ATTRIBUTES.map(({ label }, i) => (
					<DescriptionsItem key={label} label={label}>
						{/* 块跟在一个零宽字后面排在行内：这一行有字的基线，和标签按基线对齐时行高不变 */}
						{"\u200b"}
						<Skeleton
							className="inline-block align-middle"
							width={PENDING_WIDTHS[i]}
						/>
					</DescriptionsItem>
				))}
			</Descriptions>
			<Career>
				<div className="mb-4">
					<Skeleton height={10} />
					<div className="mt-1.5 flex h-4 items-center justify-between">
						<Skeleton.Text size="xs" width={28} />
						<Skeleton.Text size="xs" width={28} />
					</div>
				</div>
				<ol className="flex flex-col">
					{PENDING_STAGES.map((stage) => (
						<li
							className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2"
							key={stage}
						>
							<span className="flex flex-col items-center pt-2">
								<span className="flex h-(--text-base--line-height) items-center">
									<Skeleton.Avatar size={10} />
								</span>
								{stage < PENDING_STAGES.length - 1 && (
									<span className="w-px flex-1 bg-border" />
								)}
							</span>
							<div className={stage < PENDING_STAGES.length - 1 ? "pb-3" : ""}>
								<div className="px-3 py-2">
									<Skeleton.Text width="45%" />
									<Skeleton.Text className="mt-0.5" size="xs" width="65%" />
								</div>
							</div>
						</li>
					))}
				</ol>
			</Career>
		</Pane>
	);
}

/** 和页面不存在、记录不存在同一个组件族，不给插图。 */
export function PersonNotFound() {
	return (
		<Empty
			description="链接可能已失效，或记录已被清理。"
			title="未找到这位员工"
		/>
	);
}

/**
 * 一个人的详情，用来逐段核对：当前的几条属性和任职经历。
 *
 * `evidence` 是这个人在当前检索里的全部证据，轨迹条和时间线据此标出算数的段；
 * 不在名单上、或名单按人排时是空的。
 */
export function Person({
	employee: e,
	timeline,
	evidence,
}: {
	employee: EmployeeDetail["employee"];
	timeline: EmployeeDetail["timeline"];
	evidence: Evidence[];
}) {
	const counted = countedOf(evidence);

	return (
		/* 换人时整栏淡入一次；按 empId 换 key 让动画重播。 */
		<div className="settle" key={e.empId}>
			<Pane
				close={
					<>
						<CopyButton content={e.empId} size="header" title="复制工号" />
						{/* 关闭是 Link 渲染成的图标按钮：<a> 里嵌 <button> 是非法嵌套。 */}
						<ActionIcon
							icon={XIcon}
							render={
								<Link
									from="/s/$turnId/p/$empId"
									params={(prev) => prev}
									replace
									search={(prev) => prev}
									to="/s/$turnId"
								/>
							}
							size="header"
							title="关闭详情"
							tooltipProps={{ hotkey: "esc" }}
						/>
					</>
				}
				title={
					<>
						<NavHeaderTitle as="h2">{e.name}</NavHeaderTitle>
						<Text className="shrink-0 tabular-nums" type="secondary">
							{e.empId}
						</Text>
					</>
				}
			>
				<Descriptions>
					{ATTRIBUTES.map(({ label, value }) => (
						<DescriptionsItem key={label} label={label}>
							{value(e)}
						</DescriptionsItem>
					))}
				</Descriptions>

				<Career>
					<CareerBar counted={counted} hireDate={e.hireDate} rows={timeline} />
					<Timeline counted={counted} rows={timeline} />
				</Career>
			</Pane>
		</div>
	);
}
