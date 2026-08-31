/** 时间的中文写法。扫读列全靠它对齐，错一个字就得停下来算。 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { duration, grouped, period, seqLabel, years } from "#/lib/format";

describe("时长", () => {
	test("不满一年只说月", () => {
		assert.equal(duration(1), "1 个月");
		assert.equal(duration(11), "11 个月");
	});

	test("整年不带零头", () => {
		assert.equal(duration(12), "1 年");
		assert.equal(duration(36), "3 年");
	});

	test("有零头就补上月份", () => {
		assert.equal(duration(13), "1 年 1 个月");
		assert.equal(duration(27), "2 年 3 个月");
	});

	test("零个月不写成「0 年」", () => {
		assert.equal(duration(0), "0 个月");
	});
});

describe("起止", () => {
	test("截到月，日期不参与展示", () => {
		assert.equal(period("2021-03-15", "2024-10-01"), "2021-03 – 2024-10");
	});

	test("结束为空即在职", () => {
		assert.equal(period("2021-03-15", null), "2021-03 – 至今");
	});
});

/**
 * 表格证据列宽是量着 `years` 的输出定死的（6rem），所以它的形状不能变：
 * **恒定三个数位槽**。多出一个槽（「前 12.3 年」）就会溢出到隔壁格。
 */
describe("表格里的年", () => {
	test("恒定一位小数，整年也保留 .0", () => {
		assert.equal(years(36), "3.0 年");
		assert.equal(years(12), "1.0 年");
	});

	test("不满一年也说年，不改口径", () => {
		assert.equal(years(6), "0.5 年");
		assert.equal(years(0), "0.0 年");
	});

	test("四舍五入到一位，宽度恒定", () => {
		assert.equal(years(27), "2.3 年");
	});

	test("十年以上丢掉小数位：槽数恒定，不是小数位数恒定", () => {
		assert.equal(years(145), "12 年");
		assert.equal(years(400), "33 年");
		// 9.96 年：toFixed 会印成「10.0」，那是第四个槽
		assert.equal(years(120), "10 年");
		assert.equal(years(119), "9.9 年");
	});
});

describe("序列三级拼一行", () => {
	test("空的那一级不占位，也不留下多余的分隔符", () => {
		assert.equal(
			seqLabel("技术", "数据科学", "算法"),
			"技术 · 数据科学 · 算法",
		);
		assert.equal(seqLabel("技术", "数据科学", ""), "技术 · 数据科学");
		assert.equal(seqLabel("技术", "", "算法"), "技术 · 算法");
	});

	test("外部经历三级全空，拼出来是空串而不是分隔符", () => {
		assert.equal(seqLabel("", "", ""), "");
		assert.equal(seqLabel(null, null, null), "");
	});
});

describe("千分位", () => {
	test("四位起分组", () => {
		assert.equal(grouped(0), "0");
		assert.equal(grouped(999), "999");
		assert.equal(grouped(1234), "1,234");
		assert.equal(grouped(12345), "12,345");
		assert.equal(grouped(1000000), "1,000,000");
	});
});
