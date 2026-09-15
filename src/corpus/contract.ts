/**
 * 源契约：适配器要交出什么，管线才接得住。
 *
 * 这是公开仓库与具体人事数据之间**唯一**的接口。任何一套 HR 数据，只要能填出
 * 下面三张表，就能接进来；反过来，管线只认这三张表，不认任何一家公司的表名、
 * 字段名或字典码——那些一律留在 `sources/` 下的适配器里。
 *
 * 三张表刻意都是「已经摊平的事实」，不是某个系统的原始形态：
 *
 * - `employees`   人群与档案。**谁在这张表里，谁就进库**，人群口径是适配器的事；
 * - `assignments` 公司内任职段，一段一行，切段规则是适配器的事；
 * - `external`    入职前经历，一段一行。
 *
 * 管线负责的是三张表都逃不掉的那部分：区间合法性、开放区间封口、相邻段合并、
 * 时长计算、当前信息派生。这些不该在每接一个数据源时重写一遍——重写一遍就会
 * 出现两套「什么算一段经历」。
 *
 * **字段名就是列名。** 它们和 CSV 的表头、库里的列同一种写法，中间没有一层
 * 需要维护的对照——接数据的人在 README、`csv-dir.ts` 和这里读到的是同一批名字。
 */

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
 * 入职前经历，一段一行。`end_date` 留空的用入职日封口。
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

export type SourceEmployee = Record<(typeof EMPLOYEE_COLUMNS)[number], string>;
export type SourceAssignment = Record<
	(typeof ASSIGNMENT_COLUMNS)[number],
	string
>;
export type SourceExternal = Record<
	Exclude<(typeof EXTERNAL_COLUMNS)[number], "unemployed">,
	string
> & { unemployed: boolean };

/** 一次抽取的全部产出。适配器的 `extract()` 返回它。 */
export type SourceData = {
	employees: SourceEmployee[];
	assignments: SourceAssignment[];
	external: SourceExternal[];
};

/** 适配器交上来的原样行：键是列名，值还没有约定形态。 */
export type RawRow = Record<string, unknown>;

/**
 * 按契约列裁齐一张表；缺列直接报到人看得懂。
 *
 * 多出来的列丢掉，缺的列报错——适配器算中间值很正常，但它们不能顺着管线漏
 * 进库里（见 AGENTS.md「不落没有读者的列」）。值一律收成字符串，**不做修剪**：
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

/**
 * 待业标记只认布尔。
 *
 * 源里写的是 `Y` 还是 `1` 是**那一套数据的形态**，翻译归适配器（`csv-dir.ts`
 * 认得一串写法）；到了契约上它已经是一个判断的结果。所以这里读到别的东西不是
 * 脏数据，是适配器坏了：整轮出声退出，而不是把这一段悄悄当成「不是待业」。
 */
function flag(value: unknown, index: number): boolean {
	if (typeof value === "boolean") return value;
	if (value === null || value === undefined || value === "") return false;
	throw new Error(
		`数据源的 external 第 ${index + 1} 行 unemployed 不是布尔值：${JSON.stringify(value)}`,
	);
}

/** 把适配器交上来的三批行收成契约的形状。适配器的 `extract()` 用它收尾。 */
export function sourceData(raw: {
	employees: RawRow[];
	assignments: RawRow[];
	external: RawRow[];
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
	};
}
