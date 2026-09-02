import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { years } from "#/lib/format";
import { cn } from "#/lib/utils";
import { type Strength, strengthOf } from "#/search/evidence";
import type { Hit, TermBasis } from "#/search/result";
import type { Route } from "#/search/weights";

export const ROUTE_LABEL: Record<Route, string> = {
	seq: "序列",
	title: "岗位",
	org: "部门或公司",
	description: "简历原文",
};

const STRENGTH_LABEL: Record<Strength, string> = {
	controlled: "岗位或序列",
	org: "部门或公司",
	claimed: "简历原文",
};

const STRENGTH_HINT: Record<Strength, string> = {
	controlled: "来自任职记录",
	org: "部门或公司名称与条件相近",
	claimed: "来自入职前简历原文",
};

/**
 * 证据强度点：这套界面的设计签名。
 *
 * 三档强度用**填充方式**而不是三种颜色区分：实心 / 实心灰 / 空心构成一个不依赖
 * 色觉的序列，打印成黑白或色弱下顺序依然成立。色相只是最硬那一档的加成。
 *
 * 最硬那一档用 `success`，不用 `warning`：amber 已经归「未识别语气」和
 * 「没处放的条件」两条提示所有，拿它画受控命中会让「最可信」和「有问题」共用一个
 * 颜色，而它们在同一屏上并排出现。
 *
 * 8px 是这个编码可判读的下限——再小，空心和实心灰在正常观看距离上分不开，
 * 所以尺寸不开放成参数。
 */
const DOT_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-muted-foreground/60",
	claimed: "bg-transparent ring-1 ring-muted-foreground/50 ring-inset",
};

/**
 * 同一套三档画成色块时的样子（career-bar.tsx 用）。
 *
 * 只差一处：「仅简历自述」在点上是空心，在色块上得有底——一个 6px 宽的空心块在
 * 浅灰带子上几乎看不出来，而它必须和「这一段没命中」区分得开。
 *
 * 两份写在一起，因为它们必须一起改：分开放会让某天只改了点没改色块，
 * 于是同一个强度在两个视图里长得不一样，而那正是编码失效的方式。
 */
export const BAND_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-muted-foreground/60",
	claimed: "bg-muted ring-1 ring-muted-foreground/40 ring-inset",
};

export function Dot({
	strength,
	className,
}: {
	/** 没有证据时留空：画一个比空心还淡的占位，保持这一列的节奏不断 */
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

/**
 * 图例。一行，排在名单正上方——它必须和它解释的那些点同屏。
 *
 * 放进任何一个「空着才显示」的位置都是错的：那类位置空着的时候，正意味着屏幕上
 * 一颗点都没有；一旦有点可对照，图例又被真正的内容顶掉了。
 *
 * 代价是常占一行，所以压成一行：三个词、三颗点。详细说明挂在 Tooltip 上。
 */
export function StrengthLegend() {
	return (
		<dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
			<dt className="label text-muted-foreground">匹配来源</dt>
			{(["controlled", "org", "claimed"] as const).map((s) => (
				<Tooltip key={s}>
					<TooltipTrigger
						render={
							<dd className="flex items-center gap-1.5 text-muted-foreground text-xs">
								<Dot strength={s} />
								{STRENGTH_LABEL[s]}
							</dd>
						}
					/>
					<TooltipPopup>{STRENGTH_HINT[s]}</TooltipPopup>
				</Tooltip>
			))}
		</dl>
	);
}

/**
 * 相关度的显示形态：整数百分比。它是一个用户能理解的量（「这段经历和你的
 * 条件有多像」），所以直接给数；「同义 / 相近」这类档位会额外制造一套刻度。
 */
export function relevance(value: number) {
	return `${Math.round(value * 100)}%`;
}

/**
 * 命中的那一段经历里，**实际拿去比相关度的是哪个字段**——「凭什么算命中」在
 * 行内当场答完，不必点进详情。
 *
 * 取的是命中那一路自己的字段值，不是固定取岗位。给错字段比不给更坏：屏幕上会
 * 出现一个和条件毫不相干的岗位名，读起来像是系统匹配错了。
 *
 * `description` 这一路只有 `label` 没有 `value`：命中事实里不带原文（见
 * `search/result.ts` 的 `Hit`），所以这里不假装引用一句话。可核对的完整原文
 * 在详情栏的时间线上。
 */
function matchedField(hit: Hit): {
	label: string;
	/** 拿去比相关度的那串字。没有可给的就是 null。 */
	value: string | null;
	/** 这一段经历的身份，用来回答「这是哪儿的事」。 */
	context: string;
} {
	const label = ROUTE_LABEL[hit.route];
	switch (hit.route) {
		case "seq":
			return { label, value: hit.seq, context: hit.org };
		case "title":
			return { label, value: hit.title, context: hit.org };
		case "org":
			return { label, value: hit.org, context: hit.title };
		case "description":
			return { label, value: null, context: `${hit.title} · ${hit.org}` };
	}
}

/**
 * 一个人一个条件的一行证据。五段固定的槽，所有人的所有行共用同一套列位置——
 * 这是把表格旋转成块之后仍然能上下扫的原因，只不过那条竖线上现在写着凭据。
 *
 *   [点] [条件词]  [命中的字段值 · 这段经历在哪]    [相关度]  [时长]
 *
 * 相关度取 `basis.relevance`（最硬那条证据的相关度），时长取 `basis.months`（并列
 * 最硬的那些段的累计月数）——正是参与打分的那两个值；取样例段的数会让两个
 * 排名不同的人显示同一个数，而这个界面的说服力全在于「看得见的东西能解释
 * 看到的名次」。
 *
 * 只画命中。没命中的条件由 `MissedTerms` 收成一行。
 */
export function EvidenceLine({
	term,
	boost,
	hit,
	basis,
}: {
	/** 这一行属于哪条要求（主词） */
	term: string;
	/** 加分词。必须词是默认，默认不该有标记。 */
	boost: boolean;
	/** 展示用的样例段：点的强度、命中字段、这段经历的身份都来自它 */
	hit: Hit;
	/** 打分用的聚合值。缺席时退回样例段，这一行不会因此空掉。 */
	basis: TermBasis | null | undefined;
}) {
	const name = (
		<span className="flex min-w-0 items-center gap-1.5">
			{boost && <span className="font-mono text-muted-foreground">+</span>}
			<span className="truncate">{term}</span>
		</span>
	);

	const field = matchedField(hit);
	const months = basis?.months ?? hit.months;
	const rel = basis?.relevance ?? hit.relevance;
	const external = basis ? basis.external : hit.kind === "external";
	const ongoing = (basis ? basis.endDate : hit.endDate) === null;

	return (
		<div className="flex items-baseline gap-2.5 text-sm">
			<Dot className="translate-y-1" strength={strengthOf(hit.route)} />
			<span className="w-[5.5rem] shrink-0">{name}</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
				{/*
				 * 来源标签在字段值前面，不在后面：读到那串岗位名之前就得先知道
				 * 「这是岗位还是部门」，否则「区域安全」四个字读完了还要回头找
				 * 它是从哪儿来的。12px 次要色，它是标签不是内容。
				 */}
				<span className="shrink-0 text-muted-foreground text-xs">
					{field.label}
				</span>
				{field.value === null ? (
					<span className="min-w-0 truncate text-muted-foreground">
						{field.context}
					</span>
				) : (
					<span className="min-w-0 truncate">
						{field.value}
						{/*
						 * 上下文靠**留白加变色**接上去，不用 ` · `。
						 *
						 * 分隔点在这里是二义的：序列自己就是用 ` · ` 连三级的
						 * （lib/format 的 seqLabel），再拿同一个符号接部门，屏幕上
						 * 得到的是「技术 · 算法 · 乘客定价」——读者没有任何线索
						 * 判断哪一截还是序列、哪一截已经是部门了。
						 * 一个 8px 的空档配上降一档的字色，分层是明确的，
						 * 而且不必再发明第二个分隔符。
						 */}
						{field.context && (
							<span className="ml-2 text-muted-foreground">
								{field.context}
							</span>
						)}
					</span>
				)}
			</span>
			{/* 相关度：这一行凭什么算命中的第二半。它是参与打分的那个数。 */}
			<span
				className="w-9 shrink-0 text-right text-muted-foreground text-xs tabular-nums"
				title="与条件的相关度"
			>
				{relevance(rel)}
			</span>
			<span
				className={cn(
					"shrink-0 whitespace-nowrap tabular-nums",
					ongoing ? "text-foreground" : "text-muted-foreground",
				)}
			>
				{external && <span className="text-muted-foreground">前 </span>}
				{years(months)}
			</span>
		</div>
	);
}

/**
 * 没命中的那些条件，收成一行。
 *
 * 「未命中」逐条各占一行的话，五个条件的查询里每一块有三四行读不出东西的灰字，
 * 高度翻倍而信息量为零。但它不能不说：一个条件在这个人身上没有证据，是关于
 * 这个人的一个事实，留白只会让人以为这一行还没加载完。
 *
 * 槽位和命中行对齐（点、标签列、内容列），所以它读起来仍然是这份证据的一行，
 * 不是一句附注。
 */
export function MissedTerms({ terms }: { terms: string[] }) {
	if (terms.length === 0) return null;
	return (
		<div className="flex items-baseline gap-2.5 text-muted-foreground text-sm">
			<Dot className="translate-y-1" strength={undefined} />
			<span className="w-[5.5rem] shrink-0">未命中</span>
			<span className="min-w-0 flex-1 truncate">{terms.join("、")}</span>
		</div>
	);
}
