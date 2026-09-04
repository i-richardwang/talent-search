/**
 * 不可信入参 → 可信的检索条件。维度那七项归 `dimensions.ts` 的 `parsePicked`，
 * 这里只收不属于那一族的几项。
 */
import { DIM_KEYS, parsePicked } from "./dimensions";
import { boundedText } from "./parse";
import type { SearchFilters } from "./result";
import type { SearchScope } from "./spec";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

/**
 * 不可信入参 → 那批收窄人群的条件。
 *
 * URL、RPC、查询范围三处收的是同一份：各写一遍的话，加一维就会有一处先松下来，
 * 而松掉的那一处不会报错。维度那七项怎么收窄写在它们自己的声明里
 * （`dimensions.ts` 的 `parse`），这里只多收不属于那一族的两项。
 *
 * 收不出取值的那一项不留键：`{ org: undefined }` 和 `{}` 说的是同一件事，而这份
 * 条件会被存进记录、被逐字比较，同一件事有两种写法就会比出「变了」。
 */
export function parsePopulation(raw: Record<string, unknown>): SearchScope {
	const pick: SearchScope = { ...parsePicked(raw) };
	const org = boundedText(raw.org);
	if (org) pick.org = org;
	const school = boundedText(raw.school);
	if (school) pick.school = school;
	return pick;
}

/** 把 RPC 入参收成可信的结果视图筛选。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const filters = (value ?? {}) as Record<string, unknown>;
	return {
		...parsePopulation(filters),
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
] as const satisfies readonly (keyof SearchScope)[];

/**
 * 这份条件收窄人群了吗。查询范围和 URL 上的筛选共用它——它们是同一批条件。
 *
 * 问的是**取值**不是键：`{ org: undefined }` 和 `{}` 说的是同一件事，让键的有无
 * 参与判断的话，每一处构造条件的代码都得记着不许留空键，而忘了不会报错。
 */
export function narrowsPopulation(pick: SearchScope) {
	return POPULATION_KEYS.some((key) => pick[key] !== undefined);
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
