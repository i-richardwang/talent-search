import { narrows, type SearchFilters } from "./params";
import { type Claim, type Query, rolesOf } from "./query";

type EmptyOverflow =
	| { kind: "overflowEvidence"; claims: Claim[] }
	| { kind: "overflowPopulation" };

/**
 * 名单还不完整：还有候选人在必须或排除的条件上有没确认过的经历。没确认过的不算数，这些人里
 * 该上名单的还没上。经历从职级高的人确认起，`above` 是已经完整确认到的最低一档职级：这一档和
 * 更高的人都确认完了。最高一档也没确认完时为 null。
 */
export type Incomplete = { above: string | null };

export type EmptyReason =
	| EmptyOverflow
	| { kind: "allDisabled" }
	| { kind: "noConditions" }
	| { kind: "gatesUnmet" }
	| { kind: "filtered" }
	| { kind: "unmet" }
	| { kind: "noneMatched" }
	/** 名单上没有人，但候选人还没确认完：确认到了哪一档职级 */
	| ({ kind: "incomplete" } & Incomplete);

/** 空态成因由检索层判定，界面只负责翻译。 */
export function emptyReason(input: {
	query: Query;
	filters: SearchFilters;
	total: number;
	/** 候选人还没确认完时确认到了哪里 */
	incomplete?: Incomplete;
}): EmptyReason | null {
	const { query, filters, total, incomplete } = input;
	const { claims, gates, prefer, excludes } = rolesOf(query);
	// 只定去留的条件：门槛和排除
	const gating = gates.length + excludes.length;
	if (total > 0) return null;
	if (incomplete) return { kind: "incomplete", ...incomplete };

	if (claims.length + gating + prefer.length > 0) {
		if (narrows(filters)) return { kind: "filtered" };
		if (claims.some((c) => c.mode === "must")) return { kind: "unmet" };
		if (claims.length === 0 && gating > 0) return { kind: "gatesUnmet" };
		return { kind: "noneMatched" };
	}

	// 走到这里没有启用的条件
	return query.conditions.length > 0
		? { kind: "allDisabled" }
		: { kind: "noConditions" };
}
