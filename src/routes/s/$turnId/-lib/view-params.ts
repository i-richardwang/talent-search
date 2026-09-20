/**
 * URL 上的**视图状态**：在这批人里怎么筛、翻到第几页。
 *
 * 查询本身不在这里——它是一条有 id 的记录，URL 里只出现那个 id
 * （`/s/:turnId`，见 `server/turn.ts`）。这条分界是整个地址设计的全部内容：
 *
 * - **turnId 回答「我要找什么人」**：一句原话加上对它的理解，不可变、可分享。
 *   它值得被存下来，所以它有一行数据库记录。
 * - **query string 回答「我怎么看这批人」**：筛掉一个序列、翻下一页。它一次性、
 *   随手改、粘给同事也无所谓，所以它就该住在 URL 里，不值得留存。当前员工同样
 *   是视图状态，但由 `/p/:empId` 子路由表达，不属于这份筛选参数。
 *
 * 两样东西挤进同一个参数会让「改一个筛选」和「换一个查询」在代码里长得一模
 * 一样，而在产品上它们是两件完全不同的事：一个是重新看一遍同一批候选，
 * 一个是换一个问题。
 */

import {
	FILTER_KEYS,
	type SearchFilters,
	sanitizeFilters,
} from "#/search/params";
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
 * URL 是不可信输入：非法值一律当没填。筛选那部分和 RPC 收的是**同一份**
 * （`sanitizeFilters`），所以不会有一处先松下来；这里只多收一个翻页数。
 */
export function validateView(s: Record<string, unknown>): View {
	return { ...sanitizeFilters(s), n: pageSize(s.n) };
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

/**
 * 这次查询能显示的人有几个：符合条件的人里，名单按相关度只显示前 `RESULT_MAX` 位。
 *
 * 只此一处算这个数。界面上说「共多少人」的地方、「选择全部」和「还能不能再翻」
 * 问的都是它——显示范围外的人一旦漏进其中一句话，那句话就是句到不了的承诺。
 */
export function reachOf(total: number) {
	return Math.min(total, RESULT_MAX);
}

/** 还能不能再翻：能显示的都在屏幕上了就不能了，界面得改说法而不是继续给按钮 */
export function canLoadMore(v: View, total: number) {
	return pageLimit(v) < reachOf(total);
}

/** 「再看一页」之后的 URL 状态 */
export function morePage(v: View): Partial<View> {
	return { n: Math.min(pageLimit(v) + RESULT_PAGE, RESULT_MAX) };
}

/**
 * 「能显示的人全都加载出来」之后的 URL 状态：一跳到底，不一页一页加。
 *
 * 导出时「选择全部」走它。一页页加的话，名单要重查好几趟才凑齐，而这一步的
 * 语义本来就是「这批人我全要」，中间那几趟没有人在看。
 */
export function allPages(total: number): Partial<View> {
	return { n: Math.ceil(reachOf(total) / RESULT_PAGE) * RESULT_PAGE };
}

/**
 * 这一次导航是不是「只是再看一页」。
 *
 * 用来把两种 pending 分开：改筛选要清空列表换骨架屏（旧结果已经不成立了），
 * 而翻页必须把已经看到的人留在原地——列表在按下按钮的一瞬间换成骨架，
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
 * 于是换成骨架屏一次。
 *
 * 比的就是它写进地址栏之后的样子：顺序和字段序都由 `filters.ts` 的 `toggle`
 * 与 `write` 定死（写回一律取候选自己的顺序），同一组选择只有一种写法。
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
 */
export const CLEARED_FILTERS = Object.fromEntries(
	FILTER_KEYS.map((key) => [key, undefined]),
) as { [K in (typeof FILTER_KEYS)[number]]: undefined };
