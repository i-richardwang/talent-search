/**
 * 只看得见的那部分才算数。
 *
 * Select 即使只有箭头也会保留带文案的可访问属性；例如
 * `aria-label="全部序列"` 会让普通字符串断言命中，但人眼仍然什么都看不到。
 * 所以这里刻意先把**整个标签连同属性**抹掉，
 * 只留标签之间的文本节点：属性里的可访问名、title、placeholder 一律不算数。
 *
 * 边界：这里不跑 CSS，所以 `display:none`（例如 `hidden lg:flex` 里的那一份）
 * 仍然会被算成可见。它挡得住"属性冒充可见文本"，挡不住"被 CSS 藏起来"。
 * 后者要靠真浏览器。
 */
export function visibleText(html: string): string {
	return html
		.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, " ")
		.replace(/<[^>]*>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#x27;|&#39;/g, "'")
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ")
		.trim();
}
