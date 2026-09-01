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
	org: "部门或公司名称中包含相关词",
	claimed: "来自入职前简历原文",
};

/**
 * 证据强度点：这套界面的设计签名。
 *
 * 三档强度用**填充方式**而不是三种颜色来区分：实心 / 实心灰 / 空心构成一个
 * 不依赖色觉的三级序列，打印成黑白或者色弱用户看，顺序依然成立。色相只是
 * 最硬那一档的额外加成，不是它唯一的身份。
 *
 * 最硬那一档用 `success`（emerald），不用 `warning`（amber）。全站的色相各有
 * 一个主人，这条不能破：amber 已经归「整词退到子串」和「未能识别语气」那两条
 * 提示所有，蓝（`info`）归选中态。拿 amber 画受控命中，会让「这是最可信的证据」
 * 和「这里有个问题」共用一个颜色，而它们在同一屏上并排出现。
 * 绿还有一层白拿的好处：同类产品里逐条件打勾一律是绿的，不需要教。
 *
 * 8px 是这个编码可判读的下限：再小，「空心」和「实心灰」在正常观看距离上
 * 就分不开了。所以尺寸不开放成参数——一旦允许 6px，编码就失效了。
 */
const DOT_FILL: Record<Strength, string> = {
	controlled: "bg-success",
	org: "bg-muted-foreground/60",
	claimed: "bg-transparent ring-1 ring-muted-foreground/50 ring-inset",
};

/**
 * 同一套三档，画成**色块**时的样子（职业轨迹条用，见 career-bar.tsx）。
 *
 * 和 DOT_FILL 只差一处：「仅简历自述」那一档在点上是空心，在色块上得有底。
 * 一个 6px 宽、20px 高的空心块在浅灰带子上几乎看不出来，而它必须和「这一段
 * 没命中」区分得开——所以填一层 muted、再留描边，读起来仍然是三档里最轻的那一档。
 *
 * 两份写在一起，是因为它们必须一起改：分开放会让某一天有人只改了点、
 * 没改色块，于是同一个强度在两个视图里长得不一样，而那正是编码失效的方式。
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
 * 图例。一行，排在名单的正上方。
 *
 * 它必须和它解释的东西同时在屏幕上，所以就排在那些点的上方一行。放进任何一个
 * 「空着才显示」的位置都是错的——那类位置空着的时候，正意味着屏幕上一颗点
 * 都没有，而一旦有点可对照，图例又被真正的内容顶掉了。
 *
 * 代价是常占一行，所以压成一行：三个词、三颗点，不写副标题。每一档的详细
 * 说明挂在 `title` 上，想知道的人停一下就有，不想知道的人不必读。
 */
export function StrengthLegend() {
	return (
		<dl className="flex flex-wrap items-center gap-x-4 gap-y-1">
			<dt className="label text-muted-foreground">匹配来源</dt>
			{(["controlled", "org", "claimed"] as const).map((s) => (
				<dd
					className="flex items-center gap-1.5 text-muted-foreground text-xs"
					key={s}
					title={STRENGTH_HINT[s]}
				>
					<Dot strength={s} />
					{STRENGTH_LABEL[s]}
				</dd>
			))}
		</dl>
	);
}

/**
 * 命中的那一段经历里，**实际匹配上的是哪个字段**。
 *
 * 「凭什么算命中」在行内当场答完，不必点进详情面板。这一条成立的前提是
 * 一个人占一整块、一个条件占一整行——宽度不再是约束了。挤在一个 6rem 的
 * 格子里时只能画一颗点，因为几十行乘几列的重复灰字比不写更糟。
 *
 * 取的是命中那一路自己的字段值，不是固定取岗位：`seq` 命中就给序列，`org`
 * 命中就给组织。给错字段比不给更坏——屏幕上会出现一个不含查询词的岗位名，
 * 读起来像是系统匹配错了。
 *
 * `description` 这一路只有 `label`，没有 `value`：命中事实里不带原文片段
 * （见 `search/result.ts` 的 `Hit`），所以这里不假装引用一句话。它是三档里
 * 最弱的一档，空心点、灰字、外加一句「简历原文」已经把「这条要自己去核对」
 * 说清楚了，而可核对的完整原文在详情栏的时间线上。
 */
function matchedField(hit: Hit): {
	label: string;
	/** 命中词就在这个字符串里，所以它值得被标出来。没有可标的就是 null。 */
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
 * 一个人一个条件的一行证据。
 *
 * 排布是四段固定的槽，所有人的所有行共用同一套列位置——这是把表格旋转成
 * 块之后仍然能上下扫的原因：「这五十个人里谁的『项目管理』是受控命中」照样
 * 是眼睛沿一条竖线往下走，只不过那条线上现在还写着凭据。
 *
 *   [点] [条件词]  [命中的字段值 · 这段经历在哪]              [时长]
 *
 * 时长取 `basis.months`，也就是**最强那一路上的累计月数**，正是参与打分的
 * 那个值；取单段月数会让两个排名不同的人显示同一个数，而这个界面的全部
 * 说服力就在于「看得见的东西能解释看到的名次」。
 *
 * 还在做的把数字提到正文色，做完了的留在次要色。不另起一个记号也不占宽度：
 * 扫下来时深的那些自己会浮出来。
 */
export function EvidenceLine({
	term,
	boost,
	hit,
	basis,
}: {
	/** 展示用的词（可能是整词退化之后的子串，见 search.ts 的 relaxTerm） */
	term: string;
	/** 加分词。必须词是默认，默认不该有标记。 */
	boost: boolean;
	/** 展示用的样例段：点的强度、命中字段、这段经历的身份都来自它 */
	hit: Hit | undefined;
	/** 打分用的聚合值。缺席时退回样例段，这一行不会因此空掉。 */
	basis: TermBasis | null | undefined;
}) {
	const name = (
		<span className="flex min-w-0 items-center gap-1.5">
			{boost && <span className="font-mono text-muted-foreground">+</span>}
			<span className="truncate">{term}</span>
		</span>
	);

	if (!hit) {
		return (
			<div className="flex items-baseline gap-2.5 text-muted-foreground text-sm">
				<Dot className="translate-y-1" strength={undefined} />
				<span className="w-[5.5rem] shrink-0">{name}</span>
				{/* 「未命中」写出来，不留一片空白。加分词没命中是这个人的一个事实，
				    空白只会让人以为这一行还没加载完。 */}
				<span className="min-w-0 flex-1 truncate">未命中</span>
			</div>
		);
	}

	const field = matchedField(hit);
	const months = basis?.months ?? hit.months;
	const external = basis ? basis.external : hit.kind === "external";
	const ongoing = (basis ? basis.endDate : hit.endDate) === null;

	return (
		<div className="flex items-baseline gap-2.5 text-sm">
			<Dot className="translate-y-1" strength={strengthOf(hit.route)} />
			<span className="w-[5.5rem] shrink-0">{name}</span>
			<span className="flex min-w-0 flex-1 items-baseline gap-1.5">
				{/*
				 * 来源标签在字段值前面，不在后面：读到那串岗位名之前就得先知道
				 * 「这是岗位还是序列」，否则「区域安全」四个字读完了还要回头找
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
						{/* 命中词就在这个串里，标出来——这一行的存在意义就是让人
						    一眼看到「算法工程师」里的「算法」。 */}
						<Highlight term={term} text={field.value} />
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
						<span className="ml-2 text-muted-foreground">{field.context}</span>
					</span>
				)}
			</span>
			<span
				className={cn(
					"shrink-0 whitespace-nowrap tabular-nums",
					ongoing ? "text-foreground" : "text-muted-foreground",
				)}
				title={`累计 ${years(months)}${ongoing ? "，至今" : ""}`}
			>
				{external && <span className="text-muted-foreground">前 </span>}
				{years(months)}
			</span>
		</div>
	);
}

/**
 * 在原文里标出命中的词。简历原文这一路最不可信，必须把原文摆出来让人自己判断
 * 「配合算法团队」这种主语是别人的句子算不算数——所以**每一处**都要标出来：
 * 只标第一处会让人以为只提过一次，而「提过几次」正是判断的依据之一。
 *
 * 标记不带颜色。amber 在这套界面里已经有主（整词退到子串、未识别语气两条提示），
 * 拿它标命中等于把「命中」说成「警告」。档案上的记号本来就是铅笔道，不是
 * 荧光笔：底色加一档、字色提到正文色，在一段次要色的正文里已经足够跳出来，
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
				className="rounded-sm bg-muted px-0.5 font-medium text-foreground"
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
