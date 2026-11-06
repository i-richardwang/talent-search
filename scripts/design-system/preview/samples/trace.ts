import type { Condition } from "#/search/condition";
import type { Probe, TraceStep } from "#/search/trace";
import {
	asQuery,
	COUNTS,
	ROUND1_CONDITIONS,
	ROUND2_CONDITIONS,
} from "./conditions";

/*
 * AI 检索人才库的步骤：理解一句话时看人才库概况、查找说法和名字、试搜走过的记录。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 试搜一份条件：每条单独的人数取 chip 上的同一份样例数。 */
function tried(list: readonly Condition[], total: number): Probe {
	return {
		conditions: asQuery(list).map((c) => ({
			label: c.label,
			mode: c.mode,
			people: COUNTS[c.id] ?? null,
			problem: null,
		})),
		total,
	};
}

/** 起算时刻：步骤的 `at` 从这里往后数，只用来区分先后。 */
export const T0 = Date.UTC(2026, 8, 26, 2, 0, 0);

/** 第一轮 AI 查找说法走过的步骤。 */
export const ROUND1_TRACE: TraceStep[] = [
	{
		at: T0,
		tool: "discover",
		discovery: {
			kind: "overview",
			relations: [
				{ name: "person", label: "员工", rows: 3200 },
				{ name: "experience", label: "工作经历", rows: 15800 },
			],
			streams: [
				{
					stream: "perf",
					label: "绩效",
					kind: "rating",
					period: "半年",
					people: 2900,
					periods: 6,
					first: "2023-07-01",
					latest: { start: "2026-01-01", end: "2026-06-30" },
					scale: ["C", "B", "B+", "A", "A+"],
				},
			],
		},
	},
	{
		at: T0 + 800,
		tool: "lookup_experience",
		terms: [
			{
				text: "推荐系统",
				people: 46,
				terms: [
					{ name: "推荐系统", people: 38, broader: null, narrower: [] },
					{ name: "搜索推荐", people: 12, broader: null, narrower: [] },
				],
			},
			{
				text: "推荐算法",
				people: 41,
				terms: [{ name: "推荐系统", people: 38, broader: null, narrower: [] }],
			},
		],
	},
	{ at: T0 + 2400, tool: "probe", probe: tried(ROUND1_CONDITIONS, 64) },
];

/** 第二轮的步骤：一个说法人多，一个在人才库里对不上。 */
export const ROUND2_TRACE: TraceStep[] = [
	{
		at: T0 + 60_000,
		tool: "lookup_experience",
		terms: [
			{
				text: "团队管理",
				people: 212,
				terms: [
					{ name: "团队管理", people: 180, broader: null, narrower: [] },
					{ name: "项目管理", people: 64, broader: null, narrower: [] },
				],
			},
			{ text: "技术口碑", people: 0, terms: [] },
		],
	},
	{
		at: T0 + 61_500,
		tool: "discover",
		discovery: {
			kind: "values",
			subject: "学历",
			values: [
				{ name: "本科", people: 1900 },
				{ name: "硕士", people: 1100 },
				{ name: "博士", people: 140 },
			],
		},
	},
	{ at: T0 + 63_000, tool: "probe", probe: tried(ROUND2_CONDITIONS, 21) },
];
