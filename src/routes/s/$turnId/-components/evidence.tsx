import { Text } from "#/components/ui/text";
import { dots, years } from "#/lib/format";
import { cn } from "#/lib/utils";
import { routeLabel } from "#/search/evidence";
import { type ClaimBasis, type Hit, placeOf } from "#/search/result";

/**
 * 证据行与未命中行共用的四列：点、条件词、匹配到的字段、右端时长。
 * 容器够宽（`@xl`）时一行排完，不够时字段挪到第二行、和条件词对齐。
 */
const LINE_GRID =
	"grid grid-cols-[auto_--spacing(24)_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 text-xs";

const MATCHED_BY = "匹配依据";

/** 时间带上命中的段；和证据行的点同一个颜色。 */
export const HIT_FILL = "bg-fg-tertiary";

/** 证据行前的点：命中是深一档的实心点，没命中是浅色的点。 */
export function Dot({ hit, className }: { hit: boolean; className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				hit ? HIT_FILL : "bg-border",
				className,
			)}
		/>
	);
}

export function phraseLabel(hit: Hit) {
	return hit.phrase === null ? null : dots(hit.engagement, hit.phrase);
}

function matchedField(hit: Hit): {
	label: string;
	value: string | null;
	context: string;
} {
	const label = routeLabel(hit.route);
	switch (hit.route) {
		case "role":
			return { label, value: dots(hit.title, placeOf(hit)), context: hit.seq };
		case "title":
			return { label, value: hit.title, context: placeOf(hit) };
		case "description":
			return { label, value: null, context: dots(hit.title, placeOf(hit)) };
		case "skill":
			return {
				label,
				value: phraseLabel(hit),
				context: dots(hit.title, placeOf(hit)),
			};
	}
}

export function evidenceText(name: string, hit: Hit, basis: ClaimBasis) {
	const field = matchedField(hit);
	return dots(
		byOther(name, hit) ? `${MATCHED_BY} ${hit.value}` : null,
		[field.label, field.value ?? field.context].filter(Boolean).join(" "),
		field.value === null ? null : field.context,
		`${basis.external ? "入职前" : "公司内"} ${years(basis.months)}`,
	);
}

function byOther(name: string, hit: Hit) {
	return hit.value !== name;
}

export function EvidenceLine({
	name,
	boost,
	hit,
	basis,
}: {
	name: string;
	boost: boolean;
	hit: Hit;
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

	const field = matchedField(hit);
	const ongoing = basis.endDate === null;

	return (
		<div className="@container">
			<div className={LINE_GRID}>
				<Dot className="translate-y-0.5" hit />
				<span className="col-span-2 min-w-0 @xl:col-span-1">{head}</span>
				<span className="col-span-3 col-start-2 row-start-2 flex min-w-0 items-baseline gap-1.5 @xl:col-span-1 @xl:col-start-3 @xl:row-start-1">
					{byOther(name, hit) && (
						<span className="shrink-0 text-fg-tertiary">
							{MATCHED_BY} {hit.value}
						</span>
					)}
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
			<Dot className="translate-y-0.5" hit={false} />
			<span>未命中</span>
			<Text className="col-span-2 min-w-0" ellipsis>
				{names.join("、")}
			</Text>
		</div>
	);
}
