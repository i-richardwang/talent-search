import { Text } from "#/components/ui/text";
import { dots, years } from "#/lib/format";
import { cn } from "#/lib/utils";
import { routeLabel } from "#/search/evidence";
import { type ClaimBasis, type Evidence, placeOf } from "#/search/result";

/**
 * 证据行与未命中行共用的四列：点、条件词、匹配到的字段、右端时长。
 * 容器够宽（`@xl`）时一行排完，不够时字段挪到第二行、和条件词对齐。
 */
const LINE_GRID =
	"grid grid-cols-[auto_--spacing(24)_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 text-xs";

/** 时间带上有证据的段；和证据行的点同一个颜色。 */
export const EVIDENCE_FILL = "bg-fg-tertiary";

/** 证据行前的点：有证据是深一档的实心点，没有是浅色的点。 */
export function Dot({
	found,
	className,
}: {
	found: boolean;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				found ? EVIDENCE_FILL : "bg-border",
				className,
			)}
		/>
	);
}

export function phraseLabel(evidence: Evidence) {
	return evidence.phrase === null
		? null
		: dots(evidence.engagement, evidence.phrase);
}

function matchedField(evidence: Evidence): {
	label: string;
	value: string | null;
	context: string;
} {
	const label = routeLabel(evidence.route);
	switch (evidence.route) {
		case "role":
			return {
				label,
				value: dots(evidence.title, placeOf(evidence)),
				context: evidence.seq,
			};
		case "title":
			return { label, value: evidence.title, context: placeOf(evidence) };
		case "description":
			return {
				label,
				value: null,
				context: dots(evidence.title, placeOf(evidence)),
			};
		case "skill":
			return {
				label,
				value: phraseLabel(evidence),
				context: dots(evidence.title, placeOf(evidence)),
			};
	}
}

export function evidenceText(evidence: Evidence, basis: ClaimBasis) {
	const field = matchedField(evidence);
	return dots(
		[field.label, field.value ?? field.context].filter(Boolean).join(" "),
		field.value === null ? null : field.context,
		`${basis.external ? "入职前" : "公司内"} ${years(basis.months)}`,
	);
}

export function EvidenceLine({
	name,
	boost,
	evidence,
	basis,
}: {
	name: string;
	boost: boolean;
	evidence: Evidence;
	basis: ClaimBasis;
}) {
	const head = (
		<span className="flex min-w-0 items-baseline gap-1.5">
			<Text className="min-w-0" ellipsis type="secondary">
				{name}
			</Text>
			{boost && (
				<Text className="shrink-0" size="xs" type="tertiary">
					加分
				</Text>
			)}
		</span>
	);

	const field = matchedField(evidence);
	const ongoing = basis.endDate === null;

	return (
		<div className="@container">
			<div className={LINE_GRID}>
				<Dot className="translate-y-0.5" found />
				<span className="col-span-2 min-w-0 @xl:col-span-1">{head}</span>
				<span className="col-span-3 col-start-2 row-start-2 flex min-w-0 items-baseline gap-1.5 @xl:col-span-1 @xl:col-start-3 @xl:row-start-1">
					{field.label ? (
						<span className="shrink-0 text-fg-tertiary">{field.label}</span>
					) : null}
					<Text className="min-w-0" ellipsis type="tertiary">
						{field.value ?? field.context}
						{field.value !== null && field.context && (
							<span className="ml-2 text-fg-quaternary">{field.context}</span>
						)}
					</Text>
				</span>
				<span
					className={cn(
						"col-start-4 row-start-1 whitespace-nowrap tabular-nums",
						ongoing ? "text-fg-secondary" : "text-fg-tertiary",
					)}
				>
					<span className="text-fg-tertiary">
						{basis.external ? "入职前 " : "公司内 "}
					</span>
					{years(basis.months)}
				</span>
			</div>
		</div>
	);
}

export function MissedClaims({ names }: { names: string[] }) {
	if (names.length === 0) return null;
	return (
		<div className={`${LINE_GRID} text-fg-tertiary`}>
			<Dot className="translate-y-0.5" found={false} />
			<span>未命中</span>
			<Text className="col-span-2 min-w-0" ellipsis>
				{names.join("、")}
			</Text>
		</div>
	);
}
