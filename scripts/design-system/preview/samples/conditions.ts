import type { Condition } from "#/search/condition";
import type { EmptyReason } from "#/search/empty";
import { conditionsOfKeywords } from "#/search/keywords";
import { type Claim, claimsOf } from "#/search/result";
import type { SearchSpec } from "#/search/spec";

/*
 * 搜索条件：一次找人任务三轮里出现过的条件，以及关键词搜索的一张条件表。
 * 人名、工号、公司、部门、学校全是编的，和人才库无关；类型都从产品代码导入。
 */

/** 做过推荐系统（必须）：链头那句话整理出的主张。 */
export const RECOMMEND: Condition = {
	about: "experience",
	mode: "must",
	what: ["推荐系统", "推荐算法"],
};

/** 在大厂累计三年以上（加分）：没写做过什么的背景主张，只把门不排名。 */
export const BIG_COMPANY: Condition = {
	about: "experience",
	mode: "boost",
	companyTag: ["大厂"],
	minMonths: 36,
};

/** 带过团队（加分）：第二轮补充的主张。 */
export const TEAM: Condition = {
	about: "experience",
	mode: "boost",
	what: ["团队管理"],
};

/** 学历硕士及以上（加分）：第二轮补充的人的条件，第三轮被移除。 */
const MASTER: Condition = {
	about: "person",
	mode: "boost",
	field: "education",
	atLeast: "硕士",
};

/** 排除实习经历：一条排除的主张，给条件相关的页面展示第三种强度。 */
export const EXCLUDE_INTERN: Condition = {
	about: "experience",
	mode: "exclude",
	what: ["实习"],
};

/** 被停用的一条：命中的人太多，理解时量出来「太宽」。 */
export const WIDE_CONDITION: Condition = {
	about: "experience",
	mode: "must",
	what: ["数据分析"],
	off: "wide",
};

/** 第一轮的条件表。 */
export const ROUND1_CONDITIONS: Condition[] = [RECOMMEND, BIG_COMPANY];

/** 第二轮的条件表：加了带团队和学历。 */
export const ROUND2_CONDITIONS: Condition[] = [
	RECOMMEND,
	BIG_COMPANY,
	TEAM,
	MASTER,
];

/** 第三轮（在条件上直接改）的条件表：移除了学历。名单展示的就是这一轮。 */
export const CONDITIONS: Condition[] = [RECOMMEND, BIG_COMPANY, TEAM];

/** 名单展示的这一轮的完整查询。 */
export const SPEC: SearchSpec = { conditions: CONDITIONS };

/** 名单上证据行按的主张：做过推荐系统、带过团队。 */
export const CLAIMS: Claim[] = claimsOf(CONDITIONS);

/** 关键词搜索的一张条件表：经历「推荐系统」、公司「某甲科技」、累计两年以上。 */
export const KEYWORD_SPEC: SearchSpec = {
	conditions: conditionsOfKeywords({
		what: ["推荐系统"],
		org: ["某甲科技"],
		school: [],
		minMonths: 24,
	}),
};

/**
 * 每种空态的成因，和一份让它出现的搜索条件。按成因穷尽：检索层多一种成因，
 * 这里少写一行就过不了类型检查。
 */
export const EMPTY_CASES: {
	[K in EmptyReason["kind"]]: [
		reason: Extract<EmptyReason, { kind: K }>,
		spec: SearchSpec,
	];
} = {
	unmet: [{ kind: "unmet" }, SPEC],
	noHits: [{ kind: "noHits" }, SPEC],
	filtered: [{ kind: "filtered" }, SPEC],
	gatesUnmet: [
		{ kind: "gatesUnmet" },
		{
			conditions: [
				{ about: "person", mode: "must", field: "school", values: ["学校 E"] },
			],
		},
	],
	overflowEvidence: [{ kind: "overflowEvidence", claims: CLAIMS }, SPEC],
	overflowPopulation: [{ kind: "overflowPopulation" }, SPEC],
	allDisabled: [{ kind: "allDisabled" }, { conditions: [WIDE_CONDITION] }],
	excludeOnly: [{ kind: "excludeOnly" }, { conditions: [EXCLUDE_INTERN] }],
	noConditions: [{ kind: "noConditions" }, { conditions: [] }],
};
