import { Fragment, type ReactNode } from "react";
import { Block } from "#/components/ui/block";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { DrawerDescription } from "#/components/ui/drawer";
import { Empty } from "#/components/ui/empty";
import type { Employee } from "#/db/schema";
import { dots, duration, period } from "#/lib/format";
import { involvementRank } from "#/lib/involvement";
import type { SegmentView } from "#/server/data";
import { DetailDrawer } from "../../-components/detail-drawer";
import { StatusBadge } from "../../-components/status-badge";

/*
 * 数据页点开一个人（`routes/data/$empId.tsx`）：抽屉的壳，和壳里这个人的每一段经历——
 * 登记的字段和解析出的结果并排。
 */

/**
 * 这一层的壳，**真身和「没有这个工号」共用**——宽度只在这里写一次。关掉往哪回由
 * 调用方给（`close`），开合与动画归 `DetailDrawer`（技能页点一个词用的是同一件东西）。
 */
export function EmployeeDrawer({
	close,
	title,
	description,
	children,
}: {
	/** 滑回右边之后往哪走：回到刚才那张表 */
	close: () => void;
	title: ReactNode;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<DetailDrawer
			/* 表里的段落带着组织路径，详情档一行放不下几个字，给到宽的那一档 */
			width="var(--container-detail-wide)"
			close={close}
			description={description}
			title={title}
		>
			{children}
		</DetailDrawer>
	);
}

/**
 * 一个人的档案和他名下的每一段。`close` 由路由给：关掉抽屉回到刚才那张表。
 */
export function EmployeeRecord({
	employee,
	segments,
	close,
}: {
	employee: Employee;
	segments: SegmentView[];
	close: () => void;
}) {
	return (
		<EmployeeDrawer
			close={close}
			description={
				<>
					<DrawerDescription className="text-fg-secondary text-sm">
						{dots(
							employee.curDept,
							employee.curTitle,
							employee.curLevel,
							[employee.curSeqL1, employee.curSeqL2, employee.curSeqL3]
								.filter(Boolean)
								.join(" · "),
						)}
					</DrawerDescription>
					<p className="text-fg-secondary text-xs">
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
					<span className="ms-2 font-mono font-normal text-fg-secondary text-base">
						{employee.empId}
					</span>
				</>
			}
		>
			{segments.length === 0 ? (
				<Empty
					description="名下还没有经历记录，请联系管理员。"
					title="还没有经历记录"
				/>
			) : (
				<div className="flex flex-col gap-5">
					{KINDS.map(([kind, label]) => {
						const part = segments.filter((one) => one.kind === kind);
						return part.length === 0 ? null : (
							<section className="flex flex-col gap-2" key={kind}>
								<h3 className="text-xs font-medium text-fg-secondary">
									{label} · {part.length} 段
								</h3>
								{/* 一组是填充的 `Block` 里放描边的 `Block`：同一个人的一份档案 */}
								<Block gap={4} padding={4}>
									{part.map((segment) => (
										<Segment key={segment.id} segment={segment} />
									))}
								</Block>
							</section>
						);
					})}
				</div>
			)}
		</EmployeeDrawer>
	);
}

/**
 * 两组各叫什么，以及先画哪一组。分界读 `kind` 字段，不从入职日推：内部经历的开始日
 * 可能早于入职日（并购、转正）。标题一组画一次；用词和证据行的「公司内」「入职前」一致。
 */
const KINDS = [
	["external", "入职前"],
	["internal", "公司内"],
] as const;

/**
 * 做过的事，按参与方式归组：每种参与方式说一次，后面跟它下面的几件事。参与方式
 * 不进检索（见 `db/schema.ts` 的 `involvement`），只给读的人看。
 *
 * 组的先后照 `lib/involvement.ts` 的原序；清单外的取值和没判断出参与方式的排在最后，
 * 左边那一格空着。按出现的值分组，意外的取值也照样显示。
 */
function didGroups(did: SegmentView["did"]) {
	const kinds = [...new Set(did.map((one) => one.involvement))].sort(
		(a, b) => involvementRank(a) - involvementRank(b),
	);
	return (
		<div className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1">
			{kinds.map((kind) => (
				<Fragment key={kind ?? ""}>
					<span className="text-fg-secondary">{kind}</span>
					<span>
						{did
							.filter((one) => one.involvement === kind)
							.map((one) => one.domain)
							.join("、")}
					</span>
				</Fragment>
			))}
		</div>
	);
}

function Segment({ segment: s }: { segment: SegmentView }) {
	const registered = [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · ");
	const inferred = [s.seqInferredL1, s.seqInferredL2]
		.filter(Boolean)
		.join(" · ");
	return (
		<Block className="text-base" gap={12} padding={16} variant="outlined">
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col gap-0.5">
					<p className="font-medium">
						{s.title || "（无岗位）"}
						<span className="ms-2 font-normal text-fg-secondary">
							{s.kind === "internal" ? s.orgPath || s.org : s.org}
						</span>
					</p>
					<p className="text-fg-secondary text-xs tabular-nums">
						{dots(period(s.startDate, s.endDate), duration(s.months), s.level)}
					</p>
				</div>
				{/* 徽章只标待处理的段；已处理是常态，不标 */}
				{!s.derived && <StatusBadge tone="waiting">待处理</StatusBadge>}
			</div>
			{/* 属性只列这一段有的；一条都没有就整块不画 */}
			{(registered ||
				inferred ||
				s.skills.length > 0 ||
				s.did.length > 0 ||
				s.description) && (
				<Descriptions size="small">
					{(registered || inferred) && (
						<DescriptionsItem label="序列">
							{registered || (
								<>
									{inferred}
									<span className="text-fg-secondary">（推断）</span>
								</>
							)}
						</DescriptionsItem>
					)}
					{s.skills.length > 0 && (
						<DescriptionsItem label="技能">
							{s.skills.join("、")}
						</DescriptionsItem>
					)}
					{s.did.length > 0 && (
						<DescriptionsItem label="职责">{didGroups(s.did)}</DescriptionsItem>
					)}
					{s.description && (
						/* 简历原文是这一栏里唯一成段读的东西，行高走 `read-cjk` 那一档 */
						<DescriptionsItem label="描述">
							<span className="read-cjk block">{s.description}</span>
						</DescriptionsItem>
					)}
				</Descriptions>
			)}
		</Block>
	);
}
