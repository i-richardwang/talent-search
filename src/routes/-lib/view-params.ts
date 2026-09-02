/**
 * URL 上的**视图状态**：在这批人里怎么筛、翻到第几页。
 *
 * 查询本身不在这里——它是一条有 id 的记录，URL 里只出现那个 id
 * （`/s/:turnId`，见 `server/turn.ts`）。这条分界是整个地址设计的全部内容：
 *
 * - **turnId 回答「我要找什么人」**：一句原话加上对它的理解，不可变、可分享、
 *   可重新理解。它值得被存下来，所以它有一行数据库记录。
 * - **query string 回答「我怎么看这批人」**：筛掉一个序列、翻下一页。它一次性、
 *   随手改、粘给同事也无所谓，所以它就该住在 URL 里，不值得留存。当前员工同样
 *   是视图状态，但由 `/p/:empId` 子路由表达，不属于这份筛选参数。
 *
 * 两样东西挤进同一个参数会让「改一个筛选」和「换一个查询」在代码里长得一模
 * 一样，而在产品上它们是两件完全不同的事：一个是重新看一遍同一批候选，
 * 一个是换一个问题。
 */

import { filterText } from "#/search/params";
import type { SearchFilters } from "#/search/result";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";

export type View = {
	/** 序列筛选编码成 "一级/二级"：二级序列名跨一级会重名（技术/数据科学 与 商业分析/数据科学） */
	seq?: string;
	companyTag?: string;
	minMonths?: number;
	kind?: "internal" | "external";
	level?: string;
	recruitment?: string;
	education?: string;
	/** 待过的公司或部门名里含这几个字。精确条件，没有分面。 */
	org?: string;
	/** 学校名里含这几个字。精确条件，没有分面。 */
	school?: string;
	/** 只看每个词都命中受控字段的人。和其余维一样是服务端筛选。 */
	strong?: boolean;
	/**
	 * 已经翻出来多少人。默认（缺省）就是一页。
	 *
	 * 翻页也住在 URL 里，和其余视图状态一个待遇：后退键退回上一页而不是退出
	 * 整个查询，刷新也不回到第一页。代价是每次翻页重跑一次排序，
	 * 理由见 search() 的 limit 参数。
	 */
	n?: number;
};

/**
 * URL 是不可信输入：逐个字段收窄，非法值一律当没填。
 *
 * `minMonths` 收得最紧，因为它是唯一参与数值比较的筛选：负数会让筛选
 * 变成恒真（`months >= -999`），小数会让筛选项渲染出「1 年 0.5 个月」这种
 * 档位——两者都不会报错，只会安静地给出说不通的结果。
 */
export function validateView(s: Record<string, unknown>): View {
	const months = Number(s.minMonths);
	return {
		seq: filterText(s.seq),
		companyTag: filterText(s.companyTag),
		minMonths: Number.isInteger(months) && months > 0 ? months : undefined,
		kind: s.kind === "internal" || s.kind === "external" ? s.kind : undefined,
		level: filterText(s.level),
		recruitment: filterText(s.recruitment),
		education: filterText(s.education),
		org: filterText(s.org),
		school: filterText(s.school),
		strong: s.strong === true || s.strong === "true" ? true : undefined,
		n: pageSize(s.n),
	};
}

/**
 * 翻到第几页，收成一个合法的行数。
 *
 * 只认整页的倍数（50 / 100 / 150…）：允许任意数会让「加载更多」按下去之后
 * 页大小和 URL 里的数对不上，而且 `n=51` 这种链接会让同一次查询产生一份
 * 和任何按钮都到不了的结果。等于一页时返回 undefined——默认值不该写进 URL，
 * 否则第一屏的链接和刚搜出来的链接是两个不同的字符串。
 */
function pageSize(v: unknown) {
	const n = Number(v);
	if (!Number.isInteger(n) || n % RESULT_PAGE !== 0) return undefined;
	const capped = Math.min(n, RESULT_MAX);
	return capped > RESULT_PAGE ? capped : undefined;
}

/** 这一次导航要拉多少人 */
export function pageLimit(v: View) {
	return v.n ?? RESULT_PAGE;
}

/** 还能不能再翻：撞到上限就不能了，界面得改说法而不是继续给按钮 */
export function canLoadMore(v: View, total: number) {
	const shown = pageLimit(v);
	return shown < total && shown < RESULT_MAX;
}

/** 「再看一页」之后的 URL 状态 */
export function morePage(v: View): Partial<View> {
	return { n: Math.min(pageLimit(v) + RESULT_PAGE, RESULT_MAX) };
}

/** 收窄人群的筛选维度。`CLEARED_FILTERS` 与 `hasFilters` 都从它派生，加一维只改这里。 */
const POPULATION_KEYS = [
	"seq",
	"companyTag",
	"minMonths",
	"kind",
	"level",
	"recruitment",
	"education",
	"org",
	"school",
] as const;

/** 除翻页之外的全部视图状态。 */
const FILTER_KEYS = [...POPULATION_KEYS, "strong"] as const;

/**
 * 这一次导航是不是「只是再看一页」。
 *
 * 用来把两种 pending 分开：改筛选要清空列表换骨架屏（旧结果已经不成立了），
 * 而翻页必须把已经看到的人留在原地——列表在按下按钮的一瞬间塌成骨架，
 * 等于每翻一页就把人扔回页首，滚动位置和刚才看到哪儿全丢。
 */
export function onlyMore(next: View, prev: View | undefined) {
	if (!prev) return false;
	if (pageLimit(next) <= pageLimit(prev)) return false;
	return FILTER_KEYS.every((k) => next[k] === prev[k]);
}

/** 当前导航是否会改变结果表；只切换详情路由时为 false。 */
export function viewChanged(next: View, prev: View | undefined) {
	if (!prev) return true;
	if (pageLimit(next) !== pageLimit(prev)) return true;
	return FILTER_KEYS.some((key) => next[key] !== prev[key]);
}

/**
 * 视图状态 → 检索条件。序列在 URL 里是 "一级/二级" 一个值，检索条件里是两列，
 * 拆分只发生在这里。
 */
export function toFilters(v: View): SearchFilters {
	const [seqL1, seqL2] = v.seq?.split("/") ?? [];
	return {
		seqL1,
		seqL2,
		companyTag: v.companyTag,
		minMonths: v.minMonths,
		kind: v.kind,
		level: v.level,
		recruitment: v.recruitment,
		education: v.education,
		org: v.org,
		school: v.school,
		strong: v.strong,
	};
}

/**
 * 筛选的「全部清空」。工具栏的「清除筛选」和空结果态的逃生按钮都用它，
 * 免得两处各写一份、加字段时漏掉一处。
 * `strong` 不在其中：它答的是「证据够不够硬」，和收窄人群的那几维不是一档。
 */
export const CLEARED_FILTERS = Object.fromEntries(
	POPULATION_KEYS.map((k) => [k, undefined]),
) as { [K in (typeof POPULATION_KEYS)[number]]: undefined };

/** 是否有任何收窄人群的筛选生效 */
export function hasFilters(v: View) {
	return POPULATION_KEYS.some((k) => v[k] !== undefined);
}
