import { narrows, type SearchFilters } from "./params";
import { type Claim, type Query, rolesOf } from "./query";

type EmptyOverflow =
	| { kind: "overflowEvidence"; claims: Claim[] }
	| { kind: "overflowPopulation" };

export type EmptyReason =
	| EmptyOverflow
	| { kind: "allDisabled" }
	| { kind: "excludeOnly" }
	| { kind: "noConditions" }
	| { kind: "gatesUnmet" }
	| { kind: "filtered" }
	| { kind: "unmet" }
	| { kind: "noHits" };

/** 空态成因由检索层判定，界面只负责翻译。 */
export function emptyReason(input: {
	query: Query;
	filters: SearchFilters;
	total: number;
	overflow: EmptyOverflow | null;
}): EmptyReason | null {
	const { query, filters, total } = input;
	const { claims, gates, prefer } = rolesOf(query);
	const people = gates.length + prefer.length;
	if (input.overflow) return input.overflow;
	if (total > 0) return null;

	if (claims.length > 0 || people > 0) {
		if (narrows(filters)) return { kind: "filtered" };
		if (claims.some((c) => c.mode === "must")) return { kind: "unmet" };
		if (claims.length === 0 && gates.length > 0) return { kind: "gatesUnmet" };
		return { kind: "noHits" };
	}

	if (query.conditions.some((c) => c.off && c.mode !== "exclude"))
		return { kind: "allDisabled" };
	// 走到这里剩下的都是排除，启用的或停用的
	if (query.conditions.length > 0) return { kind: "excludeOnly" };
	return { kind: "noConditions" };
}
