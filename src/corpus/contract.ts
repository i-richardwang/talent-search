/**
 * 数据源与管线的唯一契约：员工档案、公司内任职、入职前经历和公司职级口径。
 * 适配器提供摊平的事实，决定人群和源特有的切段、字段翻译；
 * 管线处理来源无关的区间校验、相邻段合并、时长及当前信息派生。
 */

/**
 * 学历的五档，从低到高。`employees.education_level` 只能写其中之一或留空：
 * 源里的写法（「硕士研究生」「技校」）由适配器归到这里，检索按档的先后比高低。
 * 这五档是通用的，不属于任何一家公司，所以写在契约里而不是适配器里。
 */
export const EDUCATION_LADDER = [
	"高中及以下",
	"大专",
	"本科",
	"硕士",
	"博士",
] as const;

/** 一人一行。`emp_id` 是全库主键，其余是详情页会读的档案字段。 */
const EMPLOYEE_COLUMNS = [
	"emp_id",
	"name",
	"hire_date",
	"education_level",
	"school",
	"recruitment",
] as const;

/**
 * 公司内任职段，一段一行。`end_date` 留空表示至今。
 *
 * `segment_key` 是「这两段是不是同一件事」的判据，只被相邻段合并读。源系统里
 * 部门被重新登记、或一次异动被拆成两条时，会切出内容相同的相邻段——它们不是
 * 两段经历。判据只有源自己知道（组织 id + job code 比中文名可靠），所以由
 * 适配器给；没有更好的东西时填 `org` + `title` 也是成立的。
 * 空值表示没有可靠判据；管线会报出数量并把这些记录各自保留为独立经历。
 */
const ASSIGNMENT_COLUMNS = [
	"emp_id",
	"start_date",
	"end_date",
	"org",
	"org_path",
	"title",
	"level",
	"seq_l1",
	"seq_l2",
	"seq_l3",
	"segment_key",
] as const;

/**
 * 入职前经历，一段一行。`end_date` 留空的以入职日为结束日。
 *
 * `unemployed` 为真时岗位显示为「待业」且不接描述：待业段要保留（它解释了
 * 履历上的空档），但它不是一段可检索的经历。
 */
const EXTERNAL_COLUMNS = [
	"emp_id",
	"start_date",
	"end_date",
	"org",
	"title",
	"description",
	"company_tag",
	"industry",
	"nature",
	"unemployed",
] as const;

/**
 * 职级表，一个职级一行。`level` 是任职段上登记的职级原文，`band` 是它归入的档，
 * `rank` 是档的高低：越大越高，同一档的每一行写同一个数。
 *
 * 筛选和「某档及以上」都按档走，职级原文只在详情里显示。几条职级线（专业、管理）
 * 能不能比高低、怎么并档，由公司自己规定，所以这张表由适配器给。任职段上出现、
 * 表里没有的职级不进任何一档，管线会报出人数。
 */
const LEVEL_COLUMNS = ["level", "band", "rank"] as const;

export type SourceEmployee = Record<(typeof EMPLOYEE_COLUMNS)[number], string>;
export type SourceAssignment = Record<
	(typeof ASSIGNMENT_COLUMNS)[number],
	string
>;
export type SourceExternal = Record<
	Exclude<(typeof EXTERNAL_COLUMNS)[number], "unemployed">,
	string
> & { unemployed: boolean };

export type SourceLevel = Record<(typeof LEVEL_COLUMNS)[number], string>;

/** 一次抽取的全部产出。适配器的 `extract()` 返回它。 */
export type SourceData = {
	employees: SourceEmployee[];
	assignments: SourceAssignment[];
	external: SourceExternal[];
	levels: SourceLevel[];
};

/** 适配器提供的原样行：键是列名，值还没有约定形态。 */
export type RawRow = Record<string, unknown>;

/**
 * 按契约列整理一张表；缺列时报出人看得懂的错误。
 *
 * 多出来的列丢掉，缺的列报错——适配器算中间值很正常，但它们不能顺着管线漏
 * 进库里（见 AGENTS.md「不落没有读者的列」）。值一律转成字符串，**不做修剪**：
 * 修剪是管线的事，而且只发生在管线明确要修剪的那几列上。
 */
function conform<T>(rows: RawRow[], columns: readonly string[], what: string) {
	const first = rows[0];
	if (first) {
		const missing = columns.filter((column) => !(column in first));
		if (missing.length)
			throw new Error(`数据源的 ${what} 缺少契约列：${missing.join("、")}`);
	}
	return rows.map((row) => {
		const out: Record<string, string> = {};
		for (const column of columns) out[column] = text(row[column]);
		return out as T;
	});
}

/** 任何标量 → 字符串。缺失变空串，绝不变成字面量 "null" 或 "NaN"。 */
function text(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "number")
		return Number.isFinite(value) ? String(value) : "";
	return String(value);
}

/** 契约内待业标记为布尔，缺失表示否；具体源的标记格式由适配器转换。 */
function flag(value: unknown, index: number): boolean {
	if (typeof value === "boolean") return value;
	if (value === null || value === undefined || value === "") return false;
	throw new Error(
		`数据源的 external 第 ${index + 1} 行 unemployed 不是布尔值：${JSON.stringify(value)}`,
	);
}

/** 把适配器提供的四批行转成契约的形状。适配器的 `extract()` 最后调用它。 */
export function sourceData(raw: {
	employees: RawRow[];
	assignments: RawRow[];
	external: RawRow[];
	levels: RawRow[];
}): SourceData {
	return {
		employees: conform<SourceEmployee>(
			raw.employees,
			EMPLOYEE_COLUMNS,
			"employees",
		),
		assignments: conform<SourceAssignment>(
			raw.assignments,
			ASSIGNMENT_COLUMNS,
			"assignments",
		),
		external: conform<SourceExternal>(
			raw.external,
			EXTERNAL_COLUMNS,
			"external",
		).map((row, index) => ({
			...row,
			unemployed: flag(raw.external[index]?.unemployed, index),
		})),
		levels: conform<SourceLevel>(raw.levels, LEVEL_COLUMNS, "levels"),
	};
}
