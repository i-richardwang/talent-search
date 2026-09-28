import { Button } from "#/components/ui/button";
import { Popover } from "#/components/ui/popover";
import { Text } from "#/components/ui/text";
import { dots, years } from "#/lib/format";
import { cn } from "#/lib/utils";
import { routeLabel, type Strength, strengthOf } from "#/search/evidence";
import type { ClaimBasis, Hit } from "#/search/result";

const STRENGTH_LABEL: Record<Strength, string> = {
	controlled: "岗位或序列",
	org: "部门或公司",
	claimed: "简历自述",
};

/**
 * 证据行与未命中行共用的四列：点、条件词、匹配到的字段、右端时长。
 * 容器够宽（`@xl`）时一行排完，不够时字段挪到第二行、和条件词对齐。
 */
const LINE_GRID =
	"grid grid-cols-[auto_--spacing(24)_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 text-xs";

const MATCHED_BY = "匹配依据";

const STRENGTH_HINT: Record<Strength, string> = {
	controlled: "来自任职记录",
	org: "部门或公司名称与条件相近",
	claimed: "来自入职前简历，本人自述、无校验",
};

const DOT_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-fg-tertiary",
	claimed: "bg-transparent ring-1 ring-fg-tertiary ring-inset",
};

/** 时间带中的 claimed 需要可见底色，不能复用点阵的空心样式。 */
export const BAND_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-fg-tertiary",
	claimed: "bg-fill-tertiary ring-1 ring-fg-quaternary ring-inset",
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

const STRENGTHS = ["controlled", "org", "claimed"] as const;

export function StrengthGuide() {
	return (
		<dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-sm">
			{STRENGTHS.map((s) => (
				<div className="contents" key={s}>
					<dt className="flex items-center gap-2 whitespace-nowrap">
						<Dot strength={s} />
						{STRENGTH_LABEL[s]}
					</dt>
					<dd className="text-fg-secondary text-xs">{STRENGTH_HINT[s]}</dd>
				</div>
			))}
		</dl>
	);
}

/** 名单表头的图例，展开是 `StrengthGuide`。 */
export function StrengthLegend() {
	return (
		<Popover content={<StrengthGuide />} placement="bottomRight">
			<Button className="text-fg-secondary" size="small" type="text">
				<span className="flex items-center gap-1">
					{STRENGTHS.map((s) => (
						<Dot key={s} strength={s} />
					))}
				</span>
				匹配来源
			</Button>
		</Popover>
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
				<Dot className="translate-y-0.5" strength={strengthOf(hit.route)} />
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
			<Dot className="translate-y-0.5" strength={undefined} />
			<span>未命中</span>
			<Text className="col-span-2 min-w-0" ellipsis>
				{names.join("、")}
			</Text>
		</div>
	);
}
