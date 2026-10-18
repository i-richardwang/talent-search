/**
 * 参考数据源：一个目录里的四个 CSV，列名就是 `src/corpus/contract.ts` 的契约列。
 *
 * 未配置输入目录时读取仓库自带的合成样例。
 *
 *     <TALENT_CSV_DIR>/
 *       employees.csv    emp_id,name,hire_date,education_level,school,school_tier,
 *                        overseas_educated,recruitment
 *       assignments.csv  emp_id,start_date,end_date,department,department_path,title,level,
 *                        seq_l1,seq_l2,seq_l3[,segment_key]
 *       external.csv     emp_id,start_date,end_date,company,title,description,
 *                        company_tag,industry,nature,unemployed
 *       levels.csv       level,band,rank
 *
 * 日期写 `YYYY-MM-DD`，留空表示「至今」或「未知」，具体含义见契约。
 * `education_level` 写契约里学历五档之一（`EDUCATION_LADDER`），`rank` 写整数。
 * `unemployed` 写 `true` / `1` / `Y` 表示待业段，留空即否。
 * `overseas_educated` 写 `true` / `1` / `Y` 表示海外学历，`false` / `0` / `N` 表示不是，
 * 留空表示没有记录。
 *
 * `segment_key` 这一列可以不给：不给时按「部门 + 岗位」判定相邻段是否同一件事。
 * 源系统里有更可靠的判据（组织 id、job code）时才需要自己填。
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "csv-parse/sync";
import { type RawRow, type SourceData, sourceData } from "../contract";
import type { Report } from "../report";

/**
 * 合成样例相对仓库根目录解析；部署服务通过 TALENT_CSV_DIR 指定输入目录。
 */
const SAMPLE_DIR = "src/corpus/sources/sample";

const TRUE_VALUES = new Set(["true", "1", "y", "yes", "是"]);
const FALSE_VALUES = new Set(["false", "0", "n", "no", "否"]);

/**
 * 去掉 BOM、修剪表头、补齐可省列；必需列由 sourceData 逐行核验。
 */
async function read(
	directory: string,
	name: string,
	optional: readonly string[] = [],
): Promise<RawRow[]> {
	const path = join(directory, name);
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (cause) {
		throw new Error(`源文件缺失：${path}`, { cause });
	}
	const rows: Record<string, string>[] = parse(text, {
		columns: (header: string[]) => header.map((column) => column.trim()),
		bom: true,
		skip_empty_lines: true,
	});
	return rows.map((row) => {
		const out: RawRow = { ...row };
		for (const column of optional) if (!(column in out)) out[column] = "";
		return out;
	});
}

/**
 * CSV 里没有布尔，只有字面量：认得的写法换成布尔，留空换成 `null`。缺列不补，
 * 认不出的写法原样留着，都由契约报错。
 */
function toFlag(row: RawRow, column: string): void {
	if (!Object.hasOwn(row, column)) return;
	const value = trimmed(row, column).toLowerCase();
	if (TRUE_VALUES.has(value)) row[column] = true;
	else if (FALSE_VALUES.has(value)) row[column] = false;
	else if (!value) row[column] = null;
}

function trimmed(row: RawRow, column: string): string {
	const value = row[column];
	return typeof value === "string" ? value.trim() : "";
}

export async function extract(report: Report): Promise<SourceData> {
	const configured = process.env.TALENT_CSV_DIR?.trim();
	if (!configured) report("  未配置 TALENT_CSV_DIR，读取仓库自带的合成样例");
	const directory = resolve(configured || SAMPLE_DIR);
	report(`  源目录 ${directory}`);

	const [employees, assignments, external, levels] = await Promise.all([
		read(directory, "employees.csv"),
		read(directory, "assignments.csv", ["segment_key"]),
		read(directory, "external.csv"),
		read(directory, "levels.csv"),
	]);

	for (const row of assignments)
		if (!trimmed(row, "segment_key"))
			row.segment_key = `${trimmed(row, "department")}|${trimmed(row, "title")}`;

	for (const row of external) toFlag(row, "unemployed");
	for (const row of employees) toFlag(row, "overseas_educated");

	return sourceData({ employees, assignments, external, levels });
}
