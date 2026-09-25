import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ModeNav } from "#/routes/-components/mode-nav";
import { routed } from "./routed";

/** 首页那条路由的地址参数口径（`routes/index.tsx`），别的都不要。 */
async function current(url: string) {
	const html = await routed(ModeNav, {
		url,
		validateSearch: (search): { mode?: "keyword" } =>
			search.mode === "keyword" ? { mode: "keyword" } : {},
	});
	return [...html.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]*)</g)].map(
		(m) => m[1],
	);
}

describe("两种搜索的切换", () => {
	test("每个首页地址上正好一个是当前", async () => {
		// Link 激活时自己写 aria-current；地址参数默认按局部匹配，不带参数的
		// 「对话」会在关键词的地址上也算当前，两个一起亮
		assert.deepEqual(await current("/"), ["AI 搜索"]);
		assert.deepEqual(await current("/?mode=keyword"), ["关键词搜索"]);
	});
});
