import { narrows, type SearchFilters } from "./params";
import type { Claim, Exclusion, Query } from "./query";

/** 检索载荷超过上限；经历超限带上涉及的主张或排除条件。 */
export type Overflow =
	| { kind: "overflowEvidence"; conditions: (Claim | Exclusion)[] }
	| { kind: "overflowPopulation" };

/**
 * 名单还不完整：还有候选人在必须或排除的条件上有没确认过的经历。没确认过的不算数，这些人里
 * 该上名单的还没上。经历从职级高的人确认起，`above` 是已经完整确认到的最低一档职级：这一档和
 * 更高的人都确认完了。最高一档也没确认完时为 null。
 */
export type Incomplete = { above: string | null };

/**
 * 决定谁上名单的条件（启用着的必须条件，经历的和人的）合起来没有人。`nobody` 是其中单独一条
 * 就一个人都没有的那几条（条件 id）：经历条件字面就对不上、或者对得上的段都确认过不算，人的
 * 条件没有人满足。这是确定的事实，不是估计；为空时每一条单独都有人，只是凑不到同一个人身上
 * （或者被排除条件拦下了）。
 */
export type Unmet = { nobody: string[] };

export type EmptyReason =
	| Overflow
	| { kind: "allDisabled" }
	| { kind: "noConditions" }
	| { kind: "filtered" }
	| ({ kind: "unmet" } & Unmet)
	/** 名单上没有人，但候选人还没确认完：确认到了哪一档职级 */
	| ({ kind: "incomplete" } & Incomplete);

/** 没有启用的条件时名单为什么是空的：条件都停用了，还是一条条件都没有。 */
export function inactiveReason(query: Query): EmptyReason {
	return query.conditions.length > 0
		? { kind: "allDisabled" }
		: { kind: "noConditions" };
}

/**
 * 有启用的条件时名单为什么是空的；名单上有人时为 null。空态成因由检索层判定，界面只负责翻译。
 * 单独一条就没有人的条件只在成因是 `unmet` 时才数。
 */
export async function emptyReason(input: {
	filters: SearchFilters;
	total: number;
	/** 候选人还没确认完时确认到了哪里 */
	incomplete: Incomplete | undefined;
	nobody: () => Promise<string[]>;
}): Promise<EmptyReason | null> {
	const { filters, total, incomplete, nobody } = input;
	if (total > 0) return null;
	if (incomplete) return { kind: "incomplete", ...incomplete };
	if (narrows(filters)) return { kind: "filtered" };
	return { kind: "unmet", nobody: await nobody() };
}
