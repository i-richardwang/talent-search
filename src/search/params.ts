/**
 * 不可信入参 → 可信的结果视图筛选。维度那八项归 `dimensions.ts` 的 `parsePicked`，
 * 这里只收不属于那一族的几项。
 */
import { DIM_KEYS, type Picked, parsePicked, textList } from "./dimensions";
import type { SearchFilters } from "./result";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

/**
 * 筛选栏里**收窄人群**的那批筛选：八个维度，加上公司名与学校名两个文本条件。
 *
 * 它是「怎么看这批人」，来自 URL、一次性；查询自己的条件（`condition.ts`）是
 * 「问的是什么」，住在不可变的记录里。两者是不同的东西，各有各的形状——筛选栏
 * 按分面维度长，条件按 HR 的一句话长。
 */
export type Population = Picked & {
	/**
	 * 待过的部门或公司名里含这几个字之一。
	 *
	 * `org` 与 `school` 是**精确文本条件**，不是维度：公司名、学校名是专有名词，
	 * 永远不进向量（「字节」和「腾讯」在向量空间里是邻居）。按人判，在取数的 SQL 里生效。
	 */
	org?: readonly string[];
	/** 学校名里含这几个字之一。和 `org` 同一类。 */
	school?: readonly string[];
};

/**
 * 公司名 / 学校名的取值。URL 上的只有手打一种来源，一个名字不必写成列表；
 * 清洗和上限与维度的取值列表同一份。
 */
function nameList(raw: unknown) {
	return textList(Array.isArray(raw) ? raw : [raw]);
}

/**
 * 不可信入参 → 那批收窄人群的筛选。
 *
 * URL 与 RPC 的视图筛选共用这一入口。维度那八项怎么收窄写在它们自己的声明里
 * （`dimensions.ts` 的 `parse`），这里只多收不属于那一族的两项。
 *
 * 收不出取值的那一项不留键：`{ org: undefined }` 和 `{}` 说的是同一件事。
 */
export function parsePopulation(raw: Record<string, unknown>): Population {
	const pick: Population = { ...parsePicked(raw) };
	const org = nameList(raw.org);
	if (org) pick.org = org;
	const school = nameList(raw.school);
	if (school) pick.school = school;
	return pick;
}

/** 把 RPC 入参收成可信的结果视图筛选。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const filters = (value ?? {}) as Record<string, unknown>;
	return {
		...parsePopulation(filters),
		strong: filters.strong === true ? true : undefined,
		order: filters.order === "depth" ? "depth" : undefined,
	};
}

/**
 * 收窄**人群**的那几维。`strong` 和 `order` 不在其中：一个答「证据够不够硬」，
 * 一个答「先看谁」，都不是在这批人里再看哪一部分。
 *
 * 这份名单只有这一处：URL 那侧的「清除筛选」「有没有筛选」（`view-params.ts`）
 * 和检索那侧判断「是不是筛空了」（`empty.ts`）都从它派生。各写一份的话，
 * 加一维就会有一处忘了跟上，而症状是空态说错话——没有任何断言会红。
 */
export const POPULATION_KEYS = [
	...DIM_KEYS,
	"org",
	"school",
] as const satisfies readonly (keyof Population)[];

/**
 * 这份筛选收窄人群了吗。
 *
 * 问的是**取值**不是键：`{ org: undefined }` 和 `{}` 说的是同一件事，让键的有无
 * 参与判断的话，每一处构造筛选的代码都得记着不许留空键，而忘了不会报错。
 */
export function narrowsPopulation(pick: Population) {
	return POPULATION_KEYS.some((key) => pick[key] !== undefined);
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
