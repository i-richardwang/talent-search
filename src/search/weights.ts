import type { Route } from "#/db/schema";

export type { Route } from "#/db/schema";

export const STRENGTHS = ["controlled", "org", "claimed"] as const;
export type Strength = (typeof STRENGTHS)[number];

export function strengthRank(strength: Strength): number {
	return STRENGTHS.indexOf(strength);
}

// 可信度只由字段来源决定；排序时它先于连续的深度分数。
export const ROUTE_STRENGTH: Record<Route, Strength> = {
	seq: "controlled",
	title: "controlled",
	org: "org",
	skill: "claimed",
	did: "claimed",
	description: "claimed",
};

export const ROUTE_ORDER = (Object.keys(ROUTE_STRENGTH) as Route[]).sort(
	(a, b) => strengthRank(ROUTE_STRENGTH[a]) - strengthRank(ROUTE_STRENGTH[b]),
);

// 向量只负责召回候选；重排分数决定是否命中。
export const RECALL_MIN = 0.5;
export const RELEVANCE_MIN = 0.55;

// 固定候选数使重排成本不随语料规模线性增长。
export const RECALL_TOP = 1000;

// 排除错误会让证据无声消失，因此采用更严格的相关度门槛。
export const RELEVANCE_MIN_EXCLUDE = 0.75;

// 时长使用 m / (m + half) 的饱和曲线，并累计所有命中经历。
export const TENURE_HALF = 48;

// 离开相关方向后的月数按半衰曲线降低深度，但不使旧经历失效。
export const RECENCY_HALF = 36;

// 满足一条加分主张时，深度乘以 1 + BOOST_WEIGHT × 该主张深度。
export const BOOST_WEIGHT = 0.5;

export const RESULT_PAGE = 50;

// 超过此人数时明确返回达到加载上限，不静默截断总数和分面。
export const RESULT_MAX = 500;

export const HITS_PER_CLAIM = 3;

// 筛选栏的常用单段时长选项；解析仍接受任意正整数月数。
export const MIN_MONTHS_BUCKETS = [6, 12, 24, 36] as const;

// 命中人数占比超过此值的词会被标为过宽。
export const WIDE_SHARE = 0.2;

// 排名和分面在内存完成；超过上限时返回 overflow，不对事实静默截断。
export const FACT_MAX = 200_000;
