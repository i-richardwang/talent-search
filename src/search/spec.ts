import { type Condition, conditionsOf } from "./condition";

/**
 * 一条查询的完整含义：几条条件，就这些。它是查询记录的唯一事实源，也是
 * 查询台编辑、最近搜索回放、搜索执行共同使用的边界。形状与不变量见 `condition.ts`。
 */
export type SearchSpec = {
	/** 条件，按模型写出的顺序。 */
	conditions: Condition[];
};

export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "spec"; spec: SearchSpec };

export function emptySpec(): SearchSpec {
	return { conditions: [] };
}

/** 这份查询说了点什么吗。说了才值得落一条记录、跑一次检索。 */
export function hasMeaning(spec: SearchSpec) {
	return spec.conditions.length > 0;
}

/**
 * 不可信的一份查询 → 收窄后的查询。RPC 入参走它，模型输出也走它：两边的
 * 不可信程度一样，规则只有 `conditionsOf` 那一份。
 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	return { conditions: conditionsOf(value.conditions) };
}
