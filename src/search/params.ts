import type { SearchFilters } from "./result";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

const FILTER_TEXT_MAX = 200;

/** URL 与 RPC 共用的筛选文本边界，避免任意长字符串进入 ILIKE 与 SSR 载荷。 */
export function filterText(input: unknown): string | undefined {
	return typeof input === "string" && input.trim()
		? input.trim().slice(0, FILTER_TEXT_MAX)
		: undefined;
}

/** 把 RPC 入参收成可信的结果视图筛选。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const filters = (value ?? {}) as Record<string, unknown>;
	const months = Number(filters.minMonths);
	return {
		seqL1: filterText(filters.seqL1),
		seqL2: filterText(filters.seqL2),
		companyTag: filterText(filters.companyTag),
		minMonths: Number.isInteger(months) && months > 0 ? months : undefined,
		kind:
			filters.kind === "internal" || filters.kind === "external"
				? filters.kind
				: undefined,
		level: filterText(filters.level),
		recruitment: filterText(filters.recruitment),
		education: filterText(filters.education),
		org: filterText(filters.org),
		school: filterText(filters.school),
		strong: filters.strong === true ? true : undefined,
	};
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
