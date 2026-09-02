/**
 * 自然语言查询 → 概念词。解析是本地、确定性的，不调用外部模型。
 *
 * "做过线下渠道运营、带过团队的人" → ["线下渠道运营", "带过团队"]
 *
 * 每个概念词还带一个**要求强度**（见下面的 parseChips）：默认「必须」，
 * 也可以是「加分」或「排除」。检索的语义由它决定，不由这里的切词决定。
 */

/** 分隔符：标点与连接词都视为概念之间的边界 */
const SPLIT = /[,，、;；/|\s]+|(?:和|与|并且|同时|以及|的)/g;

/** 整块都是这些词时丢弃：它们表达句式，不表达检索意图 */
const STOPWORDS = new Set([
	"做过",
	"干过",
	"待过",
	"有",
	"过",
	"的",
	"人",
	"员工",
	"同学",
	"背景",
	"经验",
	"经历",
	"找",
	"查",
	"搜",
	"找人",
	"帮我",
	"我要",
	"想找",
	"需要",
	"希望",
	"最好",
	"都",
	"既",
	"又",
	"而且",
	"以上",
	"相关",
	"方面",
	"工作",
	"曾经",
	"现在",
	"目前",
	"谁",
]);

/**
 * 贴在概念词前后的句式碎片。切分只认标点，"后端都做过"这类会连在一起，
 * 得把两头的赘字剥掉才剩下真正要搜的词。
 */
const HEAD =
	/^(?:帮我|我要|想找|需要|找一?些?|查一?下?|搜一?下?|有没有|谁|做过|干过|带过|待过|现在|目前|曾经|做|干|有)+/;
const TAIL = new RegExp(
	// 要么是"（都/也）做过"这类动词短语，要么是"的人 / 经验 / 背景"这类名词赘尾。
	// 单字不能单独剥：末尾的"全"多半是"安全"的一半，末尾的"人"多半是
	// "机器人 / 负责人 / 经纪人"的一半。所以"人"只在跟着"的"时才算赘尾。
	"(?:(?:都|也|全)?(?:做过|干过|待过|带过|有过)" +
		"|(?:的人|的|员工|同学|经验|经历|背景|工作|岗位|方向|相关))+$",
);

/** 概念词的长度上限。超过这个长度的不是概念，是一段被误当成词的正文。 */
export const QUERY_TEXT_MAX = 200;
export const CHIP_MAX = 8;
const MAX_TERM_LEN = 24;

/** URL 与服务端端点共用同一条文本边界。 */
export function queryText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().slice(0, QUERY_TEXT_MAX);
	return normalized || undefined;
}

/**
 * 剥赘字不能把词本身剥没。
 *
 * 剥完不足 2 字，且剥掉的只有**一个字**时，判定为剥错了词内字：那一个字
 * 多半是"有赞"的"有"、"做市商"的"做"，不是句式。这时原样保留，因为交出
 * 一个碎片会静默改变 AND 语义（少一个约束，结果集变大），而界面上看不出
 * 哪个概念被吃了。
 *
 * 剥掉的是多字句式（"帮我找|人"）则照剥不误——剩下的"人"会被停用词滤掉，
 * 这正是要的结果。
 */
function keepIfMeaningful(stripped: string, original: string) {
	if (stripped.length >= 2) return stripped;
	return original.length - stripped.length <= 1 ? original : stripped;
}

export function parseQuery(raw: string): string[] {
	const terms: string[] = [];
	for (const chunk of raw.slice(0, QUERY_TEXT_MAX).split(SPLIT)) {
		const whole = chunk.trim();
		let term = keepIfMeaningful(whole.replace(HEAD, ""), whole);
		// 剥两头可能反复出现（"后端都做过的人"），剥到不再变短为止
		for (let prev = ""; term !== prev; ) {
			prev = term;
			term = keepIfMeaningful(term.replace(TAIL, "").trim(), term);
		}
		if (!term || STOPWORDS.has(term) || term.length < 2) continue;
		if (term.length > MAX_TERM_LEN) continue;
		if (!terms.includes(term)) terms.push(term);
	}
	return terms;
}

/**
 * 一条要求的强度。
 *
 * - `must`：这个人必须有一段经历满足它。多条 must 之间是 AND。
 * - `boost`：满足了加分，不满足也留在结果里。它是「这个人还得会点 X」和
 *   「会 X 更好」之间的差别，而招聘里这两句话不是一句话。
 * - `exclude`：命中它的**经历段**丧失为任何要求作证的资格。否决的是证据，
 *   不是人——实习起步、后来真干了八年算法的人留下，因为他有别的硬证据；
 *   只有那段实习的人自然出不来，因为他没有证据了。检索对象是经历，
 *   排除也一样（见 AGENTS.md「从经历找人」）。
 */
export type ChipMode = "must" | "boost" | "exclude";

/** 一条要求最多几个说法（主词 + alts 合计）。再多就不是一条要求了。 */
export const MEMBER_MAX = 4;

/**
 * 一枚查询 chip：**一条要求**，界面上可点、可改、可删的最小单位。
 *
 * 一条要求可以有多个**说法**，满足其一即满足这条要求（说法之间 OR，
 * 要求之间 AND）。`term` 是主词、`alts` 是「A 或 B 均可」里并列的那些，
 * 全都是用户自己说的、同权重。**说法就是嵌入的文本**：屏幕上写的那几个字
 * 和拿去比相似度的那几个字是同一串，没有第二份看不见的检索词——
 * 相近的说法不必再由谁替库补，向量空间里「算法」离「深度学习工程师」本来就近。
 *
 * `off` 是**停用**，和三档强度正交：这条要求还在查询里、还画在屏幕上，但这一次
 * 检索完全当它不存在。招聘检索是反复试的——加一条发现只剩三个人，想知道
 * 是不是它太窄。删掉再手打回来会丢掉它的强度，也丢掉「我试过这个」这件事；
 * 靠浏览器后退能退，但没人会想到那是个办法。所以停用是一等状态，不是删除的替代。
 *
 * `wide` 是停用的**成因注记**：这个词在语料里命中的人太多（超过
 * `WIDE_SHARE`），几乎不筛人，理解落库时被自动停用（`server/turn.ts` 的
 * benchWide）。它只与 `off` 同现——用户重新启用即是「我知道它宽，照跑」，
 * 两个标记一起摘掉，此后不再自动碰它。单独一个布尔而不是给 off 发枚举值，
 * 是因为「谁停的」不改变停用的语义，只改变 chip 上那句解释。
 */
export type Chip = {
	term: string;
	alts?: string[];
	mode: ChipMode;
	off?: true;
	wide?: true;
};

/**
 * 强度在查询串里的写法。放在词前面一个字符，因为 URL 要能读、能手改、能粘给同事。
 * 不用 `!`：`+` 和 `-` 是搜索框里几十年的老约定，不需要教。
 */
const MODE_PREFIX: Record<string, ChipMode> = { "+": "boost", "-": "exclude" };

const MODE_SIGN: Record<ChipMode, string> = {
	must: "",
	boost: "+",
	exclude: "-",
};

/**
 * 停用的写法：`~` 叠在强度符号**前面**（`~+带团队` 是停用了的加分词）。
 *
 * 叠加而不是再发明一个强度值，为的是停用不吃掉强度：`~+带团队` 重新启用之后
 * 还是加分词。做成第四档强度的话，停一次再开就变回「必须」了，而这个改动
 * 在界面上安静得没有任何提示。
 */
const OFF_SIGN = "~";

/**
 * 太宽停用的写法：`*` 替掉 `~` 站在最前面（`*+运营` 是因太宽被自动停用的
 * 加分词）。是**替掉**不是叠加：wide 蕴含 off，`~*` 就成了同一枚 chip 的
 * 第二种写法，往返不再是恒等式。选 `*` 是因为它在检索语境里的老义项就是
 * 「什么都匹配」——这枚 chip 正是匹配得太多才被停下的。
 */
const WIDE_SIGN = "*";

/**
 * 同一条要求里说法之间的边界：`/` 是我们自己写回去的形态，「或（者）」是
 * 用户嘴里的形态。两者都只在 parseChips 这一层生效——parseQuery 看到的
 * 永远是单个说法。
 */
const MEMBER_SPLIT = /\/|或者|或/;

/**
 * 查询串 → chips。这是「查询」这个概念在全站的唯一解析入口。
 *
 * 半角逗号是**要求**之间的边界（AND），组内的 `/` 与「或」是**说法**之间的
 * 边界（OR）；其余分隔符（顿号、全角逗号、空格……）仍然交给 parseQuery 切词。
 * 所以一句原话进来得到几条 must 要求，「大模型或推荐系统」得到**一条**带两个
 * 说法的要求，而我们自己写回的 `大模型/推荐系统,+带团队,-实习` 各归各——
 * 同一个函数吃两种输入，不必在别处判断「这是原话还是 chip 串」。
 *
 * 没有说法记号的组里，每个词各自成一条要求。这条分叉保证「渠道运营、带团队」
 * 仍然是两条 AND 要求，而不是被并成一条 OR。
 *
 * 去重跨强度、跨说法生效，先出现的那一个赢：同一个词既必须又排除是自相矛盾的
 * 输入，与其猜用户想要哪个，不如让它保持第一次写下的样子，界面上看得见、改得动。
 */
export function parseChips(raw: string): Chip[] {
	const chips: Chip[] = [];
	const seen = new Set<string>();
	for (const group of raw.split(",")) {
		let g = group.trim();
		if (!g) continue;
		// 先剥停用（`~` 或 `*`，互斥），再剥强度：记号顺序是定死的（`~+X`），
		// 反过来不认，否则同一枚 chip 会有两种写法，往返就不再是恒等式。
		const wide = g[0] === WIDE_SIGN;
		const off = wide || g[0] === OFF_SIGN;
		if (off) g = g.slice(1).trim();
		const mode = MODE_PREFIX[g[0] ?? ""] ?? "must";
		if (mode !== "must") g = g.slice(1);

		const chunks = g.split(MEMBER_SPLIT);
		if (chunks.length === 1) {
			for (const term of parseQuery(g)) {
				if (seen.has(term)) continue;
				seen.add(term);
				chips.push({
					term,
					mode,
					...(off && { off: true as const }),
					...(wide && { wide: true as const }),
				});
				if (chips.length === CHIP_MAX) return chips;
			}
			continue;
		}

		const members: string[] = [];
		for (const chunk of chunks) {
			for (const t of parseQuery(chunk)) {
				if (seen.has(t)) continue;
				seen.add(t);
				members.push(t);
			}
		}
		const [term, ...alts] = members;
		if (!term) continue;
		const keptAlts = alts.slice(0, MEMBER_MAX - 1);
		chips.push({
			term,
			...(keptAlts.length > 0 && { alts: keptAlts }),
			mode,
			...(off && { off: true as const }),
			...(wide && { wide: true as const }),
		});
		if (chips.length === CHIP_MAX) return chips;
	}
	return chips;
}

/** 把停用的那些摘掉。检索、证据行、分面都只看这一份。 */
export function activeChips(chips: Chip[]): Chip[] {
	return chips.filter((c) => !c.off);
}

/**
 * chips → 规范查询串。服务端入参收窄、查询合并和命令行都通过这套表示交换
 * 条件，所以 `parseChips(toQuery(c))` 必须等于 `c`。说法用 `/` 连（`大模型/推荐系统`）。
 */
export function toQuery(chips: Chip[]): string {
	return chips
		.map(
			(c) =>
				(c.wide ? WIDE_SIGN : c.off ? OFF_SIGN : "") +
				MODE_SIGN[c.mode] +
				[c.term, ...(c.alts ?? [])].join("/"),
		)
		.join(",");
}
