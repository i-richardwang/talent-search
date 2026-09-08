/**
 * 参考数据源：一个目录里的三个 CSV，列名就是 `src/corpus/contract.ts` 的契约列。
 *
 * 它有两个作用：**契约的可执行说明**——想接自己的人事数据，最省事的路径就是从
 * 上游导出这三张表；以及**开箱可跑**——不配任何环境变量时读仓库自带的合成样例，
 * `bun run import` 直接能把库填满。
 *
 *     <TALENT_CSV_DIR>/
 *       employees.csv    emp_id,name,hire_date,education_level,school,recruitment
 *       assignments.csv  emp_id,start_date,end_date,org,org_path,title,level,
 *                        seq_l1,seq_l2,seq_l3[,segment_key]
 *       external.csv     emp_id,start_date,end_date,org,title,description,
 *                        company_tag,industry,nature,unemployed
 *
 * 日期写 `YYYY-MM-DD`，留空表示「至今」或「未知」，具体含义见契约。
 * `unemployed` 写 `true` / `1` / `Y` 表示待业段，留空即否。
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
 * 不配 `TALENT_CSV_DIR` 时读的合成样例。它进版本库，因为里面没有一个真人。
 *
 * 按仓库根目录解析，不按这个模块的位置：源码打包之后模块旁边不会有 CSV，而
 * 「开箱可跑」本来就是**在这个仓库里**才成立的性质——部署出去的服务读的是
 * 配好的数据源。路径写死在这里，改目录时 grep 得到。
 */
const SAMPLE_DIR = "src/corpus/sources/sample";

const TRUE_VALUES = new Set(["true", "1", "y", "yes", "是"]);

/**
 * 读一个 CSV，只做 CSV 自己表达不了的事：去掉 BOM、补上可省的列。
 *
 * 列齐不齐由契约（`sourceData`）判，不在这里判一遍：两处判，改契约列的人就得
 * 记得改两处，而只有一处会红。
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
		columns: true,
		bom: true,
		skip_empty_lines: true,
	});
	return rows.map((row) => {
		const out: RawRow = { ...row };
		for (const column of optional) if (!(column in out)) out[column] = "";
		return out;
	});
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

	const [employees, assignments, external] = await Promise.all([
		read(directory, "employees.csv"),
		read(directory, "assignments.csv", ["segment_key"]),
		read(directory, "external.csv"),
	]);

	// 没给 segment_key 就按「部门 + 岗位」判断相邻段是不是同一件事
	for (const row of assignments)
		if (!trimmed(row, "segment_key"))
			row.segment_key = `${trimmed(row, "org")}|${trimmed(row, "title")}`;

	// CSV 里没有布尔，只有字面量
	for (const row of external)
		row.unemployed = TRUE_VALUES.has(trimmed(row, "unemployed").toLowerCase());

	return sourceData({ employees, assignments, external });
}
