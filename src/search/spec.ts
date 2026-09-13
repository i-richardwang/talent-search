import type { Picked } from "./dimensions";
import { type Term, termsOf } from "./term";

/**
 * 一条查询的完整含义：几条条件，就这些。它是查询记录的唯一事实源，也是
 * 查询台编辑、最近搜索回放、搜索执行共同使用的边界。形状与不变量见 `term.ts`。
 */
export type SearchSpec = {
	/** 条件，按模型写出的顺序。 */
	terms: Term[];
};

/**
 * 收窄人群的那批条件，**执行用**的形状。
 *
 * 它和 URL 上的筛选是同一批维度的两种生命周期：查询自带的范围由 `scopeOf`
 * 从记录里的条件摊出来，URL 上的来自地址栏、一次性，搜索时取交集。
 * 两者形状相同（`Picked`，见 `dimensions.ts`）：同一维在两处各写一份形状的话，
 * 加一维就得手工重演两遍，而漏掉的那一遍不会报错，只会让那一维在其中一条
 * 生命周期里安静地失效。
 */
export type SearchScope = Picked & {
	/**
	 * 待过的部门或公司名里含这几个字之一。
	 *
	 * `org` 与 `school` 是**精确文本条件**，不是维度：公司名、学校名是专有名词，
	 * 永远不进向量（「字节」和「腾讯」在向量空间里是邻居）。它们答的是「这个人
	 * 有没有在名字含 X 的地方待过 / 是不是 X 毕业的」，按人判，在取数的 SQL 里生效。
	 */
	org?: readonly string[];
	/** 学校名里含这几个字之一。和 `org` 同一类。 */
	school?: readonly string[];
};

export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "spec"; spec: SearchSpec };

export function emptySpec(): SearchSpec {
	return { terms: [] };
}

/** 这份查询说了点什么吗。说了才值得落一条记录、跑一次检索。 */
export function hasMeaning(spec: SearchSpec) {
	return spec.terms.length > 0;
}

/**
 * 不可信的一份查询 → 收窄后的查询。RPC 入参走它，模型输出也走它：两边的
 * 不可信程度一样，规则只有 `termsOf` 那一份。
 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	return { terms: termsOf(value.terms) };
}
