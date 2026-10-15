import { DIM_KEYS, type Picked, parsePicked, textList } from "./dimensions";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

export type SearchFilters = Picked & {
	/** 入职前公司名的文本条件。 */
	company?: readonly string[];
	/** 公司内部门名或部门路径的文本条件。 */
	department?: readonly string[];
	school?: readonly string[];
};

function nameList(raw: unknown) {
	return textList(Array.isArray(raw) ? raw : [raw]);
}

/** URL 与 RPC 共用的不可信筛选边界。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const raw = (value ?? {}) as Record<string, unknown>;
	const filters: SearchFilters = { ...parsePicked(raw) };
	const company = nameList(raw.company);
	if (company) filters.company = company;
	const department = nameList(raw.department);
	if (department) filters.department = department;
	const school = nameList(raw.school);
	if (school) filters.school = school;
	return filters;
}

export const FILTER_KEYS = [
	...DIM_KEYS,
	"company",
	"department",
	"school",
] as const satisfies readonly (keyof SearchFilters)[];

export function narrows(filters: SearchFilters) {
	return FILTER_KEYS.some((key) => filters[key] !== undefined);
}

/** 把 RPC 入参转成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
