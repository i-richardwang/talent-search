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

/** 停用的条件仍在表里。 */
export function hasConditions(spec: SearchSpec): boolean {
	return ("query" in spec ? spec.query : spec).conditions.length > 0;
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
	const query =
		raw && typeof raw === "object" && "query" in raw ? raw.query : undefined;
	const table = query === undefined ? raw : query;
	if (
		!table ||
		typeof table !== "object" ||
		!("conditions" in table) ||
		!Array.isArray(table.conditions)
	)
		throw new Error("查询格式无效");
	const list = table.conditions;
	const spec =
		query === undefined
			? { conditions: conditionsOf(list) }
			: { query: { conditions: withIds(draftsOf(list)) } };
	if (list.length > 0 && !hasConditions(spec)) throw new Error("搜索条件无效");
	return spec;
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

/**
 * 两张条件表是不是同一张：每条的身份、停用与否、先后都一样。直接改条件的一轮和上一轮是
 * 同一张表时，那一轮是「条件不变，接着往下找」。
 */
export function sameConditions(
	base: readonly QueryCondition[],
	next: readonly QueryCondition[],
): boolean {
	return (
		base.length === next.length &&
		base.every((c, i) => {
			const n = next[i];
			return (
				n !== undefined &&
				identityKey(c) === identityKey(n) &&
				Boolean(c.off) === Boolean(n.off)
			);
		})
	);
}
