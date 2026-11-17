import { PAGE_SIZE, pageAt, RUNS_PAGE, tablePage } from "#/lib/paging";
import type { AccountRow } from "#/server/accounts";
import type { AuditRow } from "#/server/audit";
import type { EmployeeRow, SegmentView } from "#/server/data";
import type { TaskLane, TaskRunView } from "#/server/tasks";
import type { TermDetail, TermEntry } from "#/server/terms";
import { EMPLOYEES, EXPERIENCES, experiencesOf } from "./people";

/*
 * 管理页：任务台的运行记录、数据页与「标签」页的表、审计页的操作记录、账号页的账号。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 样例里的「现在」：9 月 26 日上午九点，最新那次同步是一小时前。 */
const NOW = Date.parse("2026-09-26T09:00:00");

/** 一次运行：开始时刻写成 `MM-DD HH:MM`，用时是秒。 */
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
		startedAt: `2026-${startedAt}`,
		ageSeconds: Math.round(
			(NOW - Date.parse(`2026-${startedAt.replace(" ", "T")}:00`)) / 1000,
		),
		seconds,
		error,
		outcome,
	};
}

/** 一栏：看的是第一页，最新的一次在最前面，也就是组头说的那一次。 */
function lane(
	kind: TaskLane["kind"],
	rows: TaskRunView[],
	progress?: TaskLane["progress"],
): TaskLane {
	const at = pageAt(rows.length, 1, RUNS_PAGE);
	return {
		kind,
		latest: rows[0] ?? null,
		runs: tablePage(rows.slice(0, at.limit), rows.length, at),
		...(progress && { progress }),
	};
}

/** 同步每天早上八点跑一次：从 9 月 26 日往前数 `days` 天那一次。 */
const dailySync = (days: number) =>
	run(
		31 - days * 3,
		"sync",
		`09-${String(26 - days).padStart(2, "0")} 08:00`,
		38 + ((days * 7) % 9),
		"done",
	);

/** 任务台的三栏：同步刚跑完（记录比一页多，有翻页）、解析正在跑、整理上一次失败。 */
export const TASK_LANES: TaskLane[] = [
	lane("sync", [
		run(31, "sync", "09-26 08:00", 42, "done"),
		run(28, "sync", "09-25 08:00", 39, "done"),
		run(24, "sync", "09-24 08:00", null, "interrupted"),
		...[3, 4, 5, 6, 7, 8].map(dailySync),
	]),
	lane(
		"derive",
		[
			run(32, "derive", "09-26 08:01", null, "running"),
			run(29, "derive", "09-25 08:01", 611, "done"),
		],
		// 正在跑，还差两段
		{ done: EXPERIENCES.length - 2, staging: false, total: EXPERIENCES.length },
	),
	lane("review", [
		run(
			30,
			"review",
			"09-25 20:00",
			87,
			"failed",
			"AI 服务连续 3 次没有作答：POST /v1/chat/completions 超时（60s），重试 3 次后放弃；已经判完的词下一轮生效。",
		),
		run(26, "review", "09-24 20:00", 132, "done"),
	]),
];

/** 数据页上 Talent 0101 的几段，连同解析出的技能和投入档。 */
export const SEGMENTS: SegmentView[] = experiencesOf("T0101").map((x) => ({
	id: x.id,
	kind: x.kind,
	startDate: x.startDate,
	endDate: x.endDate,
	months: x.months,
	company: x.company,
	department: x.department,
	departmentPath: x.departmentPath,
	title: x.title,
	level: x.level,
	description: x.description,
	seqL1: x.seqL1,
	seqL2: x.seqL2,
	seqL3: x.seqL3,
	seqInferredL1: x.seqInferredL1,
	seqInferredL2: x.seqInferredL2,
	derived: x.id !== 103,
	unanswered: x.id === 102,
	skills:
		x.kind === "external"
			? [
					{ text: "实时特征管线", engagement: "主导" },
					{ text: "算法团队管理", engagement: "主导" },
					{ text: "推荐系统", engagement: "做过" },
					{ text: "实时特征", engagement: "做过" },
					{ text: "Flink", engagement: "提到" },
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
 * 数据页那张表的全部行，按工号排：六位候选人（段数和待处理数按他们的经历算），
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
 * 「标签」页那张表，按人数从多到少排：「推荐系统」一支和它上下的词。
 * 点开的那个词（`SKILL_DETAIL`）从这里取。
 */
export const SKILL_ROWS: TermEntry[] = [
	{
		canonical: "机器学习",
		parent: null,
		aliases: ["ML"],
		children: 2,
		people: 9,
		pending: false,
	},
	{
		canonical: "推荐系统",
		parent: "机器学习",
		aliases: ["推荐算法", "个性化推荐"],
		children: 2,
		people: 5,
		pending: false,
	},
	{
		canonical: "推荐排序",
		parent: "推荐系统",
		aliases: ["精排"],
		children: 0,
		people: 3,
		pending: false,
	},
	{
		canonical: "数据分析",
		parent: null,
		aliases: ["数据挖掘"],
		children: 0,
		people: 3,
		pending: false,
	},
	{
		canonical: "召回",
		parent: "推荐系统",
		aliases: [],
		children: 0,
		people: 2,
		pending: false,
	},
	{
		canonical: "实时特征",
		parent: null,
		aliases: ["实时特征工程"],
		children: 0,
		people: 2,
		pending: false,
	},
	{
		canonical: "广告算法",
		parent: "机器学习",
		aliases: ["计算广告"],
		children: 0,
		people: 1,
		pending: true,
	},
];

/** 「标签」页上「不是能力」那张表：判定方认定说的不是一项能力的词。 */
export const EXCLUDED_ROWS: TermEntry[] = ["周报", "策略会", "沟通协调"].map(
	(canonical, index) => ({
		aliases: [],
		canonical,
		children: 0,
		parent: null,
		people: 3 - index,
		pending: false,
	}),
);

/** 「标签」页上点开的一个词：「推荐系统」。关系与人数从词表的行里取。 */
export const SKILL_DETAIL: TermDetail = detailOf(SKILL_ROWS, "推荐系统");

/** 「标签」页上备了详情的词：「推荐系统」，和判成不是能力的「周报」。 */
export const TERM_DETAILS: TermDetail[] = [
	SKILL_DETAIL,
	{ ...detailOf(EXCLUDED_ROWS, "周报"), excluded: true },
];

/** 词表里一个词点开后的样子：它那一行，加上往上一层与往下一层的词。 */
function detailOf(rows: TermEntry[], canonical: string): TermDetail {
	const row = rows.find((entry) => entry.canonical === canonical);
	if (!row) throw new Error(`词表里没有 ${canonical}`);
	const parent = rows.find((entry) => entry.canonical === row.parent);
	return {
		aliases: row.aliases,
		canonical,
		children: rows
			.filter((entry) => entry.parent === canonical)
			.map((entry) => ({ canonical: entry.canonical, people: entry.people })),
		parent: parent
			? { canonical: parent.canonical, people: parent.people }
			: null,
		excluded: false,
		people: row.people,
		pending: row.pending,
	};
}

/** 审计页的一行：`minute` 是 9 月 26 日上午八点几分。 */
function audited(
	id: number,
	minute: number,
	account: Pick<AuditRow, "name" | "username">,
	did:
		| { action: "search"; text: string }
		| { action: "view" | "export"; person: number }
		| {
				action: "create-account" | "disable-account";
				target: Pick<AccountRow, "name" | "username">;
		  },
): AuditRow {
	const person = "person" in did ? EMPLOYEES[did.person] : undefined;
	const target = "target" in did ? did.target : undefined;
	return {
		...account,
		accountName: target?.name ?? null,
		accountUsername: target?.username ?? null,
		action: did.action,
		at: `2026-09-26 08:${String(minute).padStart(2, "0")}:10`,
		empId: person?.empId ?? null,
		empName: person?.name ?? null,
		id,
		text: "text" in did ? did.text : null,
	};
}

const HR = { name: "招聘同事", username: "hr_user" };
const ADMIN = { name: "管理员", username: "admin" };
const LEFT = { name: "离职同事", username: "former_user" };

/**
 * 账号页的账号：一个管理员，一个在用的普通账号，一个停用了的。
 */
export const ACCOUNT_ROWS: AccountRow[] = [
	{ ...ADMIN, admin: true, disabled: false },
	{ ...LEFT, admin: false, disabled: true },
	{ ...HR, admin: false, disabled: false },
];

/**
 * 审计页的操作记录，新的在前：管理员建了招聘同事的账号、停用了离职同事；招聘同事搜了一次，
 * 看了名单上的两个人，导出了三个人。
 */
export const AUDIT_ROWS: AuditRow[] = [
	audited(8, 52, HR, { action: "export", person: 2 }),
	audited(7, 52, HR, { action: "export", person: 1 }),
	audited(6, 52, HR, { action: "export", person: 0 }),
	audited(5, 47, HR, { action: "view", person: 1 }),
	audited(4, 45, HR, { action: "view", person: 0 }),
	audited(3, 41, HR, {
		action: "search",
		text: "做过推荐系统、带过团队的后端",
	}),
	audited(2, 12, ADMIN, { action: "disable-account", target: LEFT }),
	audited(1, 10, ADMIN, { action: "create-account", target: HR }),
];
