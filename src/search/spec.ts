import { type Condition, conditionKey, conditionsOf } from "./condition";

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
 * 不可信的一份查询 → 校验后的查询。RPC 入参走它，模型输出也走它：两边的
 * 不可信程度一样，规则只有 `conditionsOf` 那一份。
 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	return { conditions: conditionsOf(value.conditions) };
}

/**
 * 一轮前后两张条件表的差别，按条件的身份（`conditionKey`）比：停用与否不算变化，
 * 改了取值或强度的一条算作去掉旧的、加上新的。界面据此说出这一轮加了什么、
 * 去掉了什么——模型不会不声不响地丢掉一条用户要的条件。
 */
export function changesOf(
	base: readonly Condition[],
	next: readonly Condition[],
): { added: Condition[]; removed: Condition[] } {
	const had = new Set(base.map(conditionKey));
	const has = new Set(next.map(conditionKey));
	return {
		added: next.filter((c) => !had.has(conditionKey(c))),
		removed: base.filter((c) => !has.has(conditionKey(c))),
	};
}
