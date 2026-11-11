import { Tag } from "#/components/ui/tag";
import type { CompanyMeta } from "#/db/schema";
import { dots, duration, period } from "#/lib/format";
import { routeLabel } from "#/search/evidence";
import { type EmployeeDetail, type Evidence, placeOf } from "#/search/result";
import { Dot, phraseLabel } from "./evidence";

/** 证据按 experienceId 索引，一段可能同时是几条主张的证据。 */
type EvidenceIndex = Map<number, Evidence[]>;

export function buildEvidenceIndex(evidence: Evidence[]): EvidenceIndex {
	const index: EvidenceIndex = new Map();
	for (const e of evidence) {
		const list = index.get(e.experienceId);
		if (list) list.push(e);
		else index.set(e.experienceId, [e]);
	}
	return index;
}

/** 任职经历时间线，最近的在最上面；每段的节点是证据点，说这一段是不是证据。 */
export function Timeline({
	rows,
	evidenceIndex,
	names,
}: {
	rows: EmployeeDetail["timeline"];
	evidenceIndex: EvidenceIndex;
	/** 每条主张的名字，按 `Evidence.claim` 的下标。 */
	names: readonly string[];
}) {
	const ordered = [...rows].reverse();
	return (
		<ol>
			{ordered.map((x, i) => (
				<Segment
					evidence={evidenceIndex.get(x.id)}
					isLast={i === ordered.length - 1}
					key={x.id}
					names={names}
					row={x}
				/>
			))}
		</ol>
	);
}

function Segment({
	row: x,
	evidence,
	isLast,
	names,
}: {
	row: EmployeeDetail["timeline"][number];
	evidence: Evidence[] | undefined;
	isLast: boolean;
	names: readonly string[];
}) {
	const external = x.kind === "external";
	// 入职前的段没有登记的序列，只有推断出的一对
	const seq = external
		? dots(x.seqInferredL1, x.seqInferredL2)
		: dots(x.seqL1, x.seqL2, x.seqL3);

	return (
		/* id 是职业轨迹条点击时的滚动目标（career-bar.tsx） */
		<li
			className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2"
			id={`exp-${x.id}`}
		>
			<span className="flex flex-col items-center">
				<span className="flex h-(--text-base--line-height) items-center">
					<Dot className="size-2.5" found={(evidence?.length ?? 0) > 0} />
				</span>
				{!isLast && <span className="w-px flex-1 bg-border" />}
			</span>

			<div className={isLast ? "" : "pb-5"}>
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
					<span className="font-medium">{placeOf(x)}</span>
					<span>{x.title}</span>
					{x.level && (
						<span className="text-fg-secondary text-xs">{x.level}</span>
					)}
					{external && <Tag size="small">入职前</Tag>}
				</div>

				<div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-fg-secondary text-xs">
					<span className="tabular-nums">
						{dots(period(x.startDate, x.endDate), duration(x.months))}
					</span>
					{seq && <span>{external ? `${seq}（推断）` : seq}</span>}
					{external && (
						<CompanyLine industries={x.mainIndustries} meta={x.companyMeta} />
					)}
				</div>
				{x.departmentPath && (
					<p className="text-fg-tertiary text-xs">{x.departmentPath}</p>
				)}

				{evidence && evidence.length > 0 && (
					<MatchedClaims evidence={evidence} names={names} />
				)}

				{/* 算数的是从自述里读出的说法，原话里未必有这几个字，因此原文不做字面高亮。 */}
				{x.description && (
					<p className="read-cjk mt-2 text-fg-secondary text-base" lang="zh">
						{x.description}
					</p>
				)}
			</div>
		</li>
	);
}

/** 这一段为哪些主张提供了证据。是不是证据由节点说，标签不另上色。 */
function MatchedClaims({
	evidence,
	names,
}: {
	evidence: Evidence[];
	names: readonly string[];
}) {
	const seen = new Set<number>();
	const unique = evidence.filter(
		(e) => !seen.has(e.claim) && seen.add(e.claim),
	);

	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			{unique.map((e) => (
				<Tag key={e.claim} size="small">
					{/* 抽取的能力带上算数的那条说法，和旁边的原文对得上 */}
					{dots(names[e.claim], routeLabel(e.route), phraseLabel(e))}
				</Tag>
			))}
		</div>
	);
}

/** 入职前那家公司是什么：人事登记的公司档和企业性质，中间是它的主营行业。 */
function CompanyLine({
	meta,
	industries,
}: {
	meta: CompanyMeta | null;
	industries: string[];
}) {
	// 「未知」是源里的占位串，和空值一样不占一格
	const line = dots(
		...[meta?.company_tag, industries.join("、"), meta?.nature].map((v) =>
			v === "未知" ? "" : v,
		),
	);
	if (!line) return null;
	return <span>{line}</span>;
}
