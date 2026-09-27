/**
 * 导航栏记住的样子怎么从 cookie 里读回来，和最近搜索那一行右边的「多久以前」。
 * 纯规则，不启动数据库。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { NAV_WIDTH } from "#/components/ui/app-layout";
import { navPrefsOf } from "#/routes/-lib/nav-prefs";
import { ago } from "#/routes/-lib/recent";

describe("导航栏记住的样子", () => {
	test("没记过是默认值：展开、默认宽、组都开着、最近搜索列五条", () => {
		assert.deepEqual(navPrefsOf(undefined), {
			collapsed: false,
			folded: [],
			recentCount: 5,
			width: NAV_WIDTH.default,
		});
	});

	test("记过的原样读回，宽夹在拖动的范围里，读不懂的条数回到默认", () => {
		assert.deepEqual(navPrefsOf("c=1&g=recent,admin&n=15&w=320"), {
			collapsed: true,
			folded: ["recent", "admin"],
			recentCount: 15,
			width: 320,
		});
		assert.equal(navPrefsOf("w=9999").width, NAV_WIDTH.max);
		assert.equal(navPrefsOf("w=abc").width, NAV_WIDTH.default);
		assert.equal(navPrefsOf("n=7").recentCount, 5);
	});
});

describe("多久以前", () => {
	const at = "2026-08-13 10:00";
	test("一小时内按分钟，一天内按小时，一周内按天", () => {
		assert.equal(ago({ ageSeconds: 30, at }), "刚刚");
		assert.equal(ago({ ageSeconds: 5 * 60, at }), "5 分钟前");
		assert.equal(ago({ ageSeconds: 3 * 3600, at }), "3 小时前");
		assert.equal(ago({ ageSeconds: 30 * 3600, at }), "昨天");
		assert.equal(ago({ ageSeconds: 3 * 86400, at }), "3 天前");
	});

	test("再早写日期，一年以前带上年份", () => {
		assert.equal(ago({ ageSeconds: 20 * 86400, at }), "8月13日");
		assert.equal(ago({ ageSeconds: 400 * 86400, at }), "2026年8月");
	});
});
