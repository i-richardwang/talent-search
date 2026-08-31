import { cn, Text } from "@cloudflare/kumo";
import { duration, years } from "#/lib/format";
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
	org: "部门或公司名称中包含相关词",
	claimed: "来自入职前简历原文",
};

/**
 * 证据强度点：这套界面的设计签名。
 *
 * 三档强度用**填充方式**而不是三种颜色来区分：实心橙 / 实心灰 / 空心
 * 构成一个不依赖色觉的三级序列，打印成黑白或者色弱用户看，顺序依然成立。
 *
 * 橙色的类名是 `bg-kumo-badge-orange`，不是 `bg-kumo-brand`。Kumo 的
 * `--color-kumo-brand` 是蓝色 oklch(0.577 0.232 260)，橙色只活在
 * `--text-color-kumo-brand`（只能上文字）和这个 badge 令牌上。写成 brand
 * 点就是蓝的，和选中态同族——「这一行被选中了」与「这个词是受控字段命中」
 * 会变成同一个信号，而同义的 `Badge variant="orange"` 又确实是橙的。
 *
 * 8px 是这个编码可判读的下限：再小，「空心」和「实心灰」在正常观看距离上
 * 就分不开了。所以尺寸不开放成参数——一旦允许 6px，编码就失效了。
 */
const DOT_FILL: Record<Strength, string> = {
	controlled: "bg-kumo-badge-orange",
	org: "bg-kumo-line",
	claimed: "bg-transparent ring-1 ring-kumo-line ring-inset",
};

/**
 * 同一套三档，画成**色块**时的样子（职业轨迹条用，见 career-bar.tsx）。
 *
 * 和 DOT_FILL 只差一处：「仅简历自述」那一档在点上是空心，在色块上得有底。
 * 一个 6px 宽、20px 高的空心块在浅灰带子上几乎看不出来，而它必须和「这一段
 * 没命中」区分得开——所以填 fill、再留描边，读起来仍然是三档里最轻的那一档。
 *
 * 两份写在一起，是因为它们必须一起改：分开放会让某一天有人只改了点、
 * 没改色块，于是同一个强度在两个视图里长得不一样，而那正是编码失效的方式。
 */
export const BAND_FILL: Record<Strength, string> = {
	controlled: "bg-kumo-badge-orange",
	org: "bg-kumo-line",
	claimed: "bg-kumo-fill ring-1 ring-kumo-line ring-inset",
};

export function Dot({
	strength,
	className,
}: {
	/** 没有证据时留空：画一个比空心还淡的占位，保持列的节奏不断 */
	strength: Strength | undefined;
	className?: string;
}) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 shrink-0 rounded-full",
				strength ? DOT_FILL[strength] : "bg-kumo-hairline",
				className,
			)}
		/>
	);
}

/**
 * 图例。常驻在详情栏的空态里，不收进一个问号按钮。
 *
 * 点阵是这套界面唯一需要学习的编码，而没选人的时候详情栏本来就空着。
 * 把要学的东西放在空位上，比让人先发现一个问号再点开它，代价低得多。
 */
export function StrengthLegend() {
	return (
		<dl className="space-y-3">
			{(["controlled", "org", "claimed"] as const).map((s) => (
				<div className="flex items-baseline gap-2.5" key={s}>
					<Dot className="translate-y-1" strength={s} />
					<div className="min-w-0">
						<Text as="dt" size="sm">
							{STRENGTH_LABEL[s]}
						</Text>
						<Text as="dd" size="xs" variant="secondary">
							{STRENGTH_HINT[s]}
						</Text>
					</div>
				</div>
			))}
		</dl>
	);
}

/**
 * 表格里一个「概念词 × 人」的格子。横向对比时人眼扫的是这一列：
 * 同样都命中了「渠道运营」，有人是序列认定，有人只是简历里提了一句。
 *
 * **这一格画的是排序依据本身**，不是随便挑的一段经历。词分 = 强度 × 时长 ×
 * 近因（rank.ts 的 `termValue`），三个因子在这里各有一处形态：
 *
 * - 强度 → 点的填充；
 * - 时长 → 右对齐的年，取 `basis.months`，也就是**最强那一路上的累计月数**，
 *   正是参与打分的那个值。取单段月数会让两个排名不同的人显示同一个数，
 *   而这个界面的全部说服力就在于「看得见的东西能解释看到的名次」；
 * - 近因 → 还在做的把数字提到 default 色，做完了的留在 subtle。不另起一个
 *   记号也不占宽度：五十行扫下来，深的那些自己会浮出来。
 *
 * 刻意不写命中来自哪一路——点的填充就是从 route 推导的，再写一遍「序列」两个
 * 字，五十行乘以几列之后那片重复的灰字就是表格脏的主因。具体是序列还是岗位、
 * 哪个部门哪个岗位，交给 tooltip 和详情栏。
 *
 * 时长折成一位小数的年（years 而不是 duration）：「2 年 3 个月」在这个列宽里
 * 只剩不到一个字的余量，加上「前 」就得靠省略号收场。折成数之后宽度恒定，
 * 右对齐加 tabular-nums 就成了一列能上下比大小的数。
 */
export function EvidenceCell({
	hit,
	basis,
}: {
	/** 展示用的样例段：点的强度、tooltip 里的部门与岗位都来自它 */
	hit: Hit | undefined;
	/** 打分用的聚合值。缺席时退回样例段，格子不会因此空掉。 */
	basis: TermBasis | null | undefined;
}) {
	if (!hit) {
		return (
			<span className="flex items-center gap-2">
				<Dot strength={undefined} />
				<span className="ml-auto text-kumo-subtle">—</span>
			</span>
		);
	}
	const months = basis?.months ?? hit.months;
	const external = basis ? basis.external : hit.kind === "external";
	const ongoing = (basis ? basis.endDate : hit.endDate) === null;
	// 点是 aria-hidden 的，所以整个格子挂一个 role=img 把几件事一次说清；
	// 刻意用原生 title 而不是 Tooltip：一屏能有上百个这样的格子，
	// 每个都挂一个 Tooltip 会让行 hover 变迟钝。
	const said = `${external ? "入职前 " : ""}${ROUTE_LABEL[hit.route]}匹配，累计 ${duration(months)}${ongoing ? "，至今" : ""}`;
	return (
		<span
			aria-label={said}
			className="flex items-center gap-2"
			role="img"
			title={`${said} · ${hit.org} · ${hit.title}`}
		>
			<Dot strength={strengthOf(hit.route)} />
			<span
				className={cn(
					"ml-auto whitespace-nowrap tabular-nums",
					ongoing ? "text-kumo-default" : "text-kumo-subtle",
				)}
			>
				{external && "前 "}
				{years(months)}
			</span>
		</span>
	);
}

/**
 * 在原文里标出命中的词。简历原文这一路最不可信，必须把原文摆出来让人自己判断
 * 「配合算法团队」这种主语是别人的句子算不算数——所以**每一处**都要标出来：
 * 只标第一处会让人以为只提过一次，而"提过几次"正是判断的依据之一。
 *
 * 标记不带颜色。warning 那个色在这套界面里已经有主（整词退到子串的提示），
 * 拿它标命中等于把「命中」说成「警告」。档案上的记号本来就是铅笔道，不是
 * 荧光笔：底色加一档、字色提到 default，在一段 subtle 的正文里已经足够跳出来，
 * 还不用再引进一个色相。
 */
export function Highlight({ text, term }: { text: string; term: string }) {
	if (!term || !text) return <>{text}</>;

	const haystack = text.toLowerCase();
	const needle = term.toLowerCase();
	const parts: React.ReactNode[] = [];
	let cursor = 0;

	for (;;) {
		const i = haystack.indexOf(needle, cursor);
		if (i < 0) break;
		if (i > cursor) parts.push(text.slice(cursor, i));
		parts.push(
			<mark
				className="rounded-control bg-kumo-fill px-0.5 font-medium text-kumo-default"
				key={i}
			>
				{text.slice(i, i + term.length)}
			</mark>,
		);
		cursor = i + term.length;
	}

	if (parts.length === 0) return <>{text}</>;
	if (cursor < text.length) parts.push(text.slice(cursor));
	return <>{parts}</>;
}
