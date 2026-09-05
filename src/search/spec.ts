import type { Picked } from "./dimensions";
import { narrowsPopulation, parsePopulation } from "./params";
import { boundedText, canonical, parseChips, queryString } from "./parse";

/**
 * 一条查询的完整含义。它是查询记录的唯一事实源，也是查询台编辑、最近搜索回放、
 * 搜索执行共同使用的边界；不能执行的部分同样属于这份含义，不能散落在旁路字段里。
 */
export type SearchSpec = {
	/**
	 * 证据要求，写成**规范查询串**（`大模型/推荐系统,+带团队,~-实习`）。
	 *
	 * 存串不存对象数组，是因为这条串本来就是全站唯一的查询表示：URL 能读、
	 * 命令行能敲、服务端和页面共用同一个 `parseChips` 解它。存成对象数组的话
	 * 同一份含义就有了两种写法（谁的字段顺序、谁带不带 `off`），而每一处要
	 * 「改一枚 chip」的代码都得自己拼一个对象——拼漏一个字段就是一次静默的
	 * 查询改写。chips 由 `parseChips` 现解，编辑走 `editChip` / `dropChip` /
	 * `enableAll`（都是串进串出）。
	 */
	evidence: string;
	scope: SearchScope;
	notices: SearchNotice[];
};

/**
 * 一句原话自身的理解：模型或规则解析对这一句给出的结果，原样落在这条记录上。
 *
 * 它和 `spec` 的区别不是形状，是**出处**——`spec` 可能被人逐枚改过条件，而它
 * 永远是那次理解的原样。所以「这条查询还能不能重新理解」只能问它
 * （`server/turn.ts`）：问 `spec` 的话，改过条件的记录也会被当成理解的产物。
 */
export type SearchDelta = SearchSpec;

/**
 * 查询自身的结构化范围。
 *
 * 它和 URL 上的筛选是**同一批维度的两种生命周期**：这里的条件来自用户原话、
 * 随 turnId 保存，那边的来自地址栏、一次性，搜索时取交集。所以两者形状相同
 * （`Picked`，见 `dimensions.ts`）：同一维在两处各写一份形状的话，加一维就得
 * 手工重演两遍，而漏掉的那一遍不会报错，只会让那一维在其中一条生命周期里
 * 安静地失效。
 */
export type SearchScope = Picked & {
	/**
	 * 待过的部门或公司名里含这几个字。
	 *
	 * `org` 与 `school` 是**精确文本条件**，不是维度：公司名、学校名是专有名词，
	 * 永远不进向量（「字节」和「腾讯」在向量空间里是邻居）。它们答的是「这个人
	 * 有没有在名字含 X 的地方待过 / 是不是 X 毕业的」，按人判，在取数的 SQL 里生效。
	 */
	org?: string;
	/** 学校名里含这几个字。和 `org` 同一类。 */
	school?: string;
};

/**
 * 关于**这一次理解**的注解。三种都不是查询条件本身，而是「这句话被读成这样」
 * 的旁注：屏幕上它们是 chips 的脚注，不是一条要求。
 *
 * `wide` 记的是「这个词在当前语料里命中的人太多」（`WIDE_SHARE`）。它住在
 * 这里而不是 chip 上：那是关于语料的事实，会随语料换代失效，而 chips 是
 * 记录里不可变的那一半。词是否因此没参与检索，由 chip 自己的 `off` 说。
 */
export type SearchNotice =
	| { kind: "unsupported"; text: string }
	| { kind: "wide"; term: string }
	| { kind: "fallback" };

export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "spec"; spec: SearchSpec }
	| { kind: "reinterpret" };

export function emptySpec(): SearchSpec {
	return { evidence: "", scope: {}, notices: [] };
}

export function unsupportedOf(spec: SearchSpec) {
	return spec.notices
		.filter(
			(n): n is Extract<SearchNotice, { kind: "unsupported" }> =>
				n.kind === "unsupported",
		)
		.map((n) => n.text);
}

export function fellBack(spec: SearchSpec) {
	return spec.notices.some((n) => n.kind === "fallback");
}

/** 这次理解里被判定为太宽的词。界面据此解释「它为什么是停用的」。 */
export function wideTerms(spec: SearchSpec) {
	return spec.notices.flatMap((n) => (n.kind === "wide" ? [n.term] : []));
}

/**
 * 这份查询说了点什么吗。证据那一项问的是**解析出来的条件**，不是那串字非空：
 * 一串解析不出任何要求的字（比如只有几个记号）在检索里等于空查询，
 * 两处答案不一致的话，界面会放行一次什么都搜不到的提交。
 */
export function hasMeaning(spec: SearchSpec) {
	return (
		parseChips(spec.evidence).length > 0 ||
		narrowsPopulation(spec.scope) ||
		spec.notices.length > 0
	);
}

/**
 * 一份理解 → 一份可执行的查询含义。证据走一遍规范化（同一个词只留一枚），
 * 提示按内容去重。模型和规则解析都可能把同一个意思说两遍，而屏幕上重复的
 * 两枚 chip 既解释不清也删不干净。
 *
 * **注解只解释在场的东西**：指向已经不在查询里的词的 `wide` 注解在这里被丢掉。
 * 用户删掉那枚 chip 之后，脚注里还留着一句解释它为什么被停用的话，说的是一个
 * 屏幕上不存在的东西。
 */
export function normalizeSpec(delta: SearchDelta): SearchSpec {
	const evidence = canonical(delta.evidence);
	const present = new Set(parseChips(evidence).map((chip) => chip.term));
	const notices = delta.notices.filter(
		(n, i, all) =>
			(n.kind !== "wide" || present.has(n.term)) &&
			all.findIndex((x) => sameNotice(x, n)) === i,
	);
	return { evidence, scope: { ...delta.scope }, notices };
}

function sameNotice(a: SearchNotice, b: SearchNotice) {
	if (a.kind !== b.kind) return false;
	if (a.kind === "unsupported" && b.kind === "unsupported")
		return a.text === b.text;
	if (a.kind === "wide" && b.kind === "wide") return a.term === b.term;
	return true;
}

/** 不可信的 RPC 入参 → 完整查询；所有查询编辑都在这一边界整体收窄。 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	// 证据只有一种入参形态：那串查询。逐字段挑 chip 是第二份契约，
	// 新加一个字段必然有一处忘记跟上。
	const evidence = queryString(value.evidence);

	const scope = parsePopulation((value.scope ?? {}) as Record<string, unknown>);

	const notices: SearchNotice[] = [];
	for (const item of Array.isArray(value.notices) ? value.notices : []) {
		const x = (item ?? {}) as Record<string, unknown>;
		if (x.kind === "fallback") notices.push({ kind: "fallback" });
		if (x.kind === "unsupported") {
			const message = boundedText(x.text);
			if (message) notices.push({ kind: "unsupported", text: message });
		}
		if (x.kind === "wide") {
			const term = boundedText(x.term);
			if (term) notices.push({ kind: "wide", term });
		}
	}

	return normalizeSpec({ evidence, scope, notices });
}
