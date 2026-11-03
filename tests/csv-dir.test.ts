/**
 * 公开 CSV 适配器只解析格式，不替数据源编造契约字段。
 *
 * 测的是 `extract()` 这一整条路：CSV 表达不了的东西（BOM、可省的列、布尔字面量）
 * 由适配器转换，重复表头由适配器拒绝，必需列由契约核验。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { build } from "#/corpus/pipeline";
import { extract } from "#/corpus/sources/csv-dir";

const EMPLOYEES =
	"emp_id,name,hire_date,education_level,school,school_tier,overseas_educated,recruitment\n" +
	"E1,某人,2020-01-01,本科,示例大学,211,,校招\n";
const ASSIGNMENTS =
	"emp_id,start_date,end_date,department,department_path,title,level,seq_l1,seq_l2,seq_l3\n" +
	"E1,2024-01-01,,平台技术部,示例科技/平台技术部,算法工程师,P6,技术,算法,\n";
const EXTERNAL =
	"emp_id,start_date,end_date,company,title,description," +
	"company_tag,industry,nature,unemployed\n" +
	"E1,2018-01-01,2019-12-31,云枢智能,算法工程师,做召回,,,,\n";
const LEVELS = "level,band,rank\nP6,中级,6\n";

const directories: string[] = [];
after(() => {
	for (const directory of directories) rmSync(directory, { recursive: true });
});

function read(files: Partial<Record<string, string>> = {}) {
	const directory = mkdtempSync(join(tmpdir(), "talent-csv-"));
	directories.push(directory);
	const contents = {
		"employees.csv": EMPLOYEES,
		"assignments.csv": ASSIGNMENTS,
		"external.csv": EXTERNAL,
		"levels.csv": LEVELS,
		...files,
	};
	for (const [name, text] of Object.entries(contents))
		writeFileSync(join(directory, name), text as string);
	process.env.TALENT_CSV_DIR = directory;
	return extract(() => {});
}

describe("CSV 数据源", () => {
	test("职级表原样交给契约", async () => {
		const data = await read();
		assert.deepEqual(data.levels, [{ level: "P6", band: "中级", rank: "6" }]);
	});

	test("海外学历分是、否和没有记录，认不出的写法报错", async () => {
		const header = EMPLOYEES.split("\n")[0];
		const data = await read({
			"employees.csv":
				`${header}\n` +
				"E1,甲,2020-01-01,本科,示例大学,QS100,是,社招\n" +
				"E2,乙,2020-01-01,本科,示例大学,211,false,社招\n" +
				"E3,丙,2020-01-01,,,,,社招\n",
		});
		assert.deepEqual(
			data.employees.map((row) => row.overseas_educated),
			[true, false, null],
		);
		await assert.rejects(
			() =>
				read({
					"employees.csv": `${header}\nE1,甲,2020-01-01,本科,示例大学,211,也许,社招\n`,
				}),
			/overseas_educated/,
		);
	});

	test("必需的列不会被悄悄补上", async () => {
		await assert.rejects(
			() => read({ "employees.csv": "emp_id,name\nE1,某人\n" }),
			/hire_date/,
		);
	});

	test("BOM 不会把第一列藏起来", async () => {
		const data = await read({ "employees.csv": `﻿${EMPLOYEES}` });
		assert.deepEqual(
			data.employees.map((row) => row.emp_id),
			["E1"],
		);
	});

	test("修剪后重复的表头拒绝读取，不覆盖前一列的值", async () => {
		await assert.rejects(
			() =>
				read({
					"employees.csv": EMPLOYEES.replace("emp_id,name", "emp_id, emp_id "),
				}),
			/employees\.csv.*重复列名.*emp_id/,
		);
	});

	test("表头两侧的空白不算列名的一部分", async () => {
		const [header, ...body] = EMPLOYEES.split("\n");
		const padded = (header ?? "")
			.split(",")
			.map((column) => ` ${column} `)
			.join(",");
		const data = await read({
			"employees.csv": [padded, ...body].join("\n"),
		});
		assert.deepEqual(
			data.employees.map((row) => row.emp_id),
			["E1"],
		);
	});

	test("不给 segment_key 就按「部门 + 岗位」判同一件事", async () => {
		const data = await read();
		assert.deepEqual(
			data.assignments.map((row) => row.segment_key),
			["平台技术部|算法工程师"],
		);
	});

	test("给了 segment_key 就保留登记值，显式空值不补任职标识", async () => {
		const data = await read({
			"assignments.csv":
				`${ASSIGNMENTS.replace("seq_l3\n", "seq_l3,segment_key\n").replace(
					"技术,算法,\n",
					"技术,算法,,JOB-7\n",
				)}E1,2022-01-01,2023-12-31,推荐工程部,示例科技/推荐工程部,` +
				"算法工程师,P6,技术,算法,,\n",
		});
		assert.deepEqual(
			data.assignments.map((row) => row.segment_key),
			["JOB-7", ""],
		);
	});

	test("显式空标识的相邻同岗记录经过完整管线后仍是两段", async () => {
		const header = `${ASSIGNMENTS.split("\n")[0]},segment_key`;
		const data = await read({
			"assignments.csv":
				`${header}\n` +
				"E1,2024-01-01,2024-01-31,合成部门,合成组织/合成部门,合成岗位,P6,技术,算法,,\n" +
				"E1,2024-02-01,2024-02-29,合成部门,合成组织/合成部门,合成岗位,P6,技术,算法,, \n",
		});
		const logs: string[] = [];
		const result = build(
			data,
			(line) => logs.push(line),
			new Date("2024-03-01"),
		);
		assert.equal(
			result.experience.filter((row) => row.kind === "internal").length,
			2,
		);
		assert.match(logs.join("\n"), /缺少 segment_key 2 段/);
	});

	test("待业标记认文档里写的那几种写法", async () => {
		const header = EXTERNAL.split("\n")[0] as string;
		const rows = ["true", "Y", "是", "1", "", "no"]
			.map((written) => `E1,2018-01-01,2018-06-30,,,,,,,${written}\n`)
			.join("");
		const data = await read({ "external.csv": `${header}\n${rows}` });
		assert.deepEqual(
			data.external.map((row) => row.unemployed),
			[true, true, true, true, false, false],
		);
		await assert.rejects(
			() =>
				read({
					"external.csv": `${header}\nE1,2018-01-01,2018-06-30,,,,,,,也许\n`,
				}),
			/unemployed/,
		);
	});
});
