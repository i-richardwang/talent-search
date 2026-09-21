import {
	FILTER_KEYS,
	type SearchFilters,
	sanitizeFilters,
} from "#/search/params";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";

export type View = SearchFilters & {
	/** 已加载人数；一页时省略。 */
	n?: number;
};

export function validateView(s: Record<string, unknown>): View {
	return { ...sanitizeFilters(s), n: pageSize(s.n) };
}

function pageSize(v: unknown) {
	const n = Number(v);
	if (!Number.isInteger(n) || n % RESULT_PAGE !== 0) return undefined;
	const capped = Math.min(n, RESULT_MAX);
	return capped > RESULT_PAGE ? capped : undefined;
}

export function pageLimit(v: View) {
	return v.n ?? RESULT_PAGE;
}

export function reachOf(total: number) {
	return Math.min(total, RESULT_MAX);
}

export function canLoadMore(v: View, total: number) {
	return pageLimit(v) < reachOf(total);
}

export function morePage(v: View): Partial<View> {
	return { n: Math.min(pageLimit(v) + RESULT_PAGE, RESULT_MAX) };
}

export function allPages(total: number): Partial<View> {
	return { n: Math.ceil(reachOf(total) / RESULT_PAGE) * RESULT_PAGE };
}

/** 仅扩展页大小时保留现有列表。 */
export function onlyMore(next: View, prev: View | undefined) {
	if (!prev) return false;
	if (pageLimit(next) <= pageLimit(prev)) return false;
	return FILTER_KEYS.every((k) => same(next[k], prev[k]));
}

export function viewChanged(next: View, prev: View | undefined) {
	if (!prev) return true;
	if (pageLimit(next) !== pageLimit(prev)) return true;
	return FILTER_KEYS.some((key) => !same(next[key], prev[key]));
}

function same(a: View[keyof View], b: View[keyof View]) {
	if (!Array.isArray(a) || !Array.isArray(b)) return a === b;
	return JSON.stringify(a) === JSON.stringify(b);
}

export function toFilters(v: View): SearchFilters {
	const { n: _page, ...filters } = v;
	return filters;
}

export const CLEARED_FILTERS = Object.fromEntries(
	FILTER_KEYS.map((key) => [key, undefined]),
) as { [K in (typeof FILTER_KEYS)[number]]: undefined };
