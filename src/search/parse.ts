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
 * 一个概念词的要求强度。
 *
 * - `must`：这个人必须有一段经历命中它。多个 must 之间是 AND。
 * - `boost`：命中了加分，不命中也留在结果里。它是「这个人还得会点 X」和
 *   「会 X 更好」之间的差别，而招聘里这两句话不是一句话。
 * - `exclude`：命中它的人整个不要。
 */
export type ChipMode = "must" | "boost" | "exclude";

/**
 * 一枚查询 chip：界面上可点、可改、可删的最小单位。
 *
 * `off` 是**停用**，和三档强度正交：这个词还在查询里、还画在屏幕上，但这一次
 * 检索完全当它不存在。招聘检索是反复试的——加一个词发现只剩三个人，想知道
 * 是不是它太窄。删掉再手打回来会丢掉它的强度，也丢掉「我试过这个」这件事；
 * 靠浏览器后退能退，但没人会想到那是个办法。所以停用是一等状态，不是删除的替代。
 */
export type Chip = { term: string; mode: ChipMode; off?: true };

/**
 * 一次查询变更的**来源**。改查询只有一件事——产出 chips 写进 URL；
 * 变的只是这些 chips 从哪来，而这两处来源的代价差着四个数量级。
 *
 * - `sentence`：一句大白话，要先过查询理解（服务端那一跳，模型不可用时
 *   自己退回规则解析）。
 * - `chips`：已经是条件了。零态那排序列按钮点下去就是一枚 chip，
 *   它是查询理解的**产物**，再送回去让模型猜一遍只会变坏。
 *
 * 做成判别联合而不是两个回调，是因为两者的签名都是「给我一个 string」——
 * 接错哪一个，类型、渲染、构建全绿，只有行为静默改变：整句走了 chips 那条，
 * 语气（「最好」「不要」）会被一律判成「必须」，而结果看上去完全正常。
 * 有了这个标签，接错就是一个编译错误。
 */
export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "chips"; chips: Chip[] };

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
 * 查询串 → chips。这是「查询」这个概念在全站的唯一解析入口。
 *
 * 半角逗号是**强度分组**的边界，其余分隔符（顿号、全角逗号、空格……）仍然
 * 交给 parseQuery 切词。所以一句原话进来只会得到一组 must，而我们自己写回
 * URL 的 `渠道运营,+带团队,-实习` 三组各有各的强度——同一个函数吃两种输入，
 * 不必在别处判断「这是原话还是 chip 串」。
 *
 * 去重跨强度生效，先出现的那一枚赢：同一个词既必须又排除是自相矛盾的输入，
 * 与其猜用户想要哪个，不如让它保持第一次写下的样子，界面上看得见、改得动。
 */
export function parseChips(raw: string): Chip[] {
	const chips: Chip[] = [];
	const seen = new Set<string>();
	for (const group of raw.split(",")) {
		let g = group.trim();
		if (!g) continue;
		// 先剥停用，再剥强度：两个记号的顺序是定死的（`~+X`），反过来不认，
		// 否则同一枚 chip 会有两种写法，往返就不再是恒等式。
		const off = g[0] === OFF_SIGN;
		if (off) g = g.slice(1).trim();
		const mode = MODE_PREFIX[g[0] ?? ""] ?? "must";
		for (const term of parseQuery(mode === "must" ? g : g.slice(1))) {
			if (seen.has(term)) continue;
			seen.add(term);
			chips.push({ term, mode, ...(off && { off: true as const }) });
			if (chips.length === CHIP_MAX) return chips;
		}
	}
	return chips;
}

/** 把停用的那些摘掉。检索、表格列、分面都只看这一份。 */
export function activeChips(chips: Chip[]): Chip[] {
	return chips.filter((c) => !c.off);
}

/**
 * chips → 查询串。URL 由它写，所以 `parseChips(toQuery(c))` 必须等于 `c`——
 * 往返不成立的话，改一枚 chip 会把别的 chip 也改掉，而这在界面上无从察觉。
 * tests/parse.test.ts 钉住这条。
 */
export function toQuery(chips: Chip[]): string {
	return chips
		.map((c) => (c.off ? OFF_SIGN : "") + MODE_SIGN[c.mode] + c.term)
		.join(",");
}
