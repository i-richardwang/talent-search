import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { dots, years } from "#/lib/format";
import { cn } from "#/lib/utils";
import { routeLabel, type Strength, strengthOf } from "#/search/evidence";
import type { ClaimBasis, Hit } from "#/search/result";

/**
 * 图例上这三档各叫什么。说的是**这一档证据是谁写的**，所以最弱那一档叫「简历
 * 自述」而不是「简历原文」：那是路的名字（`search/evidence.ts` 的 `ROUTE_LABEL`），
 * 只指还没被模型读过的段。同一个词既当档名又当路名的话，图例写着「简历原文」、
 * 证据行写着「技能」，而它们是同一颗点。
 */
const STRENGTH_LABEL: Record<Strength, string> = {
	controlled: "岗位或序列",
	org: "部门或公司",
	claimed: "简历自述",
};

/**
 * 主张名字那一列的宽度。命中行和「未命中」那一行共用——差一档，那条竖线上的
 * 内容就会在同一块卡片里错开，而这一列存在的全部理由就是它上下对齐。
 */
const NAME_W = "w-22";

/**
 * 「这一行比的是条件里的哪个取值」的前缀。屏幕上和导出的 CSV 用的是同一个词
 * （`evidenceText`）。
 */
const MATCHED_BY = "比的是";

const STRENGTH_HINT: Record<Strength, string> = {
	controlled: "来自任职记录",
	org: "部门或公司名称与条件相近",
	claimed: "来自入职前简历，本人自述、无校验",
};

/**
 * 证据强度点：这套界面的设计签名。
 *
 * 三档强度用**填充方式**而不是三种颜色区分：实心 / 实心灰 / 空心构成一个不依赖
 * 色觉的序列，打印成黑白或色弱下顺序依然成立。色相只是最强那一档的加成。
 *
 * 最强那一档用 `success`，不用 `warning`：amber 已经归「要留意」的状态所有，
 * 拿它画受控命中会让「最可信」和「有问题」共用一个颜色。
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
				<dd className="text-muted-foreground text-xs" key={s}>
					<Tooltip>
						{/* 触发器留着 `TooltipTrigger` 自己的 `<button>`：这三条说明正是
						    「不确定这颗点是什么」的人要读的，而键盘只走得到可聚焦的
						    元素。焦点环由 styles.css 那条 `:where(a, button)` 补齐。 */}
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

/**
 * 抽取的两类命中的那条说法怎么显示：能力词就是它自己；做过的事在领域前面
 * 加上参与方式，「从零搭建 · 推荐系统」。这是参与方式唯一被拼进文本的地方。
 */
export function phraseLabel(hit: Hit) {
	return hit.phrase === null ? null : dots(hit.involvement, hit.phrase);
}

/**
 * 命中的那一段经历里，**实际拿去比相关度的是哪个字段**——「凭什么算命中」在
 * 行内当场答完，不必点进详情。
 *
 * 取的是命中那一类自己的字段值，不是固定取岗位。给错字段比不给更坏：屏幕上会
 * 出现一个和条件毫不相干的岗位名，读起来像是系统匹配错了。没有比文本的命中
 * （「待过字节」那种主张）没有字段可指，说的是这一段本身：岗位加在哪。
 *
 * `description` 这一类只有 `label` 没有 `value`：命中事实里不带原文（见
 * `search/result.ts` 的 `Hit`），所以这里不显示引用一句话。可核对的完整原文
 * 在详情栏的时间线上。抽取的两类给的是命中的那条说法（`phraseLabel`）：它是
 * 用户核对「模型读出来的对不对」的对象，原文同样在时间线上。
 */
function matchedField(hit: Hit): {
	label: string;
	/** 拿去比相关度的那串字。没有可给的就是 null。 */
	value: string | null;
	/** 这一段经历的身份，用来回答「这是哪儿的事」。 */
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

/**
 * 同一行证据写成一句话，给导出的 CSV 用（`-lib/csv.ts`）。
 *
 * 和 `EvidenceLine` 挨着放，是因为它们说的是同一件事，只是一个画在屏幕上、
 * 一个写进单元格里：分开放的话，某天屏幕上改了那几个槽的说法，导出的那一份
 * 用的还是旧的，而两份都不会有任何检查报出来。
 *
 * 槽的顺序和屏幕上一致：拿去比的词、命中的字段和这段经历在哪、时长。
 */
export function evidenceText(name: string, hit: Hit, basis: ClaimBasis) {
	const field = matchedField(hit);
	return dots(
		byOther(name, hit) ? `${MATCHED_BY} ${hit.value}` : null,
		[field.label, field.value ?? field.context].filter(Boolean).join(" "),
		field.value === null ? null : field.context,
		`${basis.external ? "入职前" : "公司内"} ${years(basis.months)}`,
	);
}

/** 靠代表词之外的另一个经历词命中的：证据行上得先说出「拿去比的是哪个词」。 */
function byOther(name: string, hit: Hit) {
	return hit.value !== null && hit.value !== name;
}

/**
 * 一个人一条主张的一行证据。四段固定的槽，所有人的所有行共用同一套列位置——
 * 这是把表格旋转成块之后仍然能上下扫的原因，只不过那条竖线上现在写着凭据。
 *
 *   [点] [主张]  [比的是 取值] [命中的字段值 · 这段经历在哪]  [时长]
 *
 * 靠这条条件的另一个取值命中时，字段值前面先写「比的是 推荐算法」：这一行凭
 * 什么算命中，第一个要答的就是「拿去比的是哪个词」——chip 上写的是「算法」，
 * 比的是「推荐算法」，不说清的话这一行是在拿一个屏幕上没有的词算命中。
 * 靠代表词命中的不写：默认不该有记号。
 *
 * 写成词而不是一个记号：chip 上的 `≈` 说的是「这条条件还有别的取值」，
 * 同一个符号在这里说「用的是别的取值」，两件事共用一个记号就没法读了。
 *
 * 时长取 `basis.months`（并列最强的那些段的累计月数），正是参与打分的那个值：
 * 取样例段的月数会让两个排名不同的人显示同一个数，而这个界面的说服力全在于
 * 「看得见的东西能解释看到的名次」。
 *
 * **相关度那个百分比不上屏**，尽管它也参与打分（AGENTS.md「分数和名次不重复
 * 上屏，名单位置表达顺序」）。它是行里唯一一个没有单位的数，读者只会把它读成
 * 「这个人 73% 符合要求」；而真按它的本义读，73% 和 61% 之间也没有任何一个
 * 看得懂的人做得出的决定——低到不该出现的那些早在收人时就被挡掉了
 * （`search/phrases.ts` 的 `RELEVANCE_MIN`），屏幕上的每一行都已经够格。
 * 这一行要答的是「凭什么算命中」，那由点的档位和拿去比的那个词答完。
 *
 * 只画命中。没命中的主张由 `MissedClaims` 收成一行。
 */
export function EvidenceLine({
	name,
	boost,
	hit,
	basis,
}: {
	/** 这一行属于哪条主张（代表词，或没有经历词时的整条） */
	name: string;
	/** 加分的主张。必须是默认，默认不该有标记。 */
	boost: boolean;
	/** 展示用的样例段：点的强度、命中字段、这段经历的身份都来自它 */
	hit: Hit;
	/**
	 * 打分用的聚合值：相关度、全部证据段的累计月数、是否仍在进行。
	 *
	 * 它不可空。一条主张有没有 `basis` 和它有没有样例段是同一件事（两者出自
	 * 同一次筛选），所以「有 hit 没有 basis」的那一行不存在——调用点只在两样
	 * 都在时才画这一行。给它配一份退回样例段的算法，等于替一个到不了的分支
	 * 造一套第二口径的数，而那套数一旦真被用上就和名次对不上了。
	 */
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
				{/* 命中的不是代表词时说出是哪个词：一个意外的人得能找到是哪个词招来的 */}
				{byOther(name, hit) && (
					<span className="shrink-0 text-muted-foreground text-xs">
						{MATCHED_BY} {hit.value}
					</span>
				)}
				{/*
				 * 来源标签在字段值前面，不在后面：读到那串岗位名之前就得先知道
				 * 「这是岗位还是部门」，否则「区域安全」四个字读完了还要回头找
				 * 它是从哪儿来的。12px 次要色，它是标签不是内容。
				 */}
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
						{/*
						 * 上下文靠**留白加变色**接上去，不用 ` · `。
						 *
						 * 分隔点在这里是二义的：序列自己就是用 ` · ` 连三级的
						 * （lib/format 的 `dots`），再拿同一个符号接部门，屏幕上
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

/**
 * 没命中的那些主张，收成一行。
 *
 * 「未命中」逐条各占一行的话，五条主张的查询里每一块有三四行读不出东西的灰字，
 * 高度翻倍而信息量为零。但它不能不说：一条主张在这个人身上没有证据，是关于
 * 这个人的一个事实，留白只会让人以为这一行还没加载完。
 *
 * 槽位和命中行对齐（点、标签列、内容列），所以它读起来仍然是这份证据的一行，
 * 不是一句附注。
 */
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
