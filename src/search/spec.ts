import { compileConditions } from "./compile";
import { type Condition, conditionsOf } from "./condition";
import {
	draftsOf,
	identityKey,
	type Query,
	type QueryCondition,
	withIds,
} from "./query";

/**
 * 一条查询的完整含义，查询记录的唯一事实源，也是条件编辑、最近搜索回放、搜索执行共同使用的
 * 边界。两种存法：
 *
 * - `{ query }`：对话写下的查询（`query.ts`），每条条件是固定 FROM 加一段 `where`。
 * - `{ conditions }`：关键词框写下的条件表（`keywords.ts` 能写回框里的那种）；对话链上也有这种
 *   形状的记录。读取时经 `compile.ts` 编译成查询。
 */
export type SearchSpec = { conditions: Condition[] } | { query: Query };

export type QueryInput =
	| { kind: "sentence"; text: string }
	| { kind: "spec"; spec: SearchSpec };

export function emptySpec(): SearchSpec {
	return { conditions: [] };
}

/** 一份记录要执行、要显示的查询：关键词链形状的条件表当场编译。 */
export function queryOfSpec(spec: SearchSpec): Query {
	return "query" in spec ? spec.query : compileConditions(spec.conditions);
}

/**
 * 不可信的一份查询 → 形状校验后的查询。RPC 入参走它；模型输出走 `intent.ts` 的 `understood`，
 * 两边用同一份 `draftsOf`。条件里 `where` 合不合白名单在服务端写入前再查（`server/turn.ts`）。
 */
export function sanitizeSpec(raw: unknown): SearchSpec {
	const value = (raw ?? {}) as Record<string, unknown>;
	if (value.query !== undefined) {
		const query = (value.query ?? {}) as Record<string, unknown>;
		return { query: { conditions: withIds(draftsOf(query.conditions)) } };
	}
	return { conditions: conditionsOf(value.conditions) };
}

/**
 * 一份不可信查询里写下的条件，校验之前的原样，用来认出「写了却一条不剩」；不是数组时为 null。
 */
export function askedConditions(raw: unknown): unknown[] | null {
	const value = (raw ?? {}) as Record<string, unknown>;
	const list =
		value.query !== undefined
			? ((value.query ?? {}) as Record<string, unknown>).conditions
			: value.conditions;
	return Array.isArray(list) ? list : null;
}

/**
 * 一轮前后两张条件表的差别，按条件的 id 和内容（`contentKey`）比：停用与否、标签措辞不算变化，
 * 同一个 id 改了内容算作去掉旧的、加上新的。界面据此说出这一轮加了什么、去掉了什么——
 * 模型不会不声不响地丢掉一条用户要的条件。
 */
export function changesOf(
	base: readonly QueryCondition[],
	next: readonly QueryCondition[],
): { added: QueryCondition[]; removed: QueryCondition[] } {
	const had = new Set(base.map(identityKey));
	const has = new Set(next.map(identityKey));
	return {
		added: next.filter((c) => !had.has(identityKey(c))),
		removed: base.filter((c) => !has.has(identityKey(c))),
	};
}
