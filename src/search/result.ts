/**
 * 一次检索的结果长什么样——服务端与页面之间的契约。
 *
 * 单独成文件是为了给页面一处能安全取值的地方：`search.ts` 带 `db`，标了
 * `server-only`，页面从它取一个值会让构建失败。所以这里只放**形状**和无副作用
 * 的空值工厂，一行 SQL 都不许有；查询实现留在 `search.ts`。
 */
import type { Employee } from "#/db/schema";
import type { ChipMode } from "./parse";
import type { Route } from "./weights";

export type Hit = {
	experienceId: number;
	term: string;
	route: Route;
	kind: "internal" | "external";
	startDate: string;
	endDate: string | null;
	org: string;
	title: string;
	seq: string;
	months: number;
};

/**
 * 结果里带的人：只有表格那一行画得出来的字段。
 *
 * 整行 select 会把 employee 的每一列都序列化进 SSR 载荷，而翻页会把这一份载荷
 * 成倍放大（见 weights.ts 的 RESULT_MAX）。这里显式列出表格所需字段；详情栏的
 * 完整档案由 fetchEmployee 单独取，两条路径各自只传自己的读者需要的数据。
 */
type ResultEmployee = Pick<
	Employee,
	"empId" | "name" | "curDept" | "curTitle" | "curLevel"
>;

export type SearchResult = {
	employee: ResultEmployee;
	score: number;
	basis: (TermBasis | null)[];
	hits: Hit[];
};

/** 一个概念词实际参与排名的聚合依据。 */
export type TermBasis = {
	term: string;
	/** 实际参与累计的并列最强路径；序列与岗位可能同时出现 */
	routes: Route[];
	/** 最强命中路径上所有经历段的累计月数 */
	months: number;
	/** 最强命中路径最近一次结束时间；null 表示目前仍有相关经历 */
	endDate: string | null;
	/**
	 * 累计进 `months` 的段是否**全部**来自入职前。
	 *
	 * 表格那一格显示的是累计值，而累计可能横跨在职与入职前（同一路在两种 kind
	 * 上都命中得了）。所以「前」这个前缀不能由某一段的 kind 决定——那会给一个
	 * 跨了两边的数加上只描述其中一半的标签。判定属于累计发生的地方（rank.ts），
	 * 不属于显示层。
	 */
	external: boolean;
};

/**
 * 一个参与匹配的概念词：原词、整词搜不到时实际用来检索的形态（见 search.ts 的
 * relaxTerm），以及它是必须还是加分。
 *
 * 排除词不在这里——它只用来把人剔掉，不占表格的一列，也没有「命中了多久」可言。
 * 所以这个类型的 mode 排除了 `"exclude"`：把一个画不出来的东西放进画得出来的
 * 列表里，早晚会有人去渲染它。
 */
export type TermPlan = {
	term: string;
	effective: string;
	mode: Exclude<ChipMode, "exclude">;
};

export type SearchFilters = {
	seqL1?: string;
	seqL2?: string;
	/** 入职前公司档：头部互联网T1 / 知名公司 … */
	companyTag?: string;
	/** 命中段至少多少个月 */
	minMonths?: number;
	/** 只看在职经历或只看入职前 */
	kind?: "internal" | "external";
	/**
	 * 每个概念词都要有受控字段（序列或岗位）的命中。
	 *
	 * 和其余四维一样在服务端对完整候选事实求值：放到客户端就只能筛已经翻出来的那几页，
	 * 而左栏其余四维数的是全部命中的人——同一列控件会出现两种口径。
	 */
	strong?: boolean;
};

/**
 * 筛选面板的候选与计数。
 *
 * 计数的口径是**在当前这次检索里，选了这一项之后还剩多少人**，不是全库有多少段。
 * 全库口径会在回答一个没人问的问题：搜「项目管理」命中 50 人，左栏写着
 * 「技术 · 工程 3009」，还暗示点它能得到 3009 人。
 *
 * 算不出人的选项根本不会出现在这里——这是左栏能变短的原因：序列全库有几十个，
 * 落到一次具体检索上通常只剩几个。每一维要怎么算才配得上这个口径，
 * 见 rank.ts 的 computeFacets。
 */
export type Facets = {
	seq: { seqL1: string; seqL2: string; n: number }[];
	companyTag: { value: string; n: number }[];
	kind: { value: "internal" | "external"; n: number }[];
	minMonths: { value: number; n: number }[];
	/**
	 * 「证据要求」这一维的两头：打开还剩多少人（on），关掉能看到多少人（off）。
	 * 两个数都按分面的 except 口径算，也就是都把证据要求自己摘掉之后再数。
	 */
	strong: { on: number; off: number };
};

/**
 * 零态要用的语料概览：库有多大，以及**这个库认识哪些词**。
 *
 * 第二样才是重点。第一次进来的人卡在「我该输入什么」上，而这不是文案能解决的
 * 问题——他缺的是这套语料的词汇表。二级序列正好是它：受控字段、人人都有、
 * 而且拿它当概念词一定命中（`seq` 是权重最高的那一路）。
 *
 * **刻意不带人数。** 「算法 128」里的 128 是「有过算法序列经历的人数」，
 * 而点下去得到的是一次检索，它还会从岗位、部门、简历原文命中另一批人，
 * 两个数必然对不上。全站计数只有「人」这一个单位、且必须口径一致
 * （见 AGENTS），与其给一个点进去就自相矛盾的数，不如不给。
 * 规模只说一次，说在顶上——那句话没有任何东西能和它对不上。
 */
export type Overview = {
	people: number;
	segments: number;
	/** 最常见的二级序列，按人数降序。只留能原样当概念词用的那些。 */
	seqs: string[];
};

/**
 * 一次检索的完整产出。
 *
 * `tooWide` 和「没有人符合」并列，是一种**结果**而不是一次失败：命中的经历段
 * 超过了 `FACT_MAX`，词已经解析出来了（中栏照常排列），只是不给结果，
 * 请用户再加一个条件。它走空态那套引导，不走错误边界。
 */
export type SearchOutcome = {
	terms: TermPlan[];
	results: SearchResult[];
	facets: Facets;
	/** 命中的总人数，截断之前。results 最多只有 limit 个。 */
	total: number;
	tooWide: boolean;
};

/** 空分面。检索还没跑或没解析出概念词时用它，界面才不必区分「没有」和「还没算」。 */
export function emptyFacets(): Facets {
	return {
		seq: [],
		companyTag: [],
		kind: [],
		minMonths: [],
		strong: { on: 0, off: 0 },
	};
}
