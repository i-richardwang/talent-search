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

import {
	narrowsPopulation,
	POPULATION_KEYS,
	parsePopulation,
} from "#/search/params";
import type { SearchFilters } from "#/search/result";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";

/** 地址栏上的视图：一份筛选，加上翻到第几页。筛选那几项不在这里重写一遍。 */
export type View = SearchFilters & {
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
 * URL 是不可信输入：非法值一律当没填。维度那七项怎么收窄写在它们自己的声明里
 * （`dimensions.ts`），这里只收不属于那一族的几项——URL 与 RPC 两处因此收的是
 * 同一份，不会有一处先松下来。
 */
export function validateView(s: Record<string, unknown>): View {
	return {
		...parsePopulation(s),
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
	return FILTER_KEYS.every((k) => same(next[k], prev[k]));
}

/** 当前导航是否会改变结果表；只切换详情路由时为 false。 */
export function viewChanged(next: View, prev: View | undefined) {
	if (!prev) return true;
	if (pageLimit(next) !== pageLimit(prev)) return true;
	return FILTER_KEYS.some((key) => !same(next[key], prev[key]));
}

/**
 * 同一维的两个值算不算没变。集合维度是数组，`===` 比的是引用，而 URL 每解析
 * 一次就是一批新对象——照引用比，光是换一个人看详情都会判成「筛选变了」，名单
 * 于是塌成骨架屏一次。
 *
 * 比的就是它写进地址栏之后的样子：顺序和字段序都由 `filters.ts` 的 `toggle`
 * 与 `seqPicks` 定死，同一组选择只有一种写法。
 */
function same(a: View[keyof View], b: View[keyof View]) {
	if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 视图状态 → 检索条件。除翻页之外逐字相同：视图多出来的只有「看到第几页」，
 * 那不是检索条件。逐字段抄一遍的话，加一维就会有一处忘了跟上。
 */
export function toFilters(v: View): SearchFilters {
	const { n: _page, ...filters } = v;
	return filters;
}

/**
 * 筛选的「全部清空」。工具栏的「清除筛选」和空结果态的逃生按钮都用它，
 * 免得两处各写一份、加字段时漏掉一处。
 * `strong` 不在其中：它答的是「证据够不够硬」，和收窄人群的那几维不是一档。
 */
export const CLEARED_FILTERS = Object.fromEntries(
	POPULATION_KEYS.map((k) => [k, undefined]),
) as { [K in (typeof POPULATION_KEYS)[number]]: undefined };

/**
 * 是否有任何收窄人群的筛选生效。口径与检索侧同一份（`search/params.ts` 的
 * `POPULATION_KEYS`）：视图和检索对「什么算筛选」说的必须是同一句话。
 */
export function hasFilters(v: View) {
	return narrowsPopulation(toFilters(v));
}
