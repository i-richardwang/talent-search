/**
 * 一次检索的结果长什么样——服务端与页面之间的契约。
 *
 * 单独成文件是为了给页面一处能安全取值的地方：`search.ts` 带 `db`，标了
 * `server-only`，页面从它取一个值会让构建失败。所以这里只放**形状**和无副作用
 * 的空值工厂，一行 SQL 都不许有；查询实现留在 `search.ts`。
 */
import type { Employee, Route } from "#/db/schema";
import { DIM_KEYS, type DimKey, type Facet } from "./dimensions";
import type { EmptyReason } from "./empty";
import type { ChipMode } from "./parse";
import type { SearchScope } from "./spec";

export type { SeqPick } from "./dimensions";

export type Hit = {
	experienceId: number;
	term: string;
	/**
	 * 实际命中的那个说法（主词或某个并列说法）。证据行拿它当行标签：
	 * 用户写「大模型/多模态」，一行证据得说清楚是哪一个说法把这段找出来的。
	 */
	member: string;
	route: Route;
	/** 该说法与这一段这一路原文的相关度，[RELEVANCE_MIN, 1]。 */
	relevance: number;
	kind: "internal" | "external";
	startDate: string;
	endDate: string | null;
	org: string;
	title: string;
	seq: string;
	months: number;
};

/**
 * 结果里带的人：只有结果列表那一块画得出来的字段。
 *
 * 整行 select 会把 employee 的每一列都序列化进 SSR 载荷，而翻页会把这一份载荷
 * 成倍放大（见 weights.ts 的 RESULT_MAX）。这里显式列出列表所需字段；详情面板的
 * 完整档案由 fetchEmployee 单独取，两条路径各自只传自己的读者需要的数据。
 */
type ResultEmployee = Pick<
	Employee,
	"empId" | "name" | "curDept" | "curTitle" | "curLevel"
>;

type PopulationResult = {
	employee: ResultEmployee;
};

export type RankedResult = PopulationResult & {
	score: number;
	basis: (TermBasis | null)[];
	hits: Hit[];
};

export type SearchResult = PopulationResult | RankedResult;

/** 一条要求实际参与排名的聚合依据。 */
export type TermBasis = {
	term: string;
	/** 参与累计的那一路：最硬那条证据走的路 */
	route: Route;
	/** 最硬那条证据的相关度 */
	relevance: number;
	/** 并列最硬的证据段的累计月数 */
	months: number;
	/** 并列最硬的证据段里最近一次结束时间；null 表示目前仍有相关经历 */
	endDate: string | null;
	/**
	 * 累计进 `months` 的段是否**全部**来自入职前。
	 *
	 * 证据行那一端显示的是累计值，而累计可能横跨在职与入职前。所以「前」这个
	 * 前缀不能由某一段的 kind 决定——那会给一个跨了两边的数加上只描述其中一半的
	 * 标签。判定属于累计发生的地方（rank.ts），不属于显示层。
	 */
	external: boolean;
};

/**
 * 一条参与匹配的要求：标签（用户的主词）、它的全部说法（OR，都是原文、都会
 * 被嵌成向量），以及它是必须还是加分。
 *
 * 排除词不在这里——它只用来否决证据段，不占证据行的一行，也没有「命中了多久」
 * 可言。所以这个类型的 mode 排除了 `"exclude"`：把一个画不出来的东西放进
 * 画得出来的列表里，早晚会有人去渲染它。
 */
export type TermPlan = {
	term: string;
	members: string[];
	mode: Exclude<ChipMode, "exclude">;
};

/**
 * 一次检索的筛选条件：查询范围那一批条件（`SearchScope`），加上证据强度。
 *
 * 收窄人群的那几项在这里不重写一遍——范围和筛选是同一批维度的两种生命周期，
 * 各写一份形状的话，加一维就会有一处忘了跟上。`strong` 不属于那一批：它答的是
 * 「什么才算命中」，不是在这批人里再看哪一部分。
 *
 * **全部在服务端求值**：放到客户端就只能筛已经翻出来的那几页，而其余维数的是
 * 全部命中的人——同一排控件会出现两种口径。
 */
export type SearchFilters = SearchScope & {
	/** 每个必须词都要有受控字段（序列或岗位）的命中。 */
	strong?: boolean;
};

/**
 * 筛选面板的候选与计数。
 *
 * 计数的口径是**在当前这次检索里，选了这一项之后还剩多少人**，不是全库有多少段。
 * 全库口径会在回答一个没人问的问题：搜「项目管理」命中 50 人，筛选里写着
 * 「技术 · 工程 3009」，还暗示点它能得到 3009 人。
 *
 * 和这次检索无关的值不会出现在这里——这是筛选比全库短的原因：序列全库有几十个，
 * 落到一次具体检索上通常只剩几个。但**有哪些选项只由这次查询决定，不随筛选变**：
 * 被别的维度挤到 0 的那些留在列表里，`n` 就是 0。两个口径为什么必须分开，
 * 以及每一维要怎么算才配得上它们，见 rank.ts 的 facetCount。
 */
export type Facets = { [K in DimKey]: Facet<K>[] } & {
	/**
	 * 「证据要求」这一维的两头：打开还剩多少人（on），关掉能看到多少人（off）。
	 * 两个数都按分面的 except 口径算，也就是都把证据要求自己摘掉之后再数。
	 */
	strong: { on: number; off: number };
};

/**
 * 一次检索的完整产出。
 *
 * `empty` 是「这份名单为什么是空的」，有人时为 `null`。它由检索层给出而不是
 * 由界面反推（论证见 `empty.ts`）——候选事实超过 `FACT_MAX` 也是它的一种取值：
 * 那仍然是一种**结果**，不是一次失败，页面据此说该具体化语义要求还是收窄范围，
 * 而不是把截断的数据交给排名。
 */
type Outcome = {
	facets: Facets;
	total: number;
	empty: EmptyReason | null;
};

export type SearchOutcome =
	| (Outcome & {
			order: "relevance";
			terms: TermPlan[];
			results: RankedResult[];
	  })
	| (Outcome & {
			order: "employee";
			terms: [];
			results: PopulationResult[];
	  });

/** 空分面。检索还没跑或没解析出要求时用它，界面才不必区分「没有」和「还没算」。 */
export function emptyFacets(): Facets {
	// 每一维一个空列表。逐维手写的话，加一维忘了这里不会报错，只会在
	// 「还没算」的那一帧上少一栏。
	const facets = {} as Facets;
	for (const key of DIM_KEYS) facets[key] = [];
	facets.strong = { on: 0, off: 0 };
	return facets;
}
