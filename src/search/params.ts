/**
 * 不可信入参 → 可信的检索条件。维度那七项归 `dimensions.ts` 的 `parsePicked`，
 * 这里只收不属于那一族的几项。
 */
import { DIM_KEYS, filterText, hasPicked, parsePicked } from "./dimensions";
import type { SearchFilters } from "./result";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

/** 把 RPC 入参收成可信的结果视图筛选。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const filters = (value ?? {}) as Record<string, unknown>;
	return {
		...parsePicked(filters),
		org: filterText(filters.org),
		school: filterText(filters.school),
		strong: filters.strong === true ? true : undefined,
	};
}

/**
 * 收窄**人群**的那几维。`strong` 不在其中：它答的是「证据够不够硬」，
 * 改的是什么才算命中，不是在这批人里再看哪一部分。
 *
 * 这份名单只有这一处：URL 那侧的「清除筛选」「有没有筛选」（`view-params.ts`）
 * 和检索那侧判断「是不是筛空了」（`empty.ts`）都从它派生。各写一份的话，
 * 加一维就会有一处忘了跟上，而症状是空态说错话——没有任何断言会红。
 */
export const POPULATION_KEYS = [
	...DIM_KEYS,
	"org",
	"school",
] as const satisfies readonly (keyof SearchFilters)[];

/** 有没有任何收窄人群的筛选生效。 */
export function hasPopulationFilters(f: SearchFilters) {
	return hasPicked(f) || f.org !== undefined || f.school !== undefined;
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
