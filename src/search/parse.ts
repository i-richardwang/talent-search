/**
 * 查询串的语法与解析。解析是本地、确定性的，不含任何自然语言理解——
 * 自然语言由模型翻译（`intent.ts`），这里只认下面这套记号：
 *
 *     大模型/推荐系统,+带团队,~-实习
 *
 * 半角逗号隔开**要求**（AND），`/` 隔开一条要求里的**说法**（OR），词前的
 * `+` `-` 是强度、`~` 是停用。除此之外没有别的语法：一个说法就是记号后面
 * 那几个字本身，不切词、不剥句式、不去停用词。
 */

/**
 * 不可信文本的长度上限。超过这个长度的不是一个词、一个公司名或一句提示，
 * 是一段被误当成它们的正文。
 */
export const TEXT_MAX = 200;
export const CHIP_MAX = 8;

/**
 * 一个说法最长几个字。上限住在这里，`intentSchema` 只在 `describe` 里写建议：
 * 写成 schema 约束的话，模型多给一个长词就是整条响应作废，而收窄本来只会
 * 丢掉那一个词。
 */
export const MAX_TERM_LEN = 24;

/** 一个说法最短几个字。单字对语义匹配说不出任何东西。 */
const MIN_TERM_LEN = 2;

/**
 * 词首的记号位：`~`（停用）与 `+` `-`（强度）在查询串里是**语法**，
 * 所以一个说法永远不以它们开头，剥在这里——`termOf` 是全站唯一产出说法的地方，
 * 模型给的词和查询串里读出来的词都从这一个口子出来。
 *
 * 不剥的话模型给出 `+带团队` 这样的词会原样变成一个说法，写回查询串就成了
 * `大模型/+带团队`，再解析一次那个 `+` 变回强度符号，说法凭空少一个——
 * 而往返恒等式（`parseChips(toQuery(parseChips(q)))`）是这条串能当查询用的前提。
 */
const LEADING_SIGN = /^[~+-]+/;

/**
 * 不可信入参 → 一段收进边界的短文本。查询里的词、范围里的公司名与学校名、
 * URL 上的筛选值走的是同一条边界：它们的不可信程度是一样的。
 */
export function boundedText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().slice(0, TEXT_MAX);
	return normalized || undefined;
}

/**
 * 不可信的一段字 → 一个说法，或者什么都不是。
 *
 * 这是全站唯一产出说法的地方：模型输出的每个词、查询串里的每一段都经过它。
 * 它只做边界工作——剥记号、限长度——不改写字面：屏幕上写的那几个字和拿去
 * 比相似度的那几个字是同一串，改写发生在哪里都是一次看不见的查询变更。
 */
export function termOf(value: unknown): string | undefined {
	const text = boundedText(value)?.replace(LEADING_SIGN, "").trim();
	if (!text || text.length < MIN_TERM_LEN || text.length > MAX_TERM_LEN)
		return undefined;
	return text;
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
export const CHIP_MODES = ["must", "boost", "exclude"] as const;
export type ChipMode = (typeof CHIP_MODES)[number];

/** 一条要求最多几个说法（主词 + alts 合计）。再多就不是一条要求了。 */
export const MEMBER_MAX = 4;

/**
 * 一枚查询 chip：**一条要求**，界面上可点、可改、可删的最小单位。
 *
 * 它是**只读的**，而且只可能由 `parseChips` 造出来——查询的唯一表示是那串
 * 规范查询串（`SearchSpec.evidence`），chip 只是它解析出来的视图。改一条已有
 * 查询一律走下面那三个编辑函数（串进串出），不许在别处拼一个 chip 对象再存
 * 回去：那样每加一个字段，都会有某个拼装点忘记带上它，而屏幕上只表现为
 * 「我的说法怎么少了一个」——没有任何检查会红。（`toQuery` 是另一件事：
 * 它给的是「外部意图第一次变成查询」那一道门，见下面。）
 *
 * **词里不含语法。** 一个说法永远不以 `~` `+` `-` 开头：这三个记号在查询串里
 * 是停用与强度，落进词里就会在下一次解析时变回记号。剥记号只发生在
 * `termOf`（见上面的 `LEADING_SIGN`），所以这条对模型给的词和查询串里读出来
 * 的词一样成立，往返恒等式也因此对**任何**输入串都成立。
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
 * **为什么停用只有一个布尔、没有成因**：一个词太宽而被自动停用，那是关于
 * **语料**的一条事实（`WIDE_SHARE`，见 `search.ts` 的 probeWide），不是这条
 * 要求的性质。它属于这次理解的注解（`SearchNotice` 的 `wide`），和「没处放的
 * 条件」同一档。写在 chip 上的话，一条会随语料重灌后失效的
 * 判断就被冻进了不可变的条件里，而这个产品对 `/s/:id` 的承诺只到条件为止。
 */
export type Chip = Readonly<{
	term: string;
	alts?: readonly string[];
	mode: ChipMode;
	off?: true;
}>;

/**
 * 一条**还没进过解析**的要求：模型输出第一次变成查询时的
 * 中间形态。它和 `Chip` 形状相同而含义不同——chip 是解析的产物、可信；draft 是
 * 待收窄的输入，必须经 `toQuery` → `parseChips` 走一遍才算数。
 */
export type ChipDraft = {
	term: string;
	alts?: string[];
	mode: ChipMode;
	off?: true;
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

/** 同一条要求里说法之间的边界。 */
const MEMBER_SPLIT = "/";

/**
 * 查询串 → chips。这是「查询」这个概念在全站的唯一解析入口。
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
		// 先剥停用，再剥强度：记号顺序是定死的（`~+X`），反过来不认，
		// 否则同一枚 chip 会有两种写法，往返就不再是恒等式。
		const off = g[0] === OFF_SIGN;
		if (off) g = g.slice(1).trim();
		const mode = MODE_PREFIX[g[0] ?? ""] ?? "must";
		if (mode !== "must") g = g.slice(1);

		const members: string[] = [];
		for (const chunk of g.split(MEMBER_SPLIT)) {
			const term = termOf(chunk);
			if (!term || seen.has(term)) continue;
			seen.add(term);
			members.push(term);
		}
		const [term, ...alts] = members;
		if (!term) continue;
		const keptAlts = alts.slice(0, MEMBER_MAX - 1);
		chips.push({
			term,
			...(keptAlts.length > 0 && { alts: keptAlts }),
			mode,
			...(off && { off: true as const }),
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
 * chips（或还没解析过的 draft）→ 查询串。说法用 `/` 连（`大模型/推荐系统`）。
 *
 * 对 chip 而言 `parseChips(toQuery(c))` 必须等于 `c`；对 draft 而言这只是
 * 「把一份外部意图写成查询」的第一步，收窄由紧跟着的 `parseChips` 做。
 * 想改一条**已有**查询，用下面的 `editChip` / `dropChip` / `enableAll`。
 */
export function toQuery(chips: readonly ChipDraft[] | readonly Chip[]): string {
	return chips
		.map(
			(c) =>
				(c.off ? OFF_SIGN : "") +
				MODE_SIGN[c.mode] +
				[c.term, ...(c.alts ?? [])].join("/"),
		)
		.join(",");
}

/**
 * 规范查询串的长度上限。**由部件推导，不是另立一个数**：最多 `CHIP_MAX` 条
 * 要求，每条最多 `MEMBER_MAX` 个说法、每个说法不超过 `MAX_TERM_LEN`，
 * 再给每条留两个记号位和分隔符。写死一个整数的话，调大说法上限那天，
 * 这条边界就会在别处安静地把查询截断。
 */
export const QUERY_MAX = CHIP_MAX * (MEMBER_MAX * (MAX_TERM_LEN + 1) + 2);

/** 不可信入参 → 一条长度有界的查询串。含义上的收窄由 `canonical` 做。 */
export function queryString(value: unknown): string {
	return typeof value === "string" ? value.slice(0, QUERY_MAX) : "";
}

/**
 * 规范化：任意查询串 → 它唯一的规范写法。落库、比较、往返都以这一份为准。
 * `canonical(canonical(q)) === canonical(q)`，`tests/parse.test.ts` 有断言。
 */
export function canonical(query: string): string {
	return toQuery(parseChips(query));
}

/**
 * 改一条已有查询：**串进、串出**。
 *
 * 这三个函数是全站改动查询证据的唯一手段。它们从解析出来的 chip 出发、原样
 * 带着其余字段写回去，所以「改强度时把说法丢了」这类错在这里写不出来——
 * 而这正是它们存在的理由：调用点各自拼一个 chip 对象的话，`{term, mode}` 拼漏
 * 一个 `alts` 就是一次静默的查询改写。
 *
 * `index` 是 chip 在这条查询里的位置。编辑不重排、不增删（`dropChip` 除外），
 * 所以调用方拿到的下标在同一份查询里一直有效。
 */
export function editChip(
	query: string,
	index: number,
	patch: { mode?: ChipMode; off?: boolean },
): string {
	return toQuery(
		parseChips(query).map((chip, i) => {
			if (i !== index) return chip;
			const { off: _off, ...rest } = chip;
			const off = patch.off ?? Boolean(chip.off);
			return {
				...rest,
				...(patch.mode && { mode: patch.mode }),
				...(off && { off: true as const }),
			};
		}),
	);
}

/** 删掉一条要求。词和它的强度一起没了，这一步不可撤销（后退键除外）。 */
export function dropChip(query: string, index: number): string {
	return toQuery(parseChips(query).filter((_, i) => i !== index));
}

/** 把停用的全部启用。强度与说法原样留着——启用不是重写。 */
export function enableAll(query: string): string {
	return toQuery(parseChips(query).map(({ off: _off, ...rest }) => rest));
}
