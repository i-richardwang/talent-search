import type { TraceStep } from "#/search/trace";

/*
 * AI 检索人才库的步骤：理解一句话时查找说法、公司和学校走过的记录。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 起算时刻：步骤的 `at` 从这里往后数，只用来区分先后。 */
export const T0 = Date.UTC(2026, 8, 26, 2, 0, 0);

/** 第一轮 AI 查找说法走过的步骤。 */
export const ROUND1_TRACE: TraceStep[] = [
	{
		at: T0,
		tool: "find_terms",
		terms: [
			{
				text: "推荐系统",
				people: 46,
				wide: false,
				terms: [
					{ name: "推荐系统", people: 38 },
					{ name: "搜索推荐", people: 12 },
				],
			},
			{
				text: "推荐算法",
				people: 41,
				wide: false,
				terms: [{ name: "推荐系统", people: 38 }],
			},
		],
	},
];

/** 第二轮的步骤：一个说法范围较大，一个在人才库里对不上。 */
export const ROUND2_TRACE: TraceStep[] = [
	{
		at: T0 + 60_000,
		tool: "find_terms",
		terms: [
			{
				text: "团队管理",
				people: 212,
				wide: true,
				terms: [
					{ name: "团队管理", people: 180 },
					{ name: "项目管理", people: 64 },
				],
			},
			{ text: "技术口碑", people: 0, wide: false, terms: [] },
		],
	},
];
