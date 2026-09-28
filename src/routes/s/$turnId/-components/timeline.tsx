import { Tag } from "#/components/ui/tag";
import type { CompanyMeta, Experience } from "#/db/schema";
import { dots, duration, period } from "#/lib/format";
import { bestStrength, routeLabel } from "#/search/evidence";
import type { Hit } from "#/search/result";
import { Dot, phraseLabel } from "./evidence";

/** 命中按 experienceId 索引，一段可能同时命中多条主张。 */
type HitIndex = Map<number, Hit[]>;

export function buildHitIndex(hits: Hit[]): HitIndex {
	const index: HitIndex = new Map();
	for (const h of hits) {
		const list = index.get(h.experienceId);
		if (list) list.push(h);
		else index.set(h.experienceId, [h]);
	}
	return index;
}

/** 任职经历时间线，最近的在最上面；每段的节点是证据点，说这一段的证据有多强。 */
export function Timeline({
	rows,
	hitIndex,
	names,
}: {
	rows: Experience[];
	hitIndex: HitIndex;
	/** 每条主张的名字，按 `Hit.claim` 的下标。 */
	names: readonly string[];
}) {
	const ordered = [...rows].reverse();
	return (
		<ol>
			{ordered.map((x, i) => (
				<Segment
					hits={hitIndex.get(x.id)}
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
	hits,
	isLast,
	names,
}: {
	row: Experience;
	hits: Hit[] | undefined;
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
					<Dot className="size-2.5" strength={bestStrength(hits)} />
				</span>
				{!isLast && <span className="w-px flex-1 bg-border" />}
			</span>

			<div className={isLast ? "" : "pb-5"}>
				<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-base">
					<span className="font-medium">{x.org}</span>
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
					{x.orgMeta && <CompanyLine meta={x.orgMeta} />}
				</div>
				{!external && x.orgPath && (
					<p className="text-fg-tertiary text-xs">{x.orgPath}</p>
				)}

				{hits && hits.length > 0 && <MatchedClaims hits={hits} names={names} />}

				{/* 语义命中的查询词未必原样出现在自述中，因此原文不做字面高亮。 */}
				{x.description && (
					<p className="read-cjk mt-2 text-fg-secondary text-base" lang="zh">
						{x.description}
					</p>
				)}
			</div>
		</li>
	);
}

/** 这一段为哪些主张提供了证据。强度由节点说，标签不按强度上色。 */
function MatchedClaims({
	hits,
	names,
}: {
	hits: Hit[];
	names: readonly string[];
}) {
	const seen = new Set<number>();
	const unique = hits.filter((h) => !seen.has(h.claim) && seen.add(h.claim));

	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			{unique.map((h) => (
				<Tag key={h.claim} size="small">
					{/* 抽取的两类带上命中的那条说法，和旁边的原文对得上 */}
					{dots(names[h.claim], routeLabel(h.route), phraseLabel(h))}
				</Tag>
			))}
		</div>
	);
}

function CompanyLine({ meta }: { meta: CompanyMeta }) {
	// 「未知」是源里的占位串，和空值一样不占一格
	const line = dots(
		...[meta.company_tag, meta.industry, meta.nature].map((v) =>
			v === "未知" ? "" : v,
		),
	);
	if (!line) return null;
	return <span>{line}</span>;
}
