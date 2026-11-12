import { Text } from "#/components/ui/text";
import { cn } from "#/lib/utils";
import type { ClaimBasis, Evidence } from "#/search/result";
import { evidenceField, tenureOf } from "../-lib/evidence";

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

	const field = evidenceField(evidence);
	const tenure = tenureOf(evidence, basis);
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
					<span className="text-fg-tertiary">{tenure.label} </span>
					{tenure.duration}
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
