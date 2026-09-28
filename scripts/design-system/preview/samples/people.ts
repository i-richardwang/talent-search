import type { Employee, Experience } from "#/db/schema";
import { type PopulationFact, rankPopulation } from "#/search/rank";
import {
	emptyFacets,
	type Facets,
	type Hit,
	type RankedResult,
	type SearchOutcome,
} from "#/search/result";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";
import { CLAIMS } from "./conditions";

/*
 * 候选人：六位候选人的档案、经历与命中，名单、分面与几种检索结果。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 本公司在部门路径里的写法。 */
const HOME = "某某科技";

/** 六位候选人的档案，名单顺序就是这个顺序。 */
export const EMPLOYEES: Employee[] = [
	{
		empId: "T0101",
		name: "Talent 0101",
		curDept: "推荐算法部",
		curTitle: "高级算法工程师",
		curSeqL1: "技术",
		curSeqL2: "算法",
		curSeqL3: "推荐",
		curLevel: "L7",
		curLevelBand: "L7",
		curLevelRank: 7,
		hireDate: "2019-07-01",
		educationLevel: "硕士",
		educationRank: 4,
		school: "学校 A",
		recruitment: "社招",
	},
	{
		empId: "T0102",
		name: "Talent 0102",
		curDept: "搜索推荐部",
		curTitle: "推荐系统工程师",
		curSeqL1: "技术",
		curSeqL2: "算法",
		curSeqL3: "推荐",
		curLevel: "L6",
		curLevelBand: "L6",
		curLevelRank: 6,
		hireDate: "2020-03-02",
		educationLevel: "本科",
		educationRank: 3,
		school: "学校 B",
		recruitment: "社招",
	},
	{
		empId: "T0103",
		name: "Talent 0103",
		curDept: "推荐平台部",
		curTitle: "技术经理",
		curSeqL1: "技术",
		curSeqL2: "后端开发",
		curSeqL3: "",
		curLevel: "L7",
		curLevelBand: "L7",
		curLevelRank: 7,
		hireDate: "2018-04-09",
		educationLevel: "硕士",
		educationRank: 4,
		school: "学校 C",
		recruitment: "社招",
	},
	{
		empId: "T0104",
		name: "Talent 0104",
		curDept: "内容理解部",
		curTitle: "算法工程师",
		curSeqL1: "技术",
		curSeqL2: "算法",
		curSeqL3: "",
		curLevel: "L6",
		curLevelBand: "L6",
		curLevelRank: 6,
		hireDate: "2023-02-13",
		educationLevel: "博士",
		educationRank: 5,
		school: "学校 A",
		recruitment: "社招",
	},
	{
		empId: "T0105",
		name: "Talent 0105",
		curDept: "用户增长部",
		curTitle: "数据分析师",
		curSeqL1: "技术",
		curSeqL2: "数据分析",
		curSeqL3: "",
		curLevel: "L5",
		curLevelBand: "L5 及以下",
		curLevelRank: 5,
		hireDate: "2022-07-04",
		educationLevel: "本科",
		educationRank: 3,
		school: "学校 D",
		recruitment: "校招",
	},
	{
		empId: "T0106",
		name: "Talent 0106",
		curDept: "广告算法部",
		curTitle: "算法专家",
		curSeqL1: "技术",
		curSeqL2: "算法",
		curSeqL3: "广告",
		curLevel: "L8",
		curLevelBand: "L8 及以上",
		curLevelRank: 8,
		hireDate: "2024-05-20",
		educationLevel: "硕士",
		educationRank: 4,
		school: "学校 B",
		recruitment: "社招",
	},
];

/** 一段公司内的任职：部门路径由本公司名和部门拼出来，入职前那几列留空。 */
function internal(
	row: Pick<
		Experience,
		| "id"
		| "empId"
		| "startDate"
		| "endDate"
		| "org"
		| "title"
		| "seqL1"
		| "seqL2"
		| "seqL3"
		| "level"
		| "months"
	> & { center?: string },
): Experience {
	const { center = "技术中心", ...rest } = row;
	return {
		...rest,
		key: `x${row.id}`,
		kind: "internal",
		orgPath: `${HOME}/${center}/${row.org}`,
		orgMeta: null,
		seqInferredL1: "",
		seqInferredL2: "",
		description: "",
		derivedIdentity: "d1",
		derivedAt: new Date("2026-09-20T00:00:00Z"),
	};
}

/** 一段入职前的经历：公司档、行业、性质写在 `orgMeta`，序列是推断的一对。 */
function external(
	row: Pick<
		Experience,
		| "id"
		| "empId"
		| "startDate"
		| "endDate"
		| "org"
		| "title"
		| "description"
		| "months"
		| "seqInferredL1"
		| "seqInferredL2"
	> & { tag: string; industry?: string },
): Experience {
	const { tag, industry = "互联网", ...rest } = row;
	return {
		...rest,
		key: `x${row.id}`,
		kind: "external",
		orgPath: "",
		orgMeta: { company_tag: tag, industry, nature: "民营" },
		seqL1: "",
		seqL2: "",
		seqL3: "",
		level: "",
		derivedIdentity: "d1",
		derivedAt: new Date("2026-09-20T00:00:00Z"),
	};
}

/** 全部经历段，按人、按开始时间从早到晚。 */
export const EXPERIENCES: Experience[] = [
	external({
		id: 101,
		empId: "T0101",
		startDate: "2015-07-01",
		endDate: "2019-06-30",
		org: "某甲科技",
		title: "算法工程师",
		description:
			"负责信息流推荐系统的召回与排序，从零搭建实时特征管线；后期带 4 人算法小组，负责新人培养。",
		months: 48,
		seqInferredL1: "技术",
		seqInferredL2: "算法",
		tag: "大厂",
	}),
	internal({
		id: 102,
		empId: "T0101",
		startDate: "2019-07-01",
		endDate: "2021-03-31",
		org: "推荐算法部",
		title: "算法工程师",
		seqL1: "技术",
		seqL2: "算法",
		seqL3: "推荐",
		level: "L6",
		months: 21,
	}),
	internal({
		id: 103,
		empId: "T0101",
		startDate: "2021-04-01",
		endDate: null,
		org: "推荐算法部",
		title: "高级算法工程师",
		seqL1: "技术",
		seqL2: "算法",
		seqL3: "推荐",
		level: "L7",
		months: 65,
	}),
	external({
		id: 201,
		empId: "T0102",
		startDate: "2016-03-01",
		endDate: "2020-02-29",
		org: "某乙网络",
		title: "后端开发工程师",
		description: "负责商品详情页服务端开发，参与过推荐接口的性能优化。",
		months: 48,
		seqInferredL1: "技术",
		seqInferredL2: "后端开发",
		tag: "大厂",
	}),
	internal({
		id: 202,
		empId: "T0102",
		startDate: "2020-03-02",
		endDate: null,
		org: "搜索推荐部",
		title: "推荐系统工程师",
		seqL1: "技术",
		seqL2: "算法",
		seqL3: "推荐",
		level: "L6",
		months: 78,
	}),
	external({
		id: 301,
		empId: "T0103",
		startDate: "2013-07-01",
		endDate: "2018-03-31",
		org: "某丙数据",
		title: "研发组长",
		description: "带 6 人研发小组，负责数据平台的调度与存储。",
		months: 57,
		seqInferredL1: "技术",
		seqInferredL2: "后端开发",
		tag: "中型",
		industry: "企业服务",
	}),
	internal({
		id: 302,
		empId: "T0103",
		startDate: "2018-04-09",
		endDate: "2022-12-31",
		org: "推荐平台部",
		title: "高级后端开发工程师",
		seqL1: "技术",
		seqL2: "后端开发",
		seqL3: "",
		level: "L6",
		months: 57,
	}),
	internal({
		id: 303,
		empId: "T0103",
		startDate: "2023-01-01",
		endDate: null,
		org: "推荐平台部",
		title: "技术经理",
		seqL1: "技术",
		seqL2: "后端开发",
		seqL3: "",
		level: "L7",
		months: 45,
	}),
	external({
		id: 401,
		empId: "T0104",
		startDate: "2017-07-01",
		endDate: "2023-01-31",
		org: "某丁智能",
		title: "算法研究员",
		description:
			"研究短视频推荐的多目标排序，负责排序策略上线与效果评估；指导两名实习生。",
		months: 67,
		seqInferredL1: "技术",
		seqInferredL2: "算法",
		tag: "大厂",
		industry: "人工智能",
	}),
	internal({
		id: 402,
		empId: "T0104",
		startDate: "2023-02-13",
		endDate: null,
		org: "内容理解部",
		title: "算法工程师",
		seqL1: "技术",
		seqL2: "算法",
		seqL3: "",
		level: "L6",
		months: 44,
	}),
	external({
		id: 501,
		empId: "T0105",
		startDate: "2019-07-01",
		endDate: "2022-06-30",
		org: "某戊电商",
		title: "数据分析师",
		description: "为首页推荐位做过 A/B 实验分析，写过推荐效果的日报。",
		months: 36,
		seqInferredL1: "技术",
		seqInferredL2: "数据分析",
		tag: "中型",
		industry: "电商",
	}),
	internal({
		id: 502,
		empId: "T0105",
		startDate: "2022-07-04",
		endDate: null,
		org: "用户增长部",
		title: "数据分析师",
		center: "增长中心",
		seqL1: "技术",
		seqL2: "数据分析",
		seqL3: "",
		level: "L5",
		months: 51,
	}),
	external({
		id: 601,
		empId: "T0106",
		startDate: "2012-07-01",
		endDate: "2017-12-31",
		org: "某己科技",
		title: "算法工程师",
		description: "负责搜索广告的点击率预估。",
		months: 66,
		seqInferredL1: "技术",
		seqInferredL2: "算法",
		tag: "大厂",
	}),
	external({
		id: 602,
		empId: "T0106",
		startDate: "2018-01-01",
		endDate: "2024-04-30",
		org: "某甲科技",
		title: "推荐算法负责人",
		description:
			"负责电商推荐算法团队，管理 12 人；主导推荐系统从离线到实时的改造。",
		months: 76,
		seqInferredL1: "技术",
		seqInferredL2: "算法",
		tag: "大厂",
	}),
	internal({
		id: 603,
		empId: "T0106",
		startDate: "2024-05-20",
		endDate: null,
		org: "广告算法部",
		title: "算法专家",
		seqL1: "技术",
		seqL2: "算法",
		seqL3: "广告",
		level: "L8",
		months: 29,
	}),
];

/** 一个人的全部经历段，按开始时间从早到晚。 */
export function experiencesOf(empId: string): Experience[] {
	return EXPERIENCES.filter((x) => x.empId === empId);
}

/**
 * 一条命中：起止、组织、岗位和序列从经历段 `x` 抄，默认第一条主张、相关度 0.9、
 * 没有说法与参与方式；`over` 里写这条命中自己的几项，也可以盖掉抄来的。
 */
export function hitOn(
	x: Experience,
	over: Pick<Hit, "value" | "route"> & Partial<Hit>,
): Hit {
	const seq =
		x.kind === "internal"
			? [x.seqL1, x.seqL2, x.seqL3]
			: [x.seqInferredL1, x.seqInferredL2];
	return {
		experienceId: x.id,
		claim: 0,
		relevance: 0.9,
		phrase: null,
		involvement: null,
		startDate: x.startDate,
		endDate: x.endDate,
		org: x.org,
		title: x.title,
		seq: seq.filter(Boolean).join(" · "),
		...over,
	};
}

/** 样例里的一段经历，按编号取。 */
export function experience(id: number): Experience {
	const x = EXPERIENCES.find((row) => row.id === id);
	if (!x) throw new Error(`样例里没有经历段 ${id}`);
	return x;
}

/**
 * 名单上的六个人，按名次排好：登记的证据在前，只有简历自述的在后。
 * 第一条主张是「推荐系统」，第二条是「团队管理」（加分，有的人没命中）。
 */
export const RESULTS: RankedResult[] = [
	{
		employee: EMPLOYEES[0] as Employee,
		strength: "controlled",
		depth: 86,
		hits: [
			hitOn(experience(103), {
				value: "推荐系统",
				route: "seq",
				relevance: 0.93,
			}),
			hitOn(experience(102), {
				value: "推荐系统",
				route: "seq",
				relevance: 0.93,
			}),
			hitOn(experience(101), {
				claim: 1,
				value: "团队管理",
				route: "did",
				relevance: 0.81,
				phrase: "带 4 人算法小组",
				involvement: "负责",
			}),
		],
		basis: [
			{
				route: "seq",
				value: "推荐系统",
				relevance: 0.93,
				months: 86,
				endDate: null,
				external: false,
			},
			{
				route: "did",
				value: "团队管理",
				relevance: 0.81,
				months: 48,
				endDate: "2019-06-30",
				external: true,
			},
		],
	},
	{
		employee: EMPLOYEES[1] as Employee,
		strength: "controlled",
		depth: 78,
		hits: [
			hitOn(experience(202), {
				value: "推荐系统",
				route: "title",
				relevance: 0.9,
			}),
		],
		basis: [
			{
				route: "title",
				value: "推荐系统",
				relevance: 0.9,
				months: 78,
				endDate: null,
				external: false,
			},
			null,
		],
	},
	{
		employee: EMPLOYEES[2] as Employee,
		strength: "org",
		depth: 102,
		hits: [
			hitOn(experience(303), {
				value: "推荐算法",
				route: "org",
				relevance: 0.74,
			}),
			hitOn(experience(302), {
				value: "推荐算法",
				route: "org",
				relevance: 0.74,
			}),
			hitOn(experience(303), {
				claim: 1,
				value: "带团队",
				route: "title",
				relevance: 0.78,
			}),
		],
		basis: [
			{
				route: "org",
				value: "推荐算法",
				relevance: 0.74,
				months: 102,
				endDate: null,
				external: false,
			},
			{
				route: "title",
				value: "带团队",
				relevance: 0.78,
				months: 45,
				endDate: null,
				external: false,
			},
		],
	},
	{
		employee: EMPLOYEES[5] as Employee,
		strength: "claimed",
		depth: 76,
		hits: [
			hitOn(experience(602), {
				value: "推荐算法",
				route: "skill",
				relevance: 0.88,
				phrase: "推荐算法",
			}),
			hitOn(experience(602), {
				claim: 1,
				value: "团队管理",
				route: "did",
				relevance: 0.86,
				phrase: "管理 12 人算法团队",
				involvement: "负责",
			}),
		],
		basis: [
			{
				route: "skill",
				value: "推荐算法",
				relevance: 0.88,
				months: 76,
				endDate: "2024-04-30",
				external: true,
			},
			{
				route: "did",
				value: "团队管理",
				relevance: 0.86,
				months: 76,
				endDate: "2024-04-30",
				external: true,
			},
		],
	},
	{
		employee: EMPLOYEES[3] as Employee,
		strength: "claimed",
		depth: 67,
		hits: [
			hitOn(experience(401), {
				value: "推荐系统",
				route: "did",
				relevance: 0.84,
				phrase: "短视频推荐多目标排序",
				involvement: "研究",
			}),
		],
		basis: [
			{
				route: "did",
				value: "推荐系统",
				relevance: 0.84,
				months: 67,
				endDate: "2023-01-31",
				external: true,
			},
			null,
		],
	},
	{
		employee: EMPLOYEES[4] as Employee,
		strength: "claimed",
		depth: 36,
		hits: [
			hitOn(experience(501), {
				value: "推荐系统",
				route: "description",
				relevance: 0.66,
			}),
		],
		basis: [
			{
				route: "description",
				value: "推荐系统",
				relevance: 0.66,
				months: 36,
				endDate: "2022-06-30",
				external: true,
			},
			null,
		],
	},
];

/** 一个人在这次搜索里的那一条结果；不在名单上是 null。 */
export function resultOf(empId: string): RankedResult | null {
	return RESULTS.find((r) => r.employee.empId === empId) ?? null;
}

/** 一个人在这次搜索里的全部命中。 */
export function hitsOf(empId: string): Hit[] {
	return resultOf(empId)?.hits ?? [];
}

/** 各段经历抽出的能力词，已是标准写法；筛选栏「技能」一维从这里数。 */
const SKILLS: Record<number, string[]> = {
	101: ["团队管理"],
	102: ["推荐系统"],
	202: ["推荐系统"],
	302: ["推荐系统"],
	303: ["团队管理"],
	401: ["推荐系统"],
	602: ["推荐系统", "团队管理"],
};

/** 六个人的每段经历写成分面要读的那几列，和检索层取回的事实同形。 */
const FACTS: PopulationFact[] = EXPERIENCES.map((x) => {
	const person = EMPLOYEES.find((row) => row.empId === x.empId);
	if (!person) throw new Error(`样例里没有 ${x.empId}`);
	return {
		empId: x.empId,
		months: x.months,
		seqL1: x.seqL1 || x.seqInferredL1,
		seqL2: x.seqL2 || x.seqInferredL2,
		kind: x.kind,
		companyTag: x.orgMeta?.company_tag ?? null,
		skills: SKILLS[x.id] ?? [],
		level: person.curLevelBand,
		levelRank: person.curLevelRank,
		recruitment: person.recruitment,
		education: person.educationLevel,
		educationRank: person.educationRank,
	};
});

/** 名单左边筛选栏的分面：用检索层同一份分面算法，从六个人的事实数出来，没有筛选。 */
export const FACETS: Facets = rankPopulation(FACTS, {}).facets;

/** 超过一页的总数（两页）：名单下面还有「再加载」。 */
export const TWO_PAGES = 2 * RESULT_PAGE;

/** 超过加载上限的总数（上限的两倍）：只显示匹配度最高的那一段。 */
export const OVER_LIMIT = 2 * RESULT_MAX;

/**
 * 名单只取前 `count` 个人，总数另给：模拟改了筛选、符合条件的人比名单长，
 * 或示例格子窄放不下全部卡片。
 */
export function firstOf(
	outcome: SearchOutcome,
	count: number,
	total = outcome.total,
): SearchOutcome {
	return outcome.order === "evidence"
		? { ...outcome, results: outcome.results.slice(0, count), total }
		: { ...outcome, results: outcome.results.slice(0, count), total };
}

/** 这一轮检索的结果：六个人、按匹配度排。 */
export const OUTCOME: SearchOutcome = {
	order: "evidence",
	claims: CLAIMS,
	results: RESULTS,
	facets: FACETS,
	total: RESULTS.length,
	empty: null,
};

/** 只有人的条件时的结果：没有证据行，按人排。 */
export const PEOPLE_OUTCOME: SearchOutcome = {
	order: "employee",
	claims: [],
	results: RESULTS.map((r) => ({ employee: r.employee })),
	facets: FACETS,
	total: RESULTS.length,
	empty: null,
};

/** 一个人都没有：必须的主张没人满足。 */
export const EMPTY_OUTCOME: SearchOutcome = {
	order: "evidence",
	claims: CLAIMS,
	results: [],
	facets: emptyFacets(),
	total: 0,
	empty: { kind: "unmet" },
};
