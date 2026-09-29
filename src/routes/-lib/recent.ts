import { activeConditions } from "#/search/condition";
import { inSentence } from "#/search/condition-label";
import { keywordsOf, keywordTitle } from "#/search/keywords";
import type { RecentSearch } from "#/server/turn";
import { RECENT_COUNTS } from "./nav-prefs";

/* 最近搜索的一条记录在导航栏、首页和全部记录的抽屉里怎么读。 */

/** 首页「最近搜索」列几条。 */
export const HOME_RECENT_COUNT = 8;

/** 根路由一次取多少条：导航栏和首页都从这一页里切。 */
export const RECENT_FIRST_PAGE = Math.max(...RECENT_COUNTS, HOME_RECENT_COUNT);

/**
 * 一行记录读的是**任务标题**：对话的任务是链头那句话，回头找一次搜过的东西，
 * 靠的是记得自己当时怎么说的。关键词搜索没有那句话，框里的词就是它问的。
 */
export function recentLabel(record: Pick<RecentSearch, "spec" | "title">) {
	if (record.title) return record.title;
	const keywords = keywordsOf(record.spec.conditions);
	if (keywords) return keywordTitle(keywords);
	// 读不回框里的条件表照条件写，停用的没参与检索、不写
	return inSentence(activeConditions(record.spec.conditions)) || "无搜索条件";
}

/**
 * 标题下面那一行：对话的任务最后停在了哪些搜索条件上。关键词搜索的标题就是条件本身，
 * 没有这一行。
 */
export function recentSummary(
	record: Pick<RecentSearch, "spec" | "title">,
): string | undefined {
	if (!record.title) return undefined;
	return inSentence(activeConditions(record.spec.conditions)) || undefined;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 多久以前：一小时内按分钟，一天内按小时，一周内按天，再早写日期，一年以前带上年份。
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
