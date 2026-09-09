/**
 * 不可信文本的边界。查询里的词、公司名、URL 上的筛选值走的是同一条：
 * 它们的不可信程度是一样的。
 */

/**
 * 不可信文本的长度上限。超过这个长度的不是一个词、一个公司名，
 * 是一段被误当成它们的正文。
 */
export const TEXT_MAX = 200;

/** 不可信入参 → 一段收进边界的短文本。只去两头空白、限长度，不改写字面。 */
export function boundedText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().slice(0, TEXT_MAX);
	return normalized || undefined;
}
