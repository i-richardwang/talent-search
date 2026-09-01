/**
 * 一句自然语言 → 查询条件。这里是**模型输出的形状与收窄**，不含任何模型调用。
 *
 * 拆成两半的理由和 rank.ts 一样：真正需要网络和密钥的只是薄薄一层
 * （`src/server/llm.ts`），而「模型说了什么算数、什么不算数」这件事是纯逻辑，
 * 应该能脱开模型测。这个文件里的每一条都由 `tests/intent.test.ts` 钉着。
 *
 * 两道校验不是重复：
 *
 * - `intentSchema` 是**发给模型的约束**，进 `response_format`，让模型一开始就
 *   只能生成合法形状；
 * - `toIntent` 是**回来之后的收窄**，入参是 `unknown`。模型是不可信输入，和
 *   URL、和服务端函数的入参是同一档东西（见 `validateView` / `sanitizeFilters`
 *   那两道），不能因为上游声明过 schema 就省掉。换个 provider、换个模型、
 *   甚至只是模型这次不听话，少了这一道就是一个静默变形的查询。
 */
import { z } from "zod";
import {
	CHIP_MAX,
	type Chip,
	type ChipMode,
	parseChips,
	parseQuery,
	toQuery,
} from "./parse";
import type { SearchFilters } from "./result";

const MODES = ["must", "boost", "exclude"] as const;

/** 模型能填的筛选维度。序列不在其中，理由见 `intentSchema`。 */
export type IntentFilters = Pick<
	SearchFilters,
	"kind" | "minMonths" | "companyTag"
>;

export type Intent = {
	chips: Chip[];
	filters: IntentFilters;
	/**
	 * 这次理解退回了本地规则解析。
	 *
	 * 它不是一个日志字段，是**结果正确性的一部分**：规则解析读不出语气，
	 * 「最好带过团队、不要实习」里的两个限定会被一律判成必须词，于是查询的
	 * 语义被悄悄改掉，而屏幕上的 chip 看起来一切正常。所以降级必须一路传到
	 * 界面并且明说——产品原则里那条「不静默降级」管的就是这里。
	 */
	degraded: boolean;
};

/**
 * 发给模型的输出形状。
 *
 * `companyTags` 由调用方从语料里取，**不是常识词表**：模型只能从库里真实存在的
 * 公司档里挑一个，挑不出就填 null。这和 `relaxTerm`「拿语料当词典」是同一条原则。
 *
 * **序列不做成筛选。** 库里有几十个二级序列，塞进枚举既撑长 prompt 又让模型在
 * 「这是一个概念词」和「这是一个筛选」之间反复摇摆；而序列本来就是权重最高的
 * 一路，写成概念词照样命中，还多了岗位、部门两路的召回。序列那一维的筛选留给
 * 人点——它的候选是这一次检索算出来的，比模型猜得准。
 *
 * 每一项都 `.nullable()` 而不是 `.optional()`：多数 provider 的结构化输出要求
 * 字段齐全，可选字段会被要求「必须出现」，反而逼出瞎猜的值。
 */
export function intentSchema(companyTags: readonly string[]) {
	return z.object({
		terms: z
			.array(
				z.object({
					/*
					 * 长度只写在 `describe` 里，不写成 schema 约束。
					 *
					 * 词长这件事的事实源是 `parseQuery`（2 到 24 字，停用词、
					 * 赘字剥法都在那里），而每个词回来之后都要过它一遍。这里再
					 * 写一遍数字就是第二份契约，两份迟早不一致；更糟的是这一份
					 * 是**整条响应的准入条件**——模型多给一个长词，schema 校验
					 * 不过，整句话的理解一起丢掉，退回规则解析。
					 * 收窄该发生在收窄的地方，不该发生在准入的地方。
					 */
					term: z
						.string()
						.describe(
							"一个岗位、方向或能力，两到八个字，不要带「做过」「的人」",
						),
					mode: z
						.enum(MODES)
						.describe(
							"must=必须做过；boost=最好有，没有也留下；exclude=这类经历不作数",
						),
					/*
					 * alts 与 near 都是**这一条要求的其他说法**（满足其一即可），
					 * 区别只在出处：alts 是用户嘴里明确并列的（「A 或 B 均可」），
					 * 满权重；near 是模型替库补的翻译，降档计分（值多少分归
					 * weights.ts，模型只交词不交数——判断进提示词，度量衡进代码）。
					 * 上限、去重、排除词剥 near，全在 parseChips 那一个入口做，
					 * 这里同样只在 describe 里写建议，不写成 schema 约束。
					 */
					alts: z
						.array(z.string())
						.nullable()
						.describe(
							"用户明确说了「或 / 均可」的并列说法。没有就填 null，不要自己造",
						),
					near: z
						.array(z.string())
						.nullable()
						.describe(
							"库里可能写成的相近说法（如用户说「算法」而库里写「深度学习」），最多两个，拿不准就 null；exclude 条件一律 null",
						),
				}),
			)
			.describe(`检索条件，按句子里出现的顺序，最多 ${CHIP_MAX} 条`),
		kind: z
			.enum(["internal", "external"])
			.nullable()
			.describe("只看公司内经历 / 只看入职前经历。没说就填 null"),
		/*
		 * 月数是**连续量**：SQL 那一侧是 `months >= ?`，URL 校验
		 * （`view-params.ts`）、服务端收窄（`search.ts`）和这里，三处同一条
		 * 口径——正整数。「至少 18 个月」「两年半」都说得清清楚楚，没有理由
		 * 因为筛选里没有这一档就丢掉；档位是分面的桶，不是值域，
		 * 理由见 `MIN_MONTHS_BUCKETS`。
		 */
		minMonths: z
			.int()
			.min(1)
			.nullable()
			.describe("单段经历至少做满几个月。没说就填 null"),
		companyTag: (companyTags.length > 0
			? z.enum(companyTags as [string, ...string[]]).nullable()
			: z.null()
		).describe("入职前待过的公司档，只能从给定取值里选。没说就填 null"),
	});
}

/** 非空字符串，两头空白不算内容 */
function text(v: unknown) {
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * 模型输出 → 查询条件。入参是 `unknown`，任何一处不合规都当没填，不抛。
 *
 * **每个说法都过一遍 `parseQuery`，整体再走一遍 `parseChips(toQuery(...))`。**
 * 前一道保证模型给出的词和用户自己敲出来的词切法、赘字剥法、长度上限一致；
 * 后一道把去重、条数与说法上限、「排除词不许有 near」这些规矩全部交给全站
 * 唯一的解析入口执行一遍——这里自己再写一套，就是同一批规矩两个执行点。
 * 少了这两道，模型返回「安全与风险合规」会得到一枚点一下就变形的 chip
 * （`parseQuery` 会按连接词「与」把它切成两个），而屏幕上写的和实际检索的
 * 不是一回事。
 *
 * 主词切出多个词时，第一个带上这条要求的 alts/near，其余各自成条、共享强度：
 * 一句「不要实习和外包」拆成两个排除词，语义没有走样。
 */
export function toIntent(raw: unknown, companyTags: readonly string[]): Intent {
	const o = (raw ?? {}) as Record<string, unknown>;
	const texts = (v: unknown) =>
		Array.isArray(v) ? v.flatMap((x) => parseQuery(text(x) ?? "")) : [];
	const drafts: Chip[] = [];
	for (const item of Array.isArray(o.terms) ? o.terms : []) {
		const t = (item ?? {}) as Record<string, unknown>;
		const mode = MODES.includes(t.mode as ChipMode)
			? (t.mode as ChipMode)
			: "must";
		const [head, ...rest] = parseQuery(text(t.term) ?? "");
		if (!head) continue;
		const alts = texts(t.alts);
		const near = texts(t.near);
		drafts.push({
			term: head,
			...(alts.length > 0 && { alts }),
			...(near.length > 0 && { near }),
			mode,
		});
		for (const term of rest) drafts.push({ term, mode });
	}
	const chips = parseChips(toQuery(drafts));

	const months = Number(o.minMonths);
	const tag = text(o.companyTag);
	const filters: IntentFilters = {};
	if (o.kind === "internal" || o.kind === "external") filters.kind = o.kind;
	// 和 URL 校验、服务端收窄同一条：正整数。三处同一个口径，不是三个口径。
	if (Number.isInteger(months) && months > 0) filters.minMonths = months;
	if (tag && companyTags.includes(tag)) filters.companyTag = tag;

	return { chips, filters, degraded: false };
}

/**
 * 把一次模型调用收成最终可用的查询意图。
 *
 * `null` 表示模型不可用；合法对象在收窄后也可能什么都没留下。两种情况下都用
 * 本地解析保住用户输入，并且**都记成降级**——对结果来说两者是同一件事：
 * 这次查询的语气没有人翻译。只给出筛选不算降级：模型确实读懂了句子，
 * 只是这句话里除了筛选没有别的条件。
 */
export function resolveIntent(
	query: string,
	raw: unknown | null,
	companyTags: readonly string[],
): Intent {
	if (raw !== null) {
		const intent = toIntent(raw, companyTags);
		if (intent.chips.length > 0 || Object.keys(intent.filters).length > 0)
			return intent;
	}
	return { chips: parseChips(query), filters: {}, degraded: true };
}
