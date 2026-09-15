/**
 * 公开 CSV 适配器只解析格式，不替数据源编造契约字段。
 *
 * 测的是 `extract()` 这一整条路：CSV 表达不了的东西（BOM、可省的列、布尔字面量）
 * 由适配器补齐，列齐不齐由契约报错。适配器不判列。
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import { extract } from "#/corpus/sources/csv-dir";

const EMPLOYEES =
	"emp_id,name,hire_date,education_level,school,recruitment\n" +
	"E1,某人,2020-01-01,本科,示例大学,校招\n";
const ASSIGNMENTS =
	"emp_id,start_date,end_date,org,org_path,title,level,seq_l1,seq_l2,seq_l3\n" +
	"E1,2024-01-01,,平台技术部,示例科技/平台技术部,算法工程师,P6,技术,算法,\n";
const EXTERNAL =
	"emp_id,start_date,end_date,org,title,description," +
	"company_tag,industry,nature,unemployed\n" +
	"E1,2018-01-01,2019-12-31,云枢智能,算法工程师,做召回,,,,\n";

const directories: string[] = [];
after(() => {
	for (const directory of directories) rmSync(directory, { recursive: true });
});

/** 建一个临时目录，把 TALENT_CSV_DIR 指过去，读一次。 */
function read(files: Partial<Record<string, string>> = {}) {
	const directory = mkdtempSync(join(tmpdir(), "talent-csv-"));
	directories.push(directory);
	const contents = {
		"employees.csv": EMPLOYEES,
		"assignments.csv": ASSIGNMENTS,
		"external.csv": EXTERNAL,
		...files,
	};
	for (const [name, text] of Object.entries(contents))
		writeFileSync(join(directory, name), text as string);
	process.env.TALENT_CSV_DIR = directory;
	return extract(() => {});
}

describe("CSV 数据源", () => {
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

	test("给了 segment_key 就用给的，空着的才落回默认", async () => {
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
			["JOB-7", "推荐工程部|算法工程师"],
		);
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
	});
});
