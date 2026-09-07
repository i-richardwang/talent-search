/**
 * 一条**证据要求**，以及把不可信输入收窄成它的边界。
 *
 * 要求是查询里可点、可改、可删的最小单位，也是它在库里、在 RPC 上、在屏幕上的
 * 唯一形状：一个对象数组，没有第二种写法。改一条要求就是改数组里的一项——
 * 类型盯着字段，漏一个编译不过。
 */

/**
 * 不可信文本的长度上限。超过这个长度的不是一个词、一个公司名或一句提示，
 * 是一段被误当成它们的正文。
 */
export const TEXT_MAX = 200;

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
 * 一个说法最长几个字。上限住在这里，`intentSchema` 只在 `describe` 里写建议：
 * 写成 schema 约束的话，模型多给一个长词就是整条响应作废，而收窄只会丢掉那一个词。
 */
export const MAX_TERM_LEN = 24;

/** 一个说法最短几个字。单字对语义匹配说不出任何东西。 */
const MIN_TERM_LEN = 2;

/**
 * 不可信的一段字 → 一个说法，或者什么都不是。
 *
 * 这是全站唯一产出说法的地方：模型输出的每个词、命令行敲的每一段都经过它。
 * 它只做边界工作——去两头空白、限长度——不改写字面：屏幕上写的那几个字和
 * 拿去比相似度的那几个字是同一串，改写发生在哪里都是一次看不见的查询变更。
 */
export function termOf(value: unknown): string | undefined {
	const text = boundedText(value);
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
export const REQUIREMENT_MODES = ["must", "boost", "exclude"] as const;
export type RequirementMode = (typeof REQUIREMENT_MODES)[number];

/** 一条查询最多几条要求。再多就不是一句话能说清的条件了。 */
export const REQUIREMENT_MAX = 8;

/** 一条要求最多几个说法。再多就不是一条要求了。 */
export const MEMBER_MAX = 4;

/**
 * 一条要求：几个**说法**，满足其一即满足这条要求（说法之间 OR，要求之间 AND）。
 *
 * 说法全都是用户自己说的、同权重，`members[0]` 只是屏幕和注解里代表这条要求
 * 的那一个。**说法就是嵌入的文本**：屏幕上写的那几个字和拿去比相似度的那几个字
 * 是同一串，没有第二份看不见的检索词——相近的说法不必再由谁替库补，
 * 向量空间里「算法」离「深度学习工程师」本来就近。
 *
 * `off` 是**停用**，和三档强度正交：这条要求还在查询里、还画在屏幕上，但这一次
 * 检索完全当它不存在。招聘检索是反复试的——加一条发现只剩三个人，想知道
 * 是不是它太窄。删掉再手打回来会丢掉它的强度，也丢掉「我试过这个」这件事；
 * 靠浏览器后退能退，但没人会想到那是个办法。所以停用是一等状态，不是删除的替代；
 * 做成第四档强度的话，停一次再开就变回「必须」了，而这个改动在界面上安静得
 * 没有任何提示。没停用的要求身上不长这个字段：默认状态不该有记号。
 *
 * **为什么停用只有一个布尔、没有成因**：一个词太宽而被自动停用，那是关于
 * **语料**的一条事实（`WIDE_SHARE`，见 `search.ts` 的 probeWide），不是这条
 * 要求的性质。它属于这次理解的注解（`SearchNotice` 的 `wide`），和「没处放的
 * 条件」同一档。写在要求上的话，一条会随语料重灌后失效的判断就被冻进了
 * 不可变的条件里，而这个产品对 `/s/:id` 的承诺只到条件为止。
 */
export type Requirement = Readonly<{
	members: readonly [string, ...string[]];
	mode: RequirementMode;
	off?: true;
}>;

/**
 * 不可信的一份要求列表 → 收窄后的要求。模型输出和 RPC 入参走的是同一个口子：
 * 两边的不可信程度一样，上游声明过 schema 也省不掉这一道。
 *
 * 任何不合规的说法都被局部丢弃，不牵连整条要求；说法**跨要求去重**，先出现的
 * 那一个赢：同一个词既必须又排除是自相矛盾的输入，与其猜用户想要哪个，
 * 不如让它保持第一次写下的样子，界面上看得见、改得动。
 */
export function requirementsOf(raw: unknown): Requirement[] {
	const list: Requirement[] = [];
	const seen = new Set<string>();
	for (const item of Array.isArray(raw) ? raw : []) {
		const entry = (item ?? {}) as Record<string, unknown>;
		const members: string[] = [];
		for (const candidate of Array.isArray(entry.members) ? entry.members : []) {
			const term = termOf(candidate);
			if (!term || seen.has(term)) continue;
			seen.add(term);
			members.push(term);
			if (members.length === MEMBER_MAX) break;
		}
		const [first, ...rest] = members;
		if (!first) continue;
		const mode = REQUIREMENT_MODES.includes(entry.mode as RequirementMode)
			? (entry.mode as RequirementMode)
			: "must";
		list.push({
			members: [first, ...rest],
			mode,
			...(entry.off === true && { off: true as const }),
		});
		if (list.length === REQUIREMENT_MAX) break;
	}
	return list;
}

/** 把停用的那些摘掉。检索、证据行、分面都只看这一份。 */
export function activeRequirements(
	list: readonly Requirement[],
): Requirement[] {
	return list.filter((r) => !r.off);
}

/** 停用或启用一条要求。强度与说法原样留着——停用不是重写。 */
export function withOff(requirement: Requirement, off: boolean): Requirement {
	const { off: _off, ...rest } = requirement;
	return off ? { ...rest, off: true } : rest;
}
