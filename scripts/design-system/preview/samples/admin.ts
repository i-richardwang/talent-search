import { PAGE_SIZE, pageAt, tablePage } from "#/lib/paging";
import type { EmployeeRow, SegmentView } from "#/server/data";
import type { SkillDetail, SkillEntry } from "#/server/skills";
import type { CorpusCounts, TaskLane, TaskRunView } from "#/server/tasks";
import { EMPLOYEES, EXPERIENCES, experiencesOf } from "./people";

/*
 * 管理页：任务台的运行记录、库存数、数据页与技能页的表。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 一次运行：开始时刻写成页面上的样子，用时是秒。 */
function run(
	id: number,
	kind: TaskRunView["kind"],
	startedAt: string,
	seconds: number | null,
	outcome: TaskRunView["outcome"],
	error: string | null = null,
): TaskRunView {
	return {
		id,
		kind,
		source: kind === "sync" ? "csv-dir" : "",
		startedAt,
		seconds,
		error,
		outcome,
	};
}

/** 一栏：运行记录都在第一页，最新的一次在最前面，也就是卡片正面说的那一次。 */
function lane(kind: TaskLane["kind"], rows: TaskRunView[]): TaskLane {
	return {
		kind,
		latest: rows[0] ?? null,
		runs: tablePage(rows, rows.length, pageAt(rows.length, 1)),
	};
}

/** 任务台的三栏：同步刚跑完、派生正在跑、整理上一次失败。 */
export const TASK_LANES: TaskLane[] = [
	lane("sync", [
		run(31, "sync", "09-26 08:00", 42, "done"),
		run(28, "sync", "09-25 08:00", 39, "done"),
		run(24, "sync", "09-24 08:00", null, "interrupted"),
	]),
	lane("derive", [
		run(32, "derive", "09-26 08:01", null, "running"),
		run(29, "derive", "09-25 08:01", 611, "done"),
	]),
	lane("review", [
		run(30, "review", "09-25 20:00", 87, "failed", "AI 服务连续 3 次没有作答"),
		run(26, "review", "09-24 20:00", 132, "done"),
	]),
];

/** 任务台卡片上的库存数。 */
export const CORPUS_COUNTS: CorpusCounts = {
	employees: EMPLOYEES.length,
	internal: EXPERIENCES.filter((x) => x.kind === "internal").length,
	external: EXPERIENCES.filter((x) => x.kind === "external").length,
	segments: EXPERIENCES.length,
	pending: 2,
	phrases: 84,
	words: 37,
	merged: 5,
	glossable: 12,
	glossed: 9,
};

/** 数据页上 Talent 0101 的几段，连同派生出的技能和做过的事。 */
export const SEGMENTS: SegmentView[] = experiencesOf("T0101").map((x) => ({
	id: x.id,
	kind: x.kind,
	startDate: x.startDate,
	endDate: x.endDate,
	months: x.months,
	org: x.org,
	orgPath: x.orgPath,
	title: x.title,
	level: x.level,
	description: x.description,
	seqL1: x.seqL1,
	seqL2: x.seqL2,
	seqL3: x.seqL3,
	seqInferredL1: x.seqInferredL1,
	seqInferredL2: x.seqInferredL2,
	derived: x.id !== 103,
	skills: x.kind === "external" ? ["推荐系统", "实时特征"] : [],
	did:
		x.kind === "external"
			? [
					{ involvement: "从零搭建", domain: "实时特征管线" },
					{ involvement: "负责", domain: "带 4 人算法小组" },
				]
			: [],
}));

/** 只在数据页那张表里出现的人轮着用的部门和职位。 */
const ROSTER_JOBS: [dept: string, title: string][] = [
	["推荐算法部", "算法工程师"],
	["数据平台部", "数据开发工程师"],
	["用户增长部", "产品经理"],
	["基础架构部", "后端开发工程师"],
	["商业化部", "销售经理"],
];

/**
 * 数据页那张表的全部行，按工号排：六位候选人（段数和待处理数照他们的经历算），
 * 后面补上只在表里出现的人，一共比一页多十个，表脚的翻页才出现。
 */
export const EMPLOYEE_ROWS: EmployeeRow[] = [
	...EMPLOYEES.map((e) => ({
		curDept: e.curDept,
		curTitle: e.curTitle,
		empId: e.empId,
		name: e.name,
		pending: SEGMENTS.filter(
			(s) => !s.derived && experiencesOf(e.empId).some((x) => x.id === s.id),
		).length,
		segments: experiencesOf(e.empId).length,
	})),
	...Array.from({ length: PAGE_SIZE + 10 - EMPLOYEES.length }, (_, i) => {
		const no = String(107 + i).padStart(4, "0");
		const [curDept, curTitle] = ROSTER_JOBS[i % ROSTER_JOBS.length] ?? ["", ""];
		return {
			curDept,
			curTitle,
			empId: `T${no}`,
			name: `Talent ${no}`,
			pending: i % 7 === 0 ? 1 : 0,
			segments: 1 + (i % 4),
		};
	}),
];

/**
 * 技能页那张表，照服务端按人数从多到少排：「推荐系统」一支和它上下的词。
 * 点开的那个词（`SKILL_DETAIL`）从这里取。
 */
export const SKILL_ROWS: SkillEntry[] = [
	{
		canonical: "机器学习",
		parent: null,
		aliases: ["ML"],
		children: 2,
		people: 9,
		reviewedDaysAgo: 1,
	},
	{
		canonical: "推荐系统",
		parent: "机器学习",
		aliases: ["推荐算法", "个性化推荐"],
		children: 2,
		people: 5,
		reviewedDaysAgo: 2,
	},
	{
		canonical: "推荐排序",
		parent: "推荐系统",
		aliases: ["精排"],
		children: 0,
		people: 3,
		reviewedDaysAgo: 2,
	},
	{
		canonical: "数据分析",
		parent: null,
		aliases: ["数据挖掘"],
		children: 0,
		people: 3,
		reviewedDaysAgo: 5,
	},
	{
		canonical: "召回",
		parent: "推荐系统",
		aliases: [],
		children: 0,
		people: 2,
		reviewedDaysAgo: 0,
	},
	{
		canonical: "实时特征",
		parent: null,
		aliases: ["实时特征工程"],
		children: 0,
		people: 2,
		reviewedDaysAgo: 3,
	},
	{
		canonical: "广告算法",
		parent: "机器学习",
		aliases: ["计算广告"],
		children: 0,
		people: 1,
		reviewedDaysAgo: 6,
	},
];

/** 技能页上点开的一个词：「推荐系统」。关系与人数从技能表的行里取，释义是它自己的。 */
export const SKILL_DETAIL: SkillDetail = detailOf(
	"推荐系统",
	"为用户挑选内容或商品的系统，含召回、排序与效果评估。",
);

/** 技能表里一个词点开后的样子：它那一行，加上往上一层与往下一层的词。 */
function detailOf(canonical: string, gloss: string): SkillDetail {
	const row = SKILL_ROWS.find((entry) => entry.canonical === canonical);
	if (!row) throw new Error(`技能表里没有 ${canonical}`);
	const parent = SKILL_ROWS.find((entry) => entry.canonical === row.parent);
	return {
		aliases: row.aliases,
		canonical,
		children: SKILL_ROWS.filter((entry) => entry.parent === canonical).map(
			(entry) => ({ canonical: entry.canonical, people: entry.people }),
		),
		gloss,
		parent: parent
			? { canonical: parent.canonical, people: parent.people }
			: null,
		people: row.people,
		reviewedDaysAgo: row.reviewedDaysAgo,
	};
}
