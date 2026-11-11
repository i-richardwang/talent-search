import type { Engagement } from "#/lib/engagement";

export type { Route } from "#/db/schema";

// 技能按投入档打折：结果归他的不打折，只说会、熟悉的打七折。任职记录、岗位名和
// 简历原文没有档，不打折；模型没判出档的技能按「做过」算。
export const ENGAGEMENT_FACTOR: Record<Engagement, number> = {
	主导: 1,
	做过: 0.85,
	提到: 0.7,
};

// 时长使用 m / (m + half) 的饱和曲线，并累计所有算数的经历。
export const TENURE_HALF = 48;

// 离开相关方向后的月数按半衰曲线降低深度，但不使旧经历失效。
export const RECENCY_HALF = 36;

// 满足一条加分主张时，深度乘以 1 + BOOST_WEIGHT × 该主张深度；满足一条偏好乘以 1 + BOOST_WEIGHT。
export const BOOST_WEIGHT = 0.5;

export const RESULT_PAGE = 50;

// 超过此人数时明确返回达到加载上限，不静默截断总数和分面。
export const RESULT_MAX = 500;

// 筛选栏的常用单段时长选项；解析仍接受任意正整数月数。
export const MIN_MONTHS_BUCKETS = [6, 12, 24, 36] as const;

// 排名和分面在内存完成；超过上限时返回 overflow，不对事实静默截断。
export const FACT_MAX = 200_000;
