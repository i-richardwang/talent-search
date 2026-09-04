import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeFilters, sanitizeLimit } from "#/search/params";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";

describe("检索端点参数", () => {
	test("筛选只接受约定形状，并在边界清理文本", () => {
		const filters = sanitizeFilters({
			seq: [{ l1: " 技术 ", l2: " 后端 " }],
			level: [" P6 ", "P7", "P6", "  "],
			minMonths: "24",
			kind: "external",
			strong: true,
			org: "  字节  ",
		});
		assert.deepEqual(filters.seq, [{ l1: "技术", l2: "后端" }]);
		// 去重、丢掉空的：同一个值来两遍会让「或」多比一次，空值会让它恒真
		assert.deepEqual(filters.level, ["P6", "P7"]);
		assert.equal(filters.minMonths, 24);
		assert.equal(filters.kind, "external");
		assert.equal(filters.strong, true);
		assert.equal(filters.org, "字节");
	});

	test("筛选文本在 URL 与 RPC 边界都有硬上限", () => {
		assert.equal(sanitizeFilters({ org: "甲".repeat(300) }).org?.length, 200);
	});

	test("无效筛选不会变成静默滤空的条件", () => {
		const filters = sanitizeFilters({
			seq: [{ l1: "技术" }, "技术/后端"],
			level: ["  ", ""],
			minMonths: "半个月",
			kind: "contractor",
			strong: false,
			school: "  ",
		});
		// 序列必须两级都在：只给一级等于「这个一级下的全部二级」，那不是任何一个
		// 选项点得出来的东西
		assert.equal(filters.seq, undefined);
		// 一项都不剩就是不筛，不是筛一个空集合
		assert.equal(filters.level, undefined);
		assert.equal(filters.minMonths, undefined);
		assert.equal(filters.kind, undefined);
		assert.equal(filters.strong, undefined);
		assert.equal(filters.school, undefined);
	});

	test("页大小有稳定默认值与硬上限", () => {
		for (const value of [
			"",
			"bad",
			"0",
			"-50",
			0,
			-1,
			12.5,
			null,
			undefined,
			{},
		])
			assert.equal(sanitizeLimit(value), RESULT_PAGE);
		assert.equal(sanitizeLimit(RESULT_MAX + 1), RESULT_MAX);
		assert.equal(sanitizeLimit(999_999), RESULT_MAX);
		assert.equal(sanitizeLimit("100"), 100);
	});
});
