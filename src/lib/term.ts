/** 一条经历词在关键词检索中可以使用的完整长度。 */
export const MAX_TERM_LEN = 24;

/** 普通能力词与新起的上级词名的字数上限。 */
export const MAX_TAG_LEN = 16;

/** 一条说法的规范写法：NFKC 折叠全半角，压掉多余空白。 */
export function tag(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.normalize("NFKC")
		.replace(/\s+/g, " ")
		.replace(/^[ ·,，;；]+|[ ·,，;；]+$/g, "");
}
