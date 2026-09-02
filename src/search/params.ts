import type { SearchFilters } from "./result";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

/** 把 RPC 入参收成可信的结果视图筛选。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const filters = (value ?? {}) as Record<string, unknown>;
	const text = (input: unknown) =>
		typeof input === "string" && input.trim() ? input.trim() : undefined;
	const months = Number(filters.minMonths);
	return {
		seqL1: text(filters.seqL1),
		seqL2: text(filters.seqL2),
		companyTag: text(filters.companyTag),
		minMonths: Number.isInteger(months) && months > 0 ? months : undefined,
		kind:
			filters.kind === "internal" || filters.kind === "external"
				? filters.kind
				: undefined,
		level: text(filters.level),
		recruitment: text(filters.recruitment),
		education: text(filters.education),
		org: text(filters.org),
		school: text(filters.school),
		strong: filters.strong === true ? true : undefined,
	};
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
