import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { dots, years } from "#/lib/format";
import { cn } from "#/lib/utils";
import { routeLabel, type Strength, strengthOf } from "#/search/evidence";
import type { ClaimBasis, Hit } from "#/search/result";

const STRENGTH_LABEL: Record<Strength, string> = {
	controlled: "岗位或序列",
	org: "部门或公司",
	claimed: "简历自述",
};

const NAME_W = "w-22";

const MATCHED_BY = "比的是";

const STRENGTH_HINT: Record<Strength, string> = {
	controlled: "来自任职记录",
	org: "部门或公司名称与条件相近",
	claimed: "来自入职前简历，本人自述、无校验",
};

const DOT_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-muted-foreground/60",
	claimed: "bg-transparent ring-1 ring-muted-foreground/50 ring-inset",
};

/** 时间带中的 claimed 需要可见底色，不能复用点阵的空心样式。 */
export const BAND_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-muted-foreground/60",
	claimed: "bg-muted ring-1 ring-muted-foreground/40 ring-inset",
};

export function Dot({
	strength,
	className,
}: {
	strength: Strength | undefined;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				strength ? DOT_FILL[strength] : "bg-border",
				className,
			)}
		/>
	);
}

export function StrengthLegend() {
	return (
		<dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
			<dt className="label text-muted-foreground">匹配来源</dt>
			{(["controlled", "org", "claimed"] as const).map((s) => (
				<dd className="text-muted-foreground text-xs" key={s}>
					<Tooltip>
						<TooltipTrigger className="flex cursor-help items-center gap-1.5">
							<Dot strength={s} />
							{STRENGTH_LABEL[s]}
						</TooltipTrigger>
						<TooltipPopup>{STRENGTH_HINT[s]}</TooltipPopup>
					</Tooltip>
				</dd>
			))}
		</dl>
	);
}

export function phraseLabel(hit: Hit) {
	return hit.phrase === null ? null : dots(hit.involvement, hit.phrase);
}

function matchedField(hit: Hit): {
	label: string;
	value: string | null;
	context: string;
} {
	const label = routeLabel(hit.route);
	if (hit.route === null) return { label, value: hit.title, context: hit.org };
	switch (hit.route) {
		case "seq":
			return { label, value: hit.seq, context: hit.org };
		case "title":
			return { label, value: hit.title, context: hit.org };
		case "org":
			return { label, value: hit.org, context: hit.title };
		case "description":
			return { label, value: null, context: dots(hit.title, hit.org) };
		case "skill":
		case "did":
			return {
				label,
				value: phraseLabel(hit),
				context: dots(hit.title, hit.org),
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
	return hit.value !== null && hit.value !== name;
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
		<span className="flex min-w-0 items-center gap-1.5">
			{boost && <span className="font-mono text-muted-foreground">+</span>}
			<span className="truncate">{name}</span>
		</span>
	);

	const field = matchedField(hit);
	const ongoing = basis.endDate === null;

	return (
		<div className="flex items-baseline gap-2.5 text-sm">
			<Dot className="translate-y-1" strength={strengthOf(hit.route)} />
			<span className={cn(NAME_W, "shrink-0")}>{head}</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
				{byOther(name, hit) && (
					<span className="shrink-0 text-muted-foreground text-xs">
						{MATCHED_BY} {hit.value}
					</span>
				)}
				{field.label ? (
					<span className="shrink-0 text-muted-foreground text-xs">
						{field.label}
					</span>
				) : null}
				{field.value === null ? (
					<span className="min-w-0 truncate text-muted-foreground">
						{field.context}
					</span>
				) : (
					<span className="min-w-0 truncate">
						{field.value}
						{field.context && (
							<span className="ml-2 text-muted-foreground">
								{field.context}
							</span>
						)}
					</span>
				)}
			</span>
			<span
				className={cn(
					"shrink-0 whitespace-nowrap tabular-nums",
					ongoing ? "text-foreground" : "text-muted-foreground",
				)}
			>
				<span className="text-muted-foreground">
					{basis.external ? "入职前 " : "公司内 "}
				</span>
				{years(basis.months)}
			</span>
		</div>
	);
}

export function MissedClaims({ names }: { names: string[] }) {
	if (names.length === 0) return null;
	return (
		<div className="flex items-baseline gap-2.5 text-muted-foreground text-sm">
			<Dot className="translate-y-1" strength={undefined} />
			<span className={cn(NAME_W, "shrink-0")}>未命中</span>
			<span className="min-w-0 flex-1 truncate">{names.join("、")}</span>
		</div>
	);
}
