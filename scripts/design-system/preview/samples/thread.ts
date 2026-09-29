import type { TraceStep } from "#/search/trace";
import type { RecentSearch, Turn } from "#/server/turn";
import {
	KEYWORD_SPEC,
	ROUND1_CONDITIONS,
	ROUND2_CONDITIONS,
	SPEC,
} from "./conditions";
import { ROUND1_TRACE, ROUND2_TRACE, T0 } from "./trace";

/*
 * 对话链：一次找人任务的三轮、正在理解的一轮、最近搜索。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 链头那一轮的 id，也是这次找人任务的 id。 */
export const ROOT_TURN_ID = "turn-a1";

/** 链头那句话：这次找人任务的标题。 */
export const TASK_TITLE = "找做过推荐系统的算法工程师，最好在大厂待过三年以上";

/** 链头：一句需求，整理出两条条件，替 HR 定了一个读法。 */
const ROUND1: Turn = {
	id: ROOT_TURN_ID,
	rootTurnId: ROOT_TURN_ID,
	mode: "conversation",
	title: TASK_TITLE,
	said: TASK_TITLE,
	spec: { conditions: ROUND1_CONDITIONS },
	notes: {
		assumed: ["「三年以上」按在大厂的累计时长算，满足的人排在前面。"],
		declined: [],
	},
	trace: ROUND1_TRACE,
	at: T0 - 1500,
};

/** 第二轮：补充一句，加了两条；两处要求人才库里搜不了，其中一处给了替代条件。 */
const ROUND2: Turn = {
	id: "turn-a2",
	rootTurnId: ROOT_TURN_ID,
	mode: "conversation",
	title: TASK_TITLE,
	said: "还要带过团队，最好是硕士，base 北京，技术口碑好",
	spec: { conditions: ROUND2_CONDITIONS },
	notes: {
		assumed: ["「最好是硕士」按学历硕士及以上加分。"],
		declined: [
			{ said: "base 北京", why: "人才库里没有工作地点。", instead: [] },
			{
				said: "技术口碑好",
				why: "简历里没有同事评价。",
				instead: [{ about: "experience", mode: "boost", what: ["技术分享"] }],
			},
		],
	},
	trace: ROUND2_TRACE,
	at: T0 + 58_000,
};

/** 第三轮：HR 在条件上直接移除了学历，没有说话。 */
const ROUND3: Turn = {
	id: "turn-a3",
	rootTurnId: ROOT_TURN_ID,
	mode: "conversation",
	title: TASK_TITLE,
	said: null,
	spec: SPEC,
	notes: null,
	trace: null,
	at: T0 + 90_000,
};

/** 整条对话链，链头在前；名单看的是最后一轮。 */
export const THREAD: Turn[] = [ROUND1, ROUND2, ROUND3];

/** 最后一轮的 id。 */
export const LATEST_TURN_ID = ROUND3.id;

/**
 * 等待理解的两轮发生在打开页面前几秒：计时从记录写入的时刻算起，放在过去的固定时刻上
 * 会算出一整天。
 */
const JUST_NOW = Date.now() - 3000;

/** 刚说完、AI 还在理解的一轮：还没有条件，步骤走到一半。 */
export const PENDING_TURN: Turn = {
	id: "turn-a4",
	rootTurnId: ROOT_TURN_ID,
	mode: "conversation",
	title: TASK_TITLE,
	said: "再看看做过搜索排序的",
	spec: null,
	notes: null,
	trace: null,
	at: JUST_NOW,
};

/** 理解到一半时已经走过的步骤，线程在运行中逐步显示它。 */
export const PENDING_TRACE: TraceStep[] = [
	{
		at: JUST_NOW + 1200,
		tool: "find_terms",
		terms: [
			{
				text: "搜索排序",
				people: 31,
				wide: false,
				terms: [{ name: "搜索排序", people: 27 }],
			},
		],
	},
	{
		at: JUST_NOW + 1300,
		tool: "find_names",
		field: "org",
		names: [
			{ name: "星河", people: 44, names: [{ name: "星河科技", people: 38 }] },
		],
	},
];

/** 一条新任务的链头，还在理解：没有上一轮，也还没有步骤。 */
export const FRESH_TURN: Turn = {
	id: "turn-b1",
	rootTurnId: "turn-b1",
	mode: "conversation",
	title: "找做过支付风控的后端",
	said: "找做过支付风控的后端",
	spec: null,
	notes: null,
	trace: null,
	at: JUST_NOW,
};

/** 一条对话记录的样例：只有一条必须的经历主张。 */
const said = (
	turnId: string,
	title: string,
	what: string,
	ageSeconds: number,
	at: string,
): RecentSearch => ({
	ageSeconds,
	at,
	spec: { conditions: [{ about: "experience", mode: "must", what: [what] }] },
	title,
	turnId,
});

/** 最近搜索：导航栏和首页「最近搜索」里的几条，新的在前，比首页列的八条多一条。 */
export const RECENT: RecentSearch[] = [
	{
		ageSeconds: 40,
		at: "2026-09-27 10:42",
		spec: SPEC,
		title: TASK_TITLE,
		turnId: LATEST_TURN_ID,
	},
	{
		ageSeconds: 18 * 60,
		at: "2026-09-27 10:24",
		spec: {
			conditions: [
				{ about: "experience", mode: "must", what: ["支付风控"] },
				{ about: "person", mode: "must", field: "school", values: ["学校 B"] },
			],
		},
		title: "找做过支付风控、学校 B 毕业的",
		turnId: "turn-c1",
	},
	{
		ageSeconds: 3 * 3600,
		at: "2026-09-27 07:40",
		spec: KEYWORD_SPEC,
		title: null,
		turnId: "turn-d1",
	},
	said(
		"turn-e1",
		"做过增长的产品经理",
		"用户增长",
		26 * 3600,
		"2026-09-26 08:30",
	),
	said(
		"turn-f1",
		"带过十人以上团队的",
		"团队管理",
		3 * 86400,
		"2026-09-24 16:05",
	),
	said(
		"turn-g1",
		"做过数据仓库建设",
		"数据仓库",
		5 * 86400,
		"2026-09-22 11:20",
	),
	said(
		"turn-h1",
		"做过海外市场投放",
		"海外投放",
		12 * 86400,
		"2026-09-15 09:12",
	),
	said(
		"turn-i1",
		"做过供应链计划的",
		"供应链计划",
		40 * 86400,
		"2026-08-18 14:48",
	),
	said(
		"turn-j1",
		"懂推荐系统的算法",
		"推荐系统",
		400 * 86400,
		"2025-08-23 10:00",
	),
];
