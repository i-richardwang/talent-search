/**
 * 数据源与管线的唯一契约：员工档案、公司内任职、入职前经历、公司自己的职级分档，
 * 以及按期登记的记录（绩效评级、高潜池这类状态）。
 * 适配器提供摊平的事实，决定人群和源特有的切段、字段翻译；
 * 管线处理来源无关的区间校验、相邻段合并、时长及当前信息计算。
 */

/**
 * 学历的五档，从低到高。`employees.education_level` 只能写其中之一或留空：
 * 源里的写法（「硕士研究生」「技校」）由适配器归到这里，检索按档的先后比高低。
 * 这五档是通用的，不属于任何一家公司。
 */
export const EDUCATION_LADDER = [
	"高中及以下",
	"大专",
	"本科",
	"硕士",
	"博士",
] as const;

/**
 * 一人一行。`emp_id` 是全库主键，其余是详情页会读的档案字段。
 *
 * `school` 和 `school_tier` 说的都是最高学历那所学校；学校档的分法（985、QS100……）
 * 由数据源给，档与档之间没有高低，只按取值筛。`overseas_educated` 是最高学历是不是
 * 在海外取得：是、否，或者没有记录（留空）。
 */
const EMPLOYEE_COLUMNS = [
	"emp_id",
	"name",
	"hire_date",
	"education_level",
	"school",
	"school_tier",
	"overseas_educated",
	"recruitment",
] as const;

/**
 * 公司内任职段，一段一行。`end_date` 留空表示至今。
 *
 * `segment_key` 标识同一次任职，只被相邻段合并读。源系统里
 * 部门被重新登记、或一次异动被拆成两条时，会切出内容相同的相邻段——它们不是
 * 两段经历。判据由适配器给（组织 id + job code 比中文名可靠）；没有更好的东西时
 * 填 `department` + `title` 也是成立的。
 * 管线还要求部门、路径、岗位、职级、序列全部相同且时间连续；事实变化时保留分段。
 * 空值表示没有可靠判据；管线会报出数量并把这些记录各自保留为独立经历。
 */
const ASSIGNMENT_COLUMNS = [
	"emp_id",
	"start_date",
	"end_date",
	"department",
	"department_path",
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
	"company",
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

/**
 * 记录流，一条流一行：`perf` 是一条绩效流，`hipo` 是一条高潜池。`kind` 说这条流的记录是什么：
 *
 * - `rating`：按期评级，每一期一档（半年一期的绩效）。档有高低，档位表在 `scales`。
 * - `status`：一段时间里处于某个状态（在高潜池里），`period_end` 留空表示仍有效。
 *
 * `label` 是中文名，`period` 是一期多长（「半年」），`notes` 是这条流的口径（怎么评、
 * 缺一期意味着什么），原样写进数据目录给查询理解读。流名 `level`、`education` 留给
 * 职级档与学历档，数据源不能用。
 */
const STREAM_COLUMNS = ["stream", "kind", "label", "period", "notes"] as const;

/** 评级流的档位表，一档一行：`rank` 越大越高，同一条流里档名唯一。 */
const SCALE_COLUMNS = ["stream", "value", "rank"] as const;

/**
 * 一条记录一行。评级是一期一档：`period_start`、`period_end` 是这一期的起止，`value`
 * 是档位表里的档。状态是一段：`period_end` 留空表示仍有效。
 *
 * 同一人同一流同一期（同一个 `period_start`）可以有几条修订，`recorded_at` 是登记时刻，
 * 管线只留最晚的一条；分不出最晚的那一组整组拒绝并报告。只有一条时可以留空。
 */
const RECORD_COLUMNS = [
	"emp_id",
	"stream",
	"period_start",
	"period_end",
	"value",
	"recorded_at",
] as const;

export type SourceEmployee = Record<
	Exclude<(typeof EMPLOYEE_COLUMNS)[number], "overseas_educated">,
	string
> & { overseas_educated: boolean | null };
export type SourceAssignment = Record<
	(typeof ASSIGNMENT_COLUMNS)[number],
	string
>;
export type SourceExternal = Record<
	Exclude<(typeof EXTERNAL_COLUMNS)[number], "unemployed">,
	string
> & { unemployed: boolean };

export type SourceLevel = Record<(typeof LEVEL_COLUMNS)[number], string>;
export type SourceStream = Record<(typeof STREAM_COLUMNS)[number], string>;
export type SourceScale = Record<(typeof SCALE_COLUMNS)[number], string>;
export type SourceRecord = Record<(typeof RECORD_COLUMNS)[number], string>;

/** 一次抽取的全部产出。适配器的 `extract()` 返回它。 */
export type SourceData = {
	employees: SourceEmployee[];
	assignments: SourceAssignment[];
	external: SourceExternal[];
	levels: SourceLevel[];
	streams: SourceStream[];
	scales: SourceScale[];
	records: SourceRecord[];
};

/** 适配器提供的原样行：键是列名，值还没有约定形态。 */
export type RawRow = Record<string, unknown>;

/**
 * 按契约列整理一张表；缺列时报出人看得懂的错误。额外列丢弃，字段修剪归管线处理。
 */
function conform<C extends readonly string[]>(
	rows: RawRow[],
	columns: C,
	what: string,
) {
	return rows.map((row, index) => {
		const missing = columns.filter((column) => !Object.hasOwn(row, column));
		if (missing.length)
			throw new Error(
				`数据源的 ${what} 第 ${index + 1} 行缺少契约列：${missing.join("、")}`,
			);
		const out: Record<string, string> = {};
		for (const column of columns) out[column] = text(row[column]);
		return out as Record<C[number], string>;
	});
}

/** 任何标量 → 字符串。缺失变空串，绝不变成字面量 "null" 或 "NaN"。 */
function text(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "number")
		return Number.isFinite(value) ? String(value) : "";
	return String(value);
}

/**
 * 契约内的标记是布尔，留空返回 `null`，缺失算什么由调用处说：待业缺失即否，海外学历
 * 缺失是没有记录。具体源的标记格式由适配器转换。
 */
function flag(
	rows: RawRow[],
	what: string,
	column: string,
	index: number,
): boolean | null {
	const value = rows[index]?.[column];
	if (typeof value === "boolean") return value;
	if (value === null || value === undefined || value === "") return null;
	throw new Error(
		`数据源的 ${what} 第 ${index + 1} 行 ${column} 不是布尔值：${JSON.stringify(value)}`,
	);
}

/**
 * 把适配器提供的几批行转成契约的形状。适配器的 `extract()` 最后调用它。
 * 记录的三批可以不给：没有记录流的数据源照样同步，目录里就没有评级和状态。
 */
export function sourceData(raw: {
	employees: RawRow[];
	assignments: RawRow[];
	external: RawRow[];
	levels: RawRow[];
	streams?: RawRow[];
	scales?: RawRow[];
	records?: RawRow[];
}): SourceData {
	return {
		employees: conform(raw.employees, EMPLOYEE_COLUMNS, "employees").map(
			(row, index) => ({
				...row,
				overseas_educated: flag(
					raw.employees,
					"employees",
					"overseas_educated",
					index,
				),
			}),
		),
		assignments: conform(raw.assignments, ASSIGNMENT_COLUMNS, "assignments"),
		external: conform(raw.external, EXTERNAL_COLUMNS, "external").map(
			(row, index) => ({
				...row,
				unemployed:
					flag(raw.external, "external", "unemployed", index) ?? false,
			}),
		),
		levels: conform(raw.levels, LEVEL_COLUMNS, "levels"),
		streams: conform(raw.streams ?? [], STREAM_COLUMNS, "streams"),
		scales: conform(raw.scales ?? [], SCALE_COLUMNS, "scales"),
		records: conform(raw.records ?? [], RECORD_COLUMNS, "records"),
	};
}
