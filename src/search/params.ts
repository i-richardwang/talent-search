import { DIM_KEYS, type Picked, parsePicked, textList } from "./dimensions";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

export type SearchFilters = Picked & {
	/** 部门或公司名称的精确文本条件。 */
	org?: readonly string[];
	school?: readonly string[];
};

function nameList(raw: unknown) {
	return textList(Array.isArray(raw) ? raw : [raw]);
}

/** URL 与 RPC 共用的不可信筛选边界。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const raw = (value ?? {}) as Record<string, unknown>;
	const filters: SearchFilters = { ...parsePicked(raw) };
	const org = nameList(raw.org);
	if (org) filters.org = org;
	const school = nameList(raw.school);
	if (school) filters.school = school;
	return filters;
}

export const FILTER_KEYS = [
	...DIM_KEYS,
	"org",
	"school",
] as const satisfies readonly (keyof SearchFilters)[];

export function narrows(filters: SearchFilters) {
	return FILTER_KEYS.some((key) => filters[key] !== undefined);
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
