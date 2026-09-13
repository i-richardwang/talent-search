/**
 * 导出的那份 CSV。
 *
 * 它是这套系统唯一一件**离开屏幕之后还要被读**的产物：发出去之后没人能回来问
 * 「这一列是什么意思」。所以这里测的三件事都是「拿到文件的人会不会读错」——
 * 列在不在、格子有没有串行、名次还在不在。
 *
 * 姓名和公司名全是编的。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { evidenceText } from "#/components/evidence";
import { csvName, toCsv } from "#/routes/s/$turnId/-lib/csv";
import type { Pick } from "#/routes/s/$turnId/-lib/picks";
import type { ClaimBasis } from "#/search/result";
import { hit } from "./rows";

const pick = (over: Partial<Pick> = {}): Pick => ({
	empId: "T0001",
	name: "林岚",
	dept: "算法平台",
	title: "算法工程师",
	level: "P6",
	rank: 1,
	evidence: ["序列 技术 · 算法 · 83% · 2.3 年", null],
	...over,
});

const basis = (over: Partial<ClaimBasis> = {}): ClaimBasis => ({
	route: "seq",
	value: "算法",
	relevance: 0.83,
	months: 27,
	endDate: null,
	external: false,
	...over,
});

const lines = (text: string) => text.replace("﻿", "").trim().split("\r\n");

describe("导出的 CSV", () => {
	test("固定六列，条件一条一列，顺序和屏幕上一致", () => {
		const [head, row] = lines(toCsv([pick()], ["算法", "推荐"], true));
		assert.equal(head, "序号,工号,姓名,部门,岗位,职级,算法,推荐");
		// 没命中的条件是空格，不是「未命中」三个字：表格里一个空格就是没有，
		// 而写上字的话按这一列排序会把它排到有证据的人中间。
		assert.equal(
			row,
			"1,T0001,林岚,算法平台,算法工程师,P6,序列 技术 · 算法 · 83% · 2.3 年,",
		);
	});

	test("不要证据时条件那几列整个不在", () => {
		const [head] = lines(toCsv([pick()], ["算法"], false));
		assert.equal(head, "序号,工号,姓名,部门,岗位,职级");
	});

	test("名次写成一列", () => {
		// 屏幕上名次由位置给出，而 CSV 一按别的列排序就把位置丢了。
		const rows = lines(
			toCsv([pick({ rank: 3 }), pick({ rank: 7 })], [], false),
		);
		assert.deepEqual(
			rows.slice(1).map((r) => r.split(",")[0]),
			["3", "7"],
		);
	});

	test("逗号、引号、换行不会把一行拆成两行", () => {
		const text = toCsv(
			[pick({ evidence: ['他说 "带过, 一个团队"\n然后走了'] })],
			["算法"],
			true,
		);
		assert.match(text, /"他说 ""带过, 一个团队""\n然后走了"/);
		// 换行在被包起来的格子里，行数仍然是表头加一个人
		assert.equal(text.trim().split("\r\n").length, 2);
	});

	test("开头留 BOM，行尾用 CRLF", () => {
		const text = toCsv([pick()], [], false);
		assert.ok(text.startsWith("﻿"), "没有 BOM，Excel 打开中文是乱码");
		assert.ok(text.includes("\r\n"));
	});

	test("文件名带日期", () => {
		assert.equal(csvName(new Date(2026, 8, 10)), "人才搜索-2026-09-10.csv");
	});
});

describe("单元格里那句凭据", () => {
	test("和屏幕上那一行说的是同一件事", () => {
		const text = evidenceText("算法", hit({ route: "title" }), basis());
		assert.equal(text, "岗位 算法工程师 · 云梯物流 · 83% · 2.3 年");
	});

	test("命中的不是代表词时把词写出来", () => {
		const text = evidenceText("算法", hit({ value: "推荐算法" }), basis());
		assert.match(text, /^≈ 推荐算法 · /);
	});

	test("入职前的累计带「前」", () => {
		const text = evidenceText(
			"算法",
			hit(),
			basis({ external: true, endDate: "2021-06-30" }),
		);
		assert.match(text, /前 2\.3 年$/);
	});
});
