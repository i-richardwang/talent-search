/**
 * 参考数据源：一个目录里的四个 CSV，加上可选的三个记录 CSV，列名就是
 * `src/corpus/contract.ts` 的契约列。
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
 *       streams.csv      stream,kind,label,period,notes            （可选）
 *       scales.csv       stream,value,rank                         （可选）
 *       records.csv      emp_id,stream,period_start,period_end,value,recorded_at（可选）
 *
 * 记录的三个文件各自可选，没有的当作空表。只有状态流时不用 `scales.csv`；有评级流就要有
 * `scales.csv`，否则管线报「评级的档不在档位表里」。记录不属于声明过的流同样由管线报出。
 * 日期写 `YYYY-MM-DD`，留空表示「至今」或「未知」，具体含义见契约。
 * `education_level` 写契约里学历五档之一（`EDUCATION_LADDER`），`rank` 写整数。
 * `unemployed` 写 `true` / `1` / `Y` 表示待业段，留空即否。
 * `overseas_educated` 写 `true` / `1` / `Y` 表示海外学历，`false` / `0` / `N` 表示不是，
 * 留空表示没有记录。
 *
 * `segment_key` 这一列可以不给：缺列时用「部门 + 岗位」作为任职标识；显式空值表示没有可靠标识。
 * 源系统有组织 id、job code 等稳定标识时可自行填写；管线只合并登记事实相同的连续段。
 */

import { access, readFile } from "node:fs/promises";
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
 * 去掉 BOM、修剪表头；必需列由 sourceData 逐行核验。
 */
async function read(directory: string, name: string): Promise<RawRow[]> {
	const path = join(directory, name);
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (cause) {
		throw new Error(`源文件缺失：${path}`, { cause });
	}
	return parse(text, {
		columns: (header: string[]) => {
			const columns = header.map((column) => column.trim());
			const seen = new Set<string>();
			for (const column of columns) {
				if (seen.has(column))
					throw new Error(`源文件 ${name} 有重复列名：${column}`);
				seen.add(column);
			}
			return columns;
		},
		bom: true,
		skip_empty_lines: true,
	});
}

/** 可选的文件不存在时是空表；存在就和必需的文件一样读。 */
async function readOptional(directory: string, name: string) {
	try {
		await access(join(directory, name));
	} catch {
		return [];
	}
	return read(directory, name);
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

	const [employees, assignments, external, levels, streams, scales, records] =
		await Promise.all([
			read(directory, "employees.csv"),
			read(directory, "assignments.csv"),
			read(directory, "external.csv"),
			read(directory, "levels.csv"),
			readOptional(directory, "streams.csv"),
			readOptional(directory, "scales.csv"),
			readOptional(directory, "records.csv"),
		]);

	for (const row of assignments)
		if (!Object.hasOwn(row, "segment_key"))
			row.segment_key = `${trimmed(row, "department")}|${trimmed(row, "title")}`;

	for (const row of external) toFlag(row, "unemployed");
	for (const row of employees) toFlag(row, "overseas_educated");

	return sourceData({
		employees,
		assignments,
		external,
		levels,
		streams,
		scales,
		records,
	});
}
