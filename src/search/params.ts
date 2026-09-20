/**
 * 一次检索的视图筛选：它的形状、它的唯一那处清洗、以及「它收窄了吗」。
 *
 * 维度那八项怎么收窄归 `dimensions.ts` 的 `parsePicked`，这里只收不属于那一族的几项。
 */
import { DIM_KEYS, type Picked, parsePicked, textList } from "./dimensions";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

/**
 * 筛选栏里的那批筛选：八个维度，加上公司名与学校名两个文本条件。**每一项都在
 * 收窄人群**，所以「清除筛选」「有没有筛选」「是不是筛空了」问的都是同一件事。
 *
 * 它是「怎么看这批人」，来自 URL、一次性；查询自己的条件（`condition.ts`）是
 * 「问的是什么」，住在不可变的记录里。两者是不同的东西，各有各的形状——筛选栏
 * 按分面维度长，条件按 HR 的一句话长。
 *
 * **全部在服务端求值**：放到客户端就只能筛已经翻出来的那几页，而计数数的是
 * 全部命中的人——同一排控件会出现两种口径。
 */
export type SearchFilters = Picked & {
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
 * 不可信入参 → 可信的视图筛选。URL 与 RPC 共用这一入口：地址栏上的那份和
 * 请求里的那份必须收成同一个形状，否则同一次检索会因为从哪儿来而得到两批人。
 *
 * 维度那八项怎么收窄写在它们自己的声明里（`dimensions.ts` 的 `parse`），
 * 这里只多收不属于那一族的两项。
 *
 * 收不出取值的那一项不留键：`{ org: undefined }` 和 `{}` 说的是同一件事。
 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const raw = (value ?? {}) as Record<string, unknown>;
	const filters: SearchFilters = { ...parsePicked(raw) };
	const org = nameList(raw.org);
	if (org) filters.org = org;
	const school = nameList(raw.school);
	if (school) filters.school = school;
	return filters;
}

/**
 * 筛选的每一项。这份名单只有这一处：URL 那侧的「清除筛选」「有没有筛选」
 * （`view-params.ts`）和检索那侧判断「是不是筛空了」（`empty.ts`）都从它派生。
 * 各写一份的话，加一维就会有一处忘了跟上，而症状是空态说错话——不会有任何
 * 断言失败。
 */
export const FILTER_KEYS = [
	...DIM_KEYS,
	"org",
	"school",
] as const satisfies readonly (keyof SearchFilters)[];

/**
 * 这份筛选收窄人群了吗。
 *
 * 问的是**取值**不是键：`{ org: undefined }` 和 `{}` 说的是同一件事，让键的有无
 * 参与判断的话，每一处构造筛选的代码都得记着不能留空键，而忘了不会报错。
 */
export function narrows(filters: SearchFilters) {
	return FILTER_KEYS.some((key) => filters[key] !== undefined);
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
