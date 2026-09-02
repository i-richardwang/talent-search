import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { sanitizeFilters, sanitizeLimit } from "#/search/params";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";

describe("检索端点参数", () => {
	test("筛选只接受约定形状，并在边界清理文本", () => {
		const filters = sanitizeFilters({
			seqL1: " 技术 ",
			minMonths: "24",
			kind: "external",
			strong: true,
			org: "  字节  ",
		});
		assert.equal(filters.seqL1, "技术");
		assert.equal(filters.minMonths, 24);
		assert.equal(filters.kind, "external");
		assert.equal(filters.strong, true);
		assert.equal(filters.org, "字节");
	});

	test("无效筛选不会变成静默滤空的条件", () => {
		const filters = sanitizeFilters({
			minMonths: "半个月",
			kind: "contractor",
			strong: false,
			school: "  ",
		});
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
