import type { TraceStep } from "#/search/trace";
import type { ConditionExplained, ThreadTurn } from "#/server/explain";
import type { RecentSearch } from "#/server/turn";
import {
	asQuery,
	KEYWORD_SPEC,
	ROUND1_CONDITIONS,
	ROUND2_CONDITIONS,
	SHARING_CONDITIONS,
	SPEC,
} from "./conditions";
import {
	ANSWERED_TRACE,
	EDITED_TRACE,
	ROUND1_TRACE,
	ROUND2_TRACE,
	T0,
} from "./trace";

/*
 * 对话链：一次找人任务的三轮、正在理解的一轮、改完条件正在补人的一轮、最近搜索。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 每条条件点开后的说明，按条件的名称写，和服务端照条件解析出来的一样（`server/explain.ts`）。 */
const EXPLAINED_BY_LABEL: Record<string, ConditionExplained> = {
	推荐系统: {
		options: [],
		work: {
			written: [{ tag: "推荐系统" }, { word: "/" }, { tag: "推荐算法" }],
		},
		months: null,
	},
	"大厂 · 3 年以上": {
		work: null,
		options: [
			{
				lead: null,
				rows: [{ kind: "fact", field: "入职前公司", value: [{ tag: "大厂" }] }],
			},
		],
		months: 36,
	},
	团队管理: {
		options: [],
		work: { written: [{ tag: "团队管理" }] },
		months: null,
	},
	"学历 · 硕士及以上": {
		work: null,
		options: [
			{
				lead: null,
				rows: [
					{
						kind: "fact",
						field: "学历",
						value: [{ tag: "硕士" }, { word: "及以上" }],
					},
				],
			},
		],
		months: null,
	},
	技术分享: {
		options: [],
		work: { written: [{ tag: "技术分享" }] },
		months: null,
	},
};

/** 各轮出现过的条件按 id 配上说明；每一轮都带这一份，线程按条件 id 取。 */
const EXPLAINED: ThreadTurn["explained"] = Object.fromEntries(
	asQuery(SHARING_CONDITIONS).map((c) => {
		const explained = EXPLAINED_BY_LABEL[c.label];
		if (!explained) throw new Error(`样例条件「${c.label}」没有说明`);
		return [c.id, explained];
	}),
);

/** 链头那一轮的 id，也是这次找人任务的 id。 */
export const ROOT_TURN_ID = "turn-a1";

/** 链头那句话：这次找人任务的标题。 */
export const TASK_TITLE = "找做过推荐系统的算法工程师，最好在大厂待过三年以上";

/** 链头：一句需求，整理出两条条件，意思都明确，AI 不多说。 */
const ROUND1: ThreadTurn = {
	id: ROOT_TURN_ID,
	mode: "conversation",
	title: TASK_TITLE,
	said: TASK_TITLE,
	spec: { query: { conditions: asQuery(ROUND1_CONDITIONS) } },
	notes: null,
	trace: ROUND1_TRACE,
	startedAt: T0 - 1500,
	fault: null,
	settled: true,
	at: T0 - 1500,
	explained: EXPLAINED,
};

/** 第二轮：补充一句，加了两条；两处要求人才库里搜不了，AI 问要不要换成相近的找法，给一句可以选的回答。 */
const ROUND2: ThreadTurn = {
	id: "turn-a2",
	mode: "conversation",
	title: TASK_TITLE,
	said: "还要带过团队，要硕士，base 北京，技术口碑好",
	spec: { query: { conditions: asQuery(ROUND2_CONDITIONS) } },
	notes: {
		says: "人才库里没有工作地点，简历里也看不出技术口碑，要不要先看做过技术分享的？",
		choices: {
			current: "先不管这两条",
			others: [
				{
					label: "做过技术分享的优先",
					detail: "简历里写过技术分享的有六十多位",
				},
			],
		},
	},
	trace: ROUND2_TRACE,
	startedAt: T0 + 58_000,
	fault: null,
	settled: true,
	at: T0 + 58_000,
	explained: EXPLAINED,
};

/**
 * 第三轮：HR 在条件上直接移除了学历，没有说话。不是硕士的候选人进了范围，AI 接着把他们的
 * 经历看完，这一轮底下是补人的过程。
 */
const ROUND3: ThreadTurn = {
	id: "turn-a3",
	mode: "conversation",
	title: TASK_TITLE,
	said: null,
	spec: SPEC,
	notes: null,
	trace: EDITED_TRACE,
	startedAt: T0 + 90_000,
	fault: null,
	settled: true,
	at: T0 + 90_000,
	explained: EXPLAINED,
};

/** 第二轮之后 HR 选了 AI 给的那句回答：它就是下一句话，AI 照着再理解一轮，多了一条加分的条件。 */
export const ANSWERED_TURN: ThreadTurn = {
	id: "turn-a3-chosen",
	mode: "conversation",
	title: TASK_TITLE,
	said: "做过技术分享的优先",
	spec: { query: { conditions: asQuery(SHARING_CONDITIONS) } },
	notes: null,
	trace: ANSWERED_TRACE,
	startedAt: T0 + 80_000,
	fault: null,
	settled: true,
	at: T0 + 80_000,
	explained: EXPLAINED,
};

/** 整条对话链，链头在前；名单看的是最后一轮。 */
export const THREAD: ThreadTurn[] = [ROUND1, ROUND2, ROUND3];

/** 链头那一轮；只看它时它也是最后一轮。 */
export const ROOT_TURN = ROUND1;

/** 第二轮 AI 在问；只看前两轮时它是最后一轮。 */
export const ASKING_TURN = ROUND2;

export const LATEST_TURN = ROUND3;
export const LATEST_TURN_ID = LATEST_TURN.id;

/**
 * 还在等 AI 的几轮发生在打开页面前几秒：计时从这一次处理开始的时刻算起，放在过去的
 * 固定时刻上会算出一整天。
 */
const JUST_NOW = Date.now() - 3000;

/**
 * 第三轮刚改完、AI 还在补人时的样子：条件已经有了，名单先按确认过的出；补人没成时也是它，
 * 配上出错的环节。
 */
export const COMPLETING_TURN: ThreadTurn = {
	...ROUND3,
	trace: [],
	startedAt: JUST_NOW,
	settled: false,
	at: JUST_NOW,
	explained: EXPLAINED,
};

/** 补人补到一半时已经走过的步骤：刚取来新进范围的那些经历。 */
export const COMPLETING_TRACE: TraceStep[] = [
	{ at: JUST_NOW + 900, tool: "read", segments: 41, left: 41 },
];

/** 刚说完、AI 还在理解的一轮：还没有条件，步骤走到一半。 */
export const PENDING_TURN: ThreadTurn = {
	id: "turn-a4",
	mode: "conversation",
	title: TASK_TITLE,
	said: "再看看做过搜索排序的",
	spec: null,
	notes: null,
	trace: null,
	startedAt: JUST_NOW,
	fault: null,
	settled: false,
	at: JUST_NOW,
	explained: EXPLAINED,
};

/** 理解到一半时已经走过的步骤，线程在运行中逐步显示它：正看到第一批经历。 */
export const PENDING_TRACE: TraceStep[] = [
	{
		at: JUST_NOW + 1200,
		tool: "find",
		found: [{ phrases: 14, top: ["搜索排序", "排序模型"] }],
	},
	{
		at: JUST_NOW + 1300,
		tool: "discover",
		discovery: {
			kind: "names",
			subject: "公司",
			found: [{ query: "星河", values: ["星河科技"] }],
		},
	},
	{ at: JUST_NOW + 2100, tool: "read", segments: 160, left: 214 },
];

/** 一条新任务的链头，还在理解：没有上一轮，也还没有步骤。 */
export const FRESH_TURN: ThreadTurn = {
	id: "turn-b1",
	mode: "conversation",
	title: "找做过支付风控的后端",
	said: "找做过支付风控的后端",
	spec: null,
	notes: null,
	trace: null,
	startedAt: JUST_NOW,
	fault: null,
	settled: false,
	at: JUST_NOW,
	explained: EXPLAINED,
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
	status: null,
	title,
	turnId,
});

/** 最近搜索：导航栏和首页「最近搜索」里的几条，新的在前，比首页列的八条多一条。 */
export const RECENT: RecentSearch[] = [
	{
		ageSeconds: 40,
		at: "2026-09-27 10:42",
		spec: SPEC,
		status: null,
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
		status: "working",
		title: "找做过支付风控、学校 B 毕业的",
		turnId: "turn-c1",
	},
	{
		ageSeconds: 3 * 3600,
		at: "2026-09-27 07:40",
		spec: KEYWORD_SPEC,
		status: null,
		title: null,
		turnId: "turn-d1",
	},
	{
		...said(
			"turn-e1",
			"做过增长的产品经理",
			"用户增长",
			26 * 3600,
			"2026-09-26 08:30",
		),
		status: "failed",
	},
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
