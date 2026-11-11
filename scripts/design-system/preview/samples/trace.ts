import type { Condition } from "#/search/condition";
import type { Probe, TraceStep } from "#/search/trace";
import { asQuery, ROUND1_CONDITIONS, ROUND2_CONDITIONS } from "./conditions";

/*
 * AI 检索人才库的步骤：理解一句话时看人才库概况、查找说法和名字、试搜、读候选人的经历并
 * 挑出符合的走过的记录；HR 直接改条件之后补人，记的是同样的读和挑。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 试搜时每条条件单独搜到的人数，按条件在表里的先后；数是编的。 */
const SEARCHED = [186, 412, 97, 1240];

/**
 * 试搜一份条件，经历还没看：每条只知道搜到多少人，名单上还没有人；`candidates` 是没看过的都
 * 算数时名单上会有的人数，`unread` 是接下来要看的经历有几段。
 */
function tried(
	list: readonly Condition[],
	candidates: number,
	unread: number,
): Probe {
	return {
		conditions: asQuery(list).map((c, i) => ({
			label: c.label,
			mode: c.mode,
			people: SEARCHED[i] ?? null,
		})),
		total: 0,
		candidates,
		unread,
	};
}

/** 起算时刻：步骤的 `at` 从这里往后数，只用来区分先后。 */
export const T0 = Date.UTC(2026, 8, 26, 2, 0, 0);

/** 第一轮 AI 走过的步骤：查找说法、试搜，再把搜到的经历分两批看完。 */
export const ROUND1_TRACE: TraceStep[] = [
	{
		at: T0,
		tool: "discover",
		discovery: {
			kind: "overview",
			streams: [{ label: "绩效", first: "2023-07-01" }],
		},
	},
	{
		at: T0 + 800,
		tool: "find",
		found: [
			{
				phrases: 23,
				top: [
					"推荐系统",
					"搜索推荐",
					"推荐算法",
					"推荐策略",
					"推荐引擎",
					"个性化推荐",
					"内容推荐",
					"推荐排序",
				],
			},
		],
	},
	{ at: T0 + 2400, tool: "probe", probe: tried(ROUND1_CONDITIONS, 138, 212) },
	{ at: T0 + 3100, tool: "read", segments: 160, left: 212 },
	{ at: T0 + 19_000, tool: "judge", fits: 97, unfit: 63 },
	{ at: T0 + 19_600, tool: "read", segments: 52, left: 52 },
	{ at: T0 + 27_000, tool: "judge", fits: 31, unfit: 21 },
];

/**
 * 第二轮的步骤：一个说法人多，一个在人才库里对不上。第一次交的条件里还留着它，新加的那条
 * 经历也还没看，要改了、看完再交。
 */
export const ROUND2_TRACE: TraceStep[] = [
	{
		at: T0 + 60_000,
		tool: "find",
		found: [
			{ phrases: 2, top: ["团队管理", "带团队"] },
			{ phrases: 0, top: [] },
		],
	},
	{
		at: T0 + 61_500,
		tool: "discover",
		discovery: {
			kind: "values",
			subject: "学历",
			values: ["本科", "硕士", "博士"],
		},
	},
	{ at: T0 + 63_000, tool: "probe", probe: tried(ROUND2_CONDITIONS, 21, 26) },
	{
		at: T0 + 64_500,
		tool: "submit",
		issues: [
			{ kind: "unfound", subject: "技术口碑" },
			{ kind: "unread", subject: null },
		],
	},
	{ at: T0 + 65_200, tool: "read", segments: 26, left: 26 },
	{ at: T0 + 71_000, tool: "judge", fits: 15, unfit: 11 },
];

/** HR 选了一句回答之后那一轮的步骤：只多了一条加分的条件，把它搜到的经历看完。 */
export const ANSWERED_TRACE: TraceStep[] = [
	{
		at: T0 + 80_800,
		tool: "find",
		found: [{ phrases: 2, top: ["技术分享", "内部讲师"] }],
	},
	{ at: T0 + 81_600, tool: "read", segments: 14, left: 14 },
	{ at: T0 + 85_000, tool: "judge", fits: 9, unfit: 5 },
];

/**
 * HR 在条件上直接移除学历之后那一轮的步骤：条件已经定了，AI 只把新进范围的候选人的经历
 * 取来看完。
 */
export const EDITED_TRACE: TraceStep[] = [
	{ at: T0 + 90_600, tool: "read", segments: 41, left: 41 },
	{ at: T0 + 97_000, tool: "judge", fits: 17, unfit: 24 },
];
