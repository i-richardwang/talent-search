/** 导出文件读回验证：文本类型、列顺序、证据与名次。全部使用合成数据。 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import readExcelFile from "read-excel-file/node";
import { evidenceText } from "#/routes/s/$turnId/-components/evidence";
import { exportName, exportWorkbook } from "#/routes/s/$turnId/-lib/export";
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
	evidence: ["序列 技术 · 算法 · 公司内 2.3 年", null],
	...over,
});

const basis = (over: Partial<ClaimBasis> = {}): ClaimBasis => ({
	route: "role",
	value: "算法",
	relevance: 0.83,
	months: 27,
	endDate: null,
	external: false,
	...over,
});

async function read(picks: Pick[], names: string[], evidence: boolean) {
	const file = await exportWorkbook(picks, names, evidence);
	const sheets = await readExcelFile(Buffer.from(await file.arrayBuffer()));
	return sheets[0]?.data ?? [];
}

describe("导出的工作簿", () => {
	test("固定六列，条件一条一列，空证据为空格", async () => {
		const rows = await read([pick()], ["算法", "推荐"], true);
		assert.deepEqual(rows[0], [
			"序号",
			"工号",
			"姓名",
			"部门",
			"岗位",
			"职级",
			"算法",
			"推荐",
		]);
		assert.deepEqual(rows[1], [
			1,
			"T0001",
			"林岚",
			"算法平台",
			"算法工程师",
			"P6",
			"序列 技术 · 算法 · 公司内 2.3 年",
			null,
		]);
	});
	test("序号为数字，所有原文按文本保存，不解释公式、不改写工号", async () => {
		const name = '=HYPERLINK("https://example.invalid","合成")';
		const text = '他说 "带过, 一个团队"\n然后走了';
		const rows = await read(
			[
				pick({
					rank: 7,
					empId: "0000123",
					name,
					dept: "+123",
					title: "-123",
					level: "@text",
					evidence: [text],
				}),
			],
			["=1+1"],
			true,
		);
		assert.deepEqual(rows[1], [
			7,
			"0000123",
			name,
			"+123",
			"-123",
			"@text",
			text,
		]);
		assert.equal(rows[0]?.[6], "=1+1");
	});
	test("不要证据时只导出固定列", async () => {
		const rows = await read([pick()], ["算法"], false);
		assert.equal(rows[0]?.length, 6);
		assert.equal(rows[1]?.length, 6);
	});
	test("文件名带日期", () => {
		assert.equal(exportName(new Date(2026, 8, 10)), "人才搜索-2026-09-10.xlsx");
	});
});

describe("单元格里的证据", () => {
	test("和屏幕上那一行说的是同一件事", () => {
		const text = evidenceText("算法", hit({ route: "title" }), basis());
		assert.equal(text, "岗位 算法工程师 · 云梯物流 · 公司内 2.3 年");
	});

	test("命中的不是代表词时把词写出来", () => {
		const text = evidenceText("算法", hit({ value: "推荐算法" }), basis());
		assert.match(text, /^匹配依据 推荐算法 · /);
	});

	test("入职前的累计带「前」", () => {
		const text = evidenceText(
			"算法",
			hit(),
			basis({ external: true, endDate: "2021-06-30" }),
		);
		assert.match(text, /入职前 2\.3 年$/);
	});
});
