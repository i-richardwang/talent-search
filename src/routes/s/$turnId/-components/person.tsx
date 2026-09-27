import { Link } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { CareerBar } from "#/components/career-bar";
import { buildHitIndex, Timeline } from "#/components/timeline";
import { ActionIcon } from "#/components/ui/action-icon";
import { NavHeader, NavHeaderTitle } from "#/components/ui/app-layout";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { Empty } from "#/components/ui/empty";
import { Skeleton } from "#/components/ui/skeleton";
import { Tag } from "#/components/ui/tag";
import type { Employee, Experience } from "#/db/schema";
import { dots } from "#/lib/format";
import type { Hit } from "#/search/result";

/*
 * 右栏里一个人的详情（`p.$empId.tsx` 的三种内容）：详情本身、换人途中的骨架、
 * 找不到这个工号。
 */

/**
 * 详情的外壳：顶上一条和旁边各栏等高的页头，吸在顶上，滚到哪都看得见在看谁；
 * 下面是正文。骨架和真身共用它，换人时页头不跳。
 */
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
		<div className="pb-12" data-pane="detail">
			<NavHeader
				className="sticky top-0 z-stick bg-container"
				left={title}
				right={close}
			/>
			<div className="flex flex-col gap-6 px-4 pt-2">{children}</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-2">
			<h3 className="font-semibold text-fg-secondary text-xs">{title}</h3>
			{children}
		</section>
	);
}

export function PersonPending() {
	return (
		<Pane
			title={
				<NavHeaderTitle as="h2">
					<Skeleton height="1lh" width="8rem" />
				</NavHeaderTitle>
			}
		>
			<div className="flex flex-col gap-3">
				<Skeleton height="0.75rem" width="12rem" />
				<Skeleton height="0.75rem" />
				<Skeleton height="0.75rem" width="83.333%" />
			</div>
		</Pane>
	);
}

/** 走到头了：和页面不存在、记录不存在同一个组件族，不给媒介图。 */
export function PersonNotFound() {
	return (
		<Empty
			description="链接可能已失效，或记录已被清理。"
			title="未找到这位员工"
		/>
	);
}

/**
 * 一个人的详情，答的是逐段核对：先是这个人现在的几条属性，再是任职经历——轨迹条给
 * 形状，时间线给每一段的原文。命中摘要和名次在名单那一行，这里不重复。
 *
 * `hits` 是这个人在当前检索里的命中，`names` 是各条主张的名字；不在名单上的人两者都是空的。
 */
export function Person({
	employee: e,
	timeline,
	hits,
	names,
}: {
	employee: Employee;
	timeline: Experience[];
	hits: Hit[];
	names: string[];
}) {
	const hitIndex = buildHitIndex(hits);

	return (
		/* ↑↓ 连着换人时整栏淡入一次（settle），160ms，赶在下一次按键之前结束。 */
		<div className="settle" key={e.empId}>
			<Pane
				close={
					/* 关闭是 Link 渲染成的图标按钮：<a> 里嵌 <button> 是非法嵌套。 */
					<ActionIcon
						aria-label="关闭详情"
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
						title="关闭详情（Esc）"
					/>
				}
				title={
					<>
						<NavHeaderTitle as="h2">{e.name}</NavHeaderTitle>
						<Tag className="shrink-0 font-mono" size="small">
							{e.empId}
						</Tag>
					</>
				}
			>
				<Descriptions>
					<DescriptionsItem label="部门">{e.curDept || "—"}</DescriptionsItem>
					<DescriptionsItem label="岗位">
						{dots(e.curTitle, e.curLevel) || "—"}
					</DescriptionsItem>
					<DescriptionsItem label="序列">
						{dots(e.curSeqL1, e.curSeqL2, e.curSeqL3) || "—"}
					</DescriptionsItem>
					<DescriptionsItem label="入职时间">
						<span className="tabular-nums">{e.hireDate ?? "—"}</span>
					</DescriptionsItem>
					<DescriptionsItem label="招聘来源">
						{e.recruitment || "—"}
					</DescriptionsItem>
					<DescriptionsItem label="教育背景">
						{dots(e.educationLevel, e.school) || "—"}
					</DescriptionsItem>
				</Descriptions>

				<Section title="任职经历">
					<CareerBar
						hireDate={e.hireDate}
						hitIndex={hitIndex}
						rows={timeline}
					/>
					<Timeline hitIndex={hitIndex} names={names} rows={timeline} />
				</Section>
			</Pane>
		</div>
	);
}
