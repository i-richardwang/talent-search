import { keywordsOf, keywordTitle } from "#/search/keywords";
import { labelsInSentence } from "#/search/query";
import { queryOfSpec } from "#/search/spec";
import type { RecentSearch } from "#/server/turn";

/* 最近搜索的一条记录在导航栏、首页和全部记录的抽屉里怎么读。 */

/** 导航栏和首页的「最近搜索」各列几条。 */
export const NAV_RECENT_COUNT = 10;
export const HOME_RECENT_COUNT = 8;

/** 最近搜索一页取多少条：导航栏和首页都从第一页里切。 */
export const RECENT_PAGE_SIZE = Math.max(NAV_RECENT_COUNT, HOME_RECENT_COUNT);

/**
 * 一行记录读的是**任务标题**：对话的任务是链头那句话，回头找一次搜过的东西，
 * 靠的是记得自己当时怎么说的。关键词搜索没有那句话，框里的词就是它问的。
 */
export function recentLabel(record: Pick<RecentSearch, "spec" | "title">) {
	if (record.title) return record.title;
	const keywords =
		record.spec && "conditions" in record.spec
			? keywordsOf(record.spec.conditions)
			: null;
	if (keywords) return keywordTitle(keywords);
	// 读不回框里的条件照条件写，停用的没参与检索、不写
	return active(record) || "无搜索条件";
}

/** AI 还在处理、没处理成的任务，一行上各说什么。 */
export const RECENT_STATUS_TEXT = {
	working: "正在搜索…",
	failed: "没有完成，打开可以重试",
} as const;

/**
 * 标题下面那一行：AI 还在处理或没处理成时说这件事；否则是对话的任务最后停在了哪些搜索
 * 条件上。关键词搜索的标题就是条件，没有这一行。
 */
export function recentSummary(
	record: Pick<RecentSearch, "spec" | "status" | "title">,
): string | undefined {
	if (record.status) return RECENT_STATUS_TEXT[record.status];
	if (!record.title) return undefined;
	return active(record) || undefined;
}

function active(record: Pick<RecentSearch, "spec">) {
	if (!record.spec) return "";
	return labelsInSentence(
		queryOfSpec(record.spec).conditions.filter((c) => !c.off),
	);
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 秒数由服务端按它的时钟算好（`at` 是 `YYYY-MM-DD HH:MM`），页面和服务端首帧读同一个数。
 * 最近搜索和任务的运行记录都这样写时间。
 */
export function ago(record: { ageSeconds: number; at: string }): string {
	const s = record.ageSeconds;
	if (s < MINUTE) return "刚刚";
	if (s < HOUR) return `${Math.floor(s / MINUTE)} 分钟前`;
	if (s < DAY) return `${Math.floor(s / HOUR)} 小时前`;
	if (s < 2 * DAY) return "昨天";
	if (s < 7 * DAY) return `${Math.floor(s / DAY)} 天前`;
	const [year, month, day] = record.at.slice(0, 10).split("-").map(Number);
	return s < 365 * DAY ? `${month}月${day}日` : `${year}年${month}月`;
}
