import type { TraceStep } from "#/search/trace";
import { BIG_COMPANY, RECOMMEND, TEAM } from "./conditions";

/*
 * AI 检索人才库的步骤：理解一句话时查词、试搜走过的记录。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 起算时刻：步骤的 `at` 从这里往后数，只用来区分先后。 */
export const T0 = Date.UTC(2026, 8, 26, 2, 0, 0);

/** 第一轮 AI 查词、试搜走过的步骤。 */
export const ROUND1_TRACE: TraceStep[] = [
	{
		at: T0,
		tool: "look_up_words",
		words: [
			{ word: "推荐系统", canonical: "推荐系统", people: 46, wide: false },
			{ word: "推荐算法", canonical: "推荐系统", people: 46, wide: false },
		],
	},
	{
		at: T0 + 1800,
		tool: "try_conditions",
		conditions: [RECOMMEND],
		total: 46,
		empty: null,
	},
	{
		at: T0 + 3400,
		tool: "try_conditions",
		conditions: [RECOMMEND, BIG_COMPANY],
		total: 18,
		empty: null,
	},
];

/** 第二轮的步骤：一个词在人才库里对不上，一个范围较大。 */
export const ROUND2_TRACE: TraceStep[] = [
	{
		at: T0 + 60_000,
		tool: "look_up_words",
		words: [
			{ word: "团队管理", canonical: "团队管理", people: 212, wide: true },
			{ word: "技术口碑", canonical: null, people: 0, wide: false },
		],
	},
	{
		at: T0 + 62_000,
		tool: "try_conditions",
		conditions: [RECOMMEND, BIG_COMPANY, TEAM],
		total: 6,
		empty: null,
	},
];
