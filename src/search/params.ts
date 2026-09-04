import type { SearchFilters, SeqPick } from "./result";
import { RESULT_MAX, RESULT_PAGE } from "./weights";

const FILTER_TEXT_MAX = 200;

/**
 * 一维最多能同时选中几项。分面里最长的那一维（序列）也就几十项，全勾上都到不了
 * 这个数——超过它的只可能是手拼的 URL，而每多一项，取数之后的每一条事实都要多比
 * 一次。
 */
const FILTER_LIST_MAX = 64;

/** URL 与 RPC 共用的筛选文本边界，避免任意长字符串进入 ILIKE 与 SSR 载荷。 */
export function filterText(input: unknown): string | undefined {
	return typeof input === "string" && input.trim()
		? input.trim().slice(0, FILTER_TEXT_MAX)
		: undefined;
}

/**
 * 多选维度的取值。空列表收成 `undefined`——「一项都没选」和「这一维不筛」是同
 * 一件事，留一个空数组在 URL 上只会让 `hasFilters` 说谎。
 */
export function filterTextList(input: unknown): string[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const out = [
		...new Set(
			input.map(filterText).filter((v): v is string => v !== undefined),
		),
	].slice(0, FILTER_LIST_MAX);
	return out.length > 0 ? out : undefined;
}

/** 把 RPC 入参收成可信的结果视图筛选。 */
export function sanitizeFilters(value: unknown): SearchFilters {
	const filters = (value ?? {}) as Record<string, unknown>;
	const months = Number(filters.minMonths);
	return {
		seq: seqPicks(filters.seq),
		companyTag: filterTextList(filters.companyTag),
		minMonths: Number.isInteger(months) && months > 0 ? months : undefined,
		kind:
			filters.kind === "internal" || filters.kind === "external"
				? filters.kind
				: undefined,
		level: filterTextList(filters.level),
		recruitment: filterTextList(filters.recruitment),
		education: filterTextList(filters.education),
		org: filterText(filters.org),
		school: filterText(filters.school),
		strong: filters.strong === true ? true : undefined,
	};
}

/**
 * 序列这一维的取值：一对（一级，二级）。两级都得有——只给一级会让筛选变成
 * 「这个一级下的全部二级」，那不是任何一个选项点得出来的东西。
 *
 * URL（`validateView`）和 RPC 入参共用这一个：两处收的是同一个形状，各写一遍
 * 就会有一处先松下来。
 */
export function seqPicks(input: unknown): SeqPick[] | undefined {
	if (!Array.isArray(input)) return undefined;
	const out: SeqPick[] = [];
	for (const item of input.slice(0, FILTER_LIST_MAX)) {
		const pick = (item ?? {}) as Record<string, unknown>;
		const l1 = filterText(pick.l1);
		const l2 = filterText(pick.l2);
		if (l1 && l2 && !out.some((s) => s.l1 === l1 && s.l2 === l2))
			out.push({ l1, l2 });
	}
	return out.length > 0 ? out : undefined;
}

/** 把 RPC 入参收成受结果载荷上限约束的页大小。 */
export function sanitizeLimit(value: unknown): number {
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit <= 0) return RESULT_PAGE;
	return Math.min(limit, RESULT_MAX);
}
