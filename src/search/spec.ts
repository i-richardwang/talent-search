import type { Picked } from "./dimensions";
import { narrowsPopulation, parsePopulation } from "./params";
import { boundedText, type Requirement, requirementsOf } from "./requirement";

/**
 * 一条查询的完整含义。它是查询记录的唯一事实源，也是查询台编辑、最近搜索回放、
 * 搜索执行共同使用的边界；不能执行的部分同样属于这份含义，不能散落在旁路字段里。
 */
export type SearchSpec = {
	/** 证据要求，按句子里出现的顺序。形状与不变量见 `requirement.ts`。 */
	requirements: Requirement[];
	scope: SearchScope;
	notices: SearchNotice[];
};

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
 * 关于**这一次理解**的注解。两种都不是查询条件本身，而是「这句话被读成这样」
 * 的旁注：屏幕上它们是 chips 的脚注，不是一条要求。
 *
 * `wide` 记的是「这个词在当前语料里命中的人太多」（`WIDE_SHARE`）。它住在
 * 这里而不是 chip 上：那是关于语料的事实，会随语料重灌后失效，而 chips 是
 * 记录里不可变的那一半。词是否因此没参与检索，由 chip 自己的 `off` 说。
 */
export type SearchNotice =
	| { kind: "unsupported"; text: string }
	| { kind: "wide"; term: string };

export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "spec"; spec: SearchSpec };

export function emptySpec(): SearchSpec {
	return { requirements: [], scope: {}, notices: [] };
}

export function unsupportedOf(spec: SearchSpec) {
	return spec.notices
		.filter(
			(n): n is Extract<SearchNotice, { kind: "unsupported" }> =>
				n.kind === "unsupported",
		)
		.map((n) => n.text);
}

/** 这次理解里被判定为太宽的词。界面据此解释「它为什么是停用的」。 */
export function wideTerms(spec: SearchSpec) {
	return spec.notices.flatMap((n) => (n.kind === "wide" ? [n.term] : []));
}

/** 这份查询说了点什么吗。说了才值得落一条记录、跑一次检索。 */
export function hasMeaning(spec: SearchSpec) {
	return (
		spec.requirements.length > 0 ||
		narrowsPopulation(spec.scope) ||
		spec.notices.length > 0
	);
}

/**
 * 一份理解 → 一份可执行的查询含义。要求走一遍收窄（同一个词只留一枚），
 * 注解按内容去重。模型可能把同一个意思说两遍，而屏幕上重复的两枚 chip
 * 既解释不清也删不干净。
 *
 * **注解只解释在场的东西**：指向已经不在查询里的词的 `wide` 注解在这里被丢掉。
 * 用户删掉那枚 chip 之后，脚注里还留着一句解释它为什么被停用的话，说的是一个
 * 屏幕上不存在的东西。
 */
export function normalizeSpec(spec: SearchSpec): SearchSpec {
	const requirements = requirementsOf(spec.requirements);
	const present = new Set(requirements.map((r) => r.members[0]));
	const notices = spec.notices.filter(
		(n, i, all) =>
			(n.kind !== "wide" || present.has(n.term)) &&
			all.findIndex((x) => sameNotice(x, n)) === i,
	);
	return { requirements, scope: { ...spec.scope }, notices };
}

function sameNotice(a: SearchNotice, b: SearchNotice) {
	if (a.kind !== b.kind) return false;
	if (a.kind === "unsupported" && b.kind === "unsupported")
		return a.text === b.text;
	return a.kind === "wide" && b.kind === "wide" && a.term === b.term;
}

/** 不可信的 RPC 入参 → 完整查询；所有查询编辑都在这一边界整体收窄。 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	const requirements = requirementsOf(value.requirements);
	const scope = parsePopulation((value.scope ?? {}) as Record<string, unknown>);

	const notices: SearchNotice[] = [];
	for (const item of Array.isArray(value.notices) ? value.notices : []) {
		const x = (item ?? {}) as Record<string, unknown>;
		if (x.kind === "unsupported") {
			const message = boundedText(x.text);
			if (message) notices.push({ kind: "unsupported", text: message });
		}
		if (x.kind === "wide") {
			const term = boundedText(x.term);
			if (term) notices.push({ kind: "wide", term });
		}
	}

	return normalizeSpec({ requirements, scope, notices });
}
