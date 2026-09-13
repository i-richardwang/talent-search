/**
 * 一条说法最长几个字。能力词和领域都是短名词；超过这个数的通常是模型把
 * 半句话原样抄了下来，那不是标签，是另一段原文。
 */
export const MAX_TAG_LEN = 16;

/** 一条说法的规范写法：NFKC 折叠全半角，压掉多余空白。 */
export function tag(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.normalize("NFKC")
		.replace(/\s+/g, " ")
		.replace(/^[ ·,，;；]+|[ ·,，;；]+$/g, "");
}
