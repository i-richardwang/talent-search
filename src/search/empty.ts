import { type ExperienceCondition, experienceConditions } from "./condition";
import { narrows, type SearchFilters } from "./params";
import { queryOf } from "./result";
import type { SearchSpec } from "./spec";

type EmptyOverflow =
	| { kind: "overflowEvidence"; claims: ExperienceCondition[] }
	| { kind: "overflowPopulation" };

export type EmptyReason =
	| EmptyOverflow
	| { kind: "allDisabled" }
	| { kind: "excludeOnly" }
	| { kind: "noConditions" }
	| { kind: "personEmpty" }
	| { kind: "filtered" }
	| { kind: "unmet" }
	| { kind: "noHits" };

/** 空态成因由检索层判定，界面只负责翻译。 */
export function emptyReason(input: {
	spec: SearchSpec;
	filters: SearchFilters;
	total: number;
	overflow: EmptyOverflow | null;
}): EmptyReason | null {
	const { spec, filters, total } = input;
	const { claims, must, prefer } = queryOf(spec.conditions);
	const people = must.length + prefer.length;
	if (input.overflow) return input.overflow;
	if (total > 0) return null;

	if (claims.length > 0 || people > 0) {
		if (narrows(filters)) return { kind: "filtered" };
		if (claims.some((c) => c.mode === "must")) return { kind: "unmet" };
		if (claims.length === 0 && must.length > 0) return { kind: "personEmpty" };
		return { kind: "noHits" };
	}

	if (spec.conditions.some((c) => c.off && c.mode !== "exclude"))
		return { kind: "allDisabled" };
	if (experienceConditions(spec.conditions).length > 0)
		return { kind: "excludeOnly" };
	return { kind: "noConditions" };
}
