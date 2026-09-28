import type { ReactNode } from "react";
import { Block } from "#/components/ui/block";
import { CopyButton } from "#/components/ui/copy-button";
import { Descriptions, DescriptionsItem } from "#/components/ui/descriptions";
import { Empty } from "#/components/ui/empty";
import type { Employee } from "#/db/schema";
import { dots, duration, integer, period } from "#/lib/format";
import { involvementRank } from "#/lib/involvement";
import type { SegmentView } from "#/server/data";
import {
	DETAIL_LABEL_WIDTH,
	DetailDrawer,
	DetailSection,
} from "../../-components/detail-drawer";
import { StatusBadge } from "../../-components/status-badge";

/** 数据页一个人的抽屉，这个人和「没有这个工号」共用，宽度只写这一次。 */
export function EmployeeDrawer({
	close,
	title,
	extra,
	description,
	children,
}: {
	close: () => void;
	title: ReactNode;
	extra?: ReactNode;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<DetailDrawer
			/* 表里的段落带着组织路径，详情档一行放不下几个字，给到宽的那一档 */
			width="var(--container-detail-wide)"
			close={close}
			description={description}
			extra={extra}
			title={title}
		>
			{children}
		</DetailDrawer>
	);
}

/** 一个人的档案和他名下的每一段：登记的字段和解析出的结果并排。 */
export function EmployeeRecord({
	employee,
	segments,
	close,
}: {
	employee: Employee;
	segments: SegmentView[];
	close: () => void;
}) {
	const sequence = [employee.curSeqL1, employee.curSeqL2, employee.curSeqL3]
		.filter(Boolean)
		.join(" · ");
	const profile: [label: string, value: string | null][] = [
		["部门", employee.curDept],
		["岗位", employee.curTitle],
		["职级", employee.curLevel],
		["序列", sequence || null],
		["入职时间", employee.hireDate],
		["招聘渠道", employee.recruitment],
		["学历", employee.educationLevel],
		["学校", employee.school],
	];
	return (
		<EmployeeDrawer
			close={close}
			description={
				<Descriptions labelWidth={DETAIL_LABEL_WIDTH}>
					{profile.map(([label, value]) =>
						value ? (
							<DescriptionsItem key={label} label={label}>
								{value}
							</DescriptionsItem>
						) : null,
					)}
				</Descriptions>
			}
			extra={<CopyButton content={employee.empId} title="复制工号" />}
			title={
				<>
					{employee.name}
					<span className="ms-2 font-normal text-fg-secondary text-base tabular-nums">
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
				KINDS.map(([kind, label]) => {
					const part = segments.filter((one) => one.kind === kind);
					return part.length === 0 ? null : (
						<DetailSection
							count={`${integer(part.length)} 段`}
							key={kind}
							title={label}
						>
							<div className="flex flex-col gap-2">
								{part.map((segment) => (
									<Segment key={segment.id} segment={segment} />
								))}
							</div>
						</DetailSection>
					);
				})
			)}
		</EmployeeDrawer>
	);
}

/**
 * 两组的先后与名字，名字与证据行共用同一套说法。分界读 `kind`，不从入职日推：
 * 内部经历的开始日可能早于入职日（并购、转正）。
 */
const KINDS = [
	["external", "入职前"],
	["internal", "公司内"],
] as const;

/**
 * 做过的事按参与方式归组，组序按 `involvementRank`。按出现的值分组：清单外的取值
 * 和没判断出参与方式的排在最后，也照样显示。
 */
function didGroups(did: SegmentView["did"]) {
	const kinds = [...new Set(did.map((one) => one.involvement))].sort(
		(a, b) => involvementRank(a) - involvementRank(b),
	);
	return (
		<Descriptions size="small">
			{kinds.map((kind) => (
				<DescriptionsItem key={kind ?? ""} label={kind}>
					{did
						.filter((one) => one.involvement === kind)
						.map((one) => one.domain)
						.join("、")}
				</DescriptionsItem>
			))}
		</Descriptions>
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
				{!s.derived && <StatusBadge tone="pending">待处理</StatusBadge>}
			</div>
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
						/* 这一栏里唯一成段读的文字 */
						<DescriptionsItem label="描述">
							<span className="read-cjk block">{s.description}</span>
						</DescriptionsItem>
					)}
				</Descriptions>
			)}
		</Block>
	);
}
