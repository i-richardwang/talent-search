import { Block } from "#/components/ui/block";
import { Tag } from "#/components/ui/tag";
import type { CompanyMeta } from "#/db/schema";
import { dots, duration, period } from "#/lib/format";
import { type EmployeeDetail, placeOf } from "#/search/result";
import { Dot } from "./evidence";

/**
 * 任职经历时间线，最近的在最上面。算数的段整段铺一块底，节点是实心的证据点：
 * HR 直接在那一段上读岗位和原文核对，不另写它为哪条条件算数。
 */
export function Timeline({
	rows,
	counted,
}: {
	rows: EmployeeDetail["timeline"];
	/** 算数的经历段（`claim-lines.ts` 的 `countedOf`）。 */
	counted: ReadonlySet<number>;
}) {
	const ordered = [...rows].reverse();
	return (
		<ol>
			{ordered.map((x, i) => (
				<Segment
					hit={counted.has(x.id)}
					isLast={i === ordered.length - 1}
					key={x.id}
					row={x}
				/>
			))}
		</ol>
	);
}

function Segment({
	row: x,
	hit,
	isLast,
}: {
	row: EmployeeDetail["timeline"][number];
	hit: boolean;
	isLast: boolean;
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
			{/* 顶上让出段内的上边距，节点和第一行字对齐 */}
			<span className="flex flex-col items-center pt-2">
				<span className="flex h-(--text-base--line-height) items-center">
					<Dot className="size-2.5" found={hit} />
				</span>
				{!isLast && <span className="w-px flex-1 bg-border" />}
			</span>

			<div className={isLast ? "" : "pb-3"}>
				{/* 不算数的段同样留边距，各段的字对齐 */}
				<Block className="px-3 py-2" variant={hit ? "filled" : "borderless"}>
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

					{/* 算不算是读过整段之后的结论，原话里未必有哪几个字，因此原文不做字面高亮。 */}
					{x.description && (
						<p className="read-cjk mt-2 text-fg-secondary text-base" lang="zh">
							{x.description}
						</p>
					)}
				</Block>
			</div>
		</li>
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
