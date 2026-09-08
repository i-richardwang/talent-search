/**
 * 通用管线：源契约的三张表 → 库里的 employee / experience 两张表。
 *
 * 这里不出现任何一家公司的字段名、字典码或组织名。它只做「无论数据从哪来都
 * 必须做」的那几件事：
 *
 * 1. 区间合法性——日期格式错误、没有开始日、结束早于开始、生效日在未来的记录
 *    一律**拒绝导入并报出数量**，不猜日期，也不靠 `Math.max(1, ...)` 把错误区间
 *    伪装成一月经历；
 * 2. 开放区间封口——公司内开放段计算时封到 `asOf`，入职前开放段封到入职日；
 * 3. 相邻段合并——`segment_key` 相同且时间连续或重叠的记录合成一段经历；
 * 4. 时长与当前信息派生。
 *
 * 这几件事只写一遍，接第二个数据源时才不会长出第二套「什么算一段经历」。
 *
 * 整个模块是纯函数：进去三张表，出来两张表，说过的话交给 `report`。没有它自己
 * 的入口，测试对着 `build` 一个函数就能把上面四条逐条摆出来。
 */

import type { CompanyMeta } from "#/db/schema";
import type {
	SourceAssignment,
	SourceData,
	SourceEmployee,
	SourceExternal,
} from "./contract";
import type { Report } from "./report";

export type EmployeeRow = {
	emp_id: string;
	name: string;
	cur_dept: string;
	cur_title: string;
	cur_seq_l1: string;
	cur_seq_l2: string;
	cur_seq_l3: string;
	cur_level: string;
	/** ISO 日期；读不懂的留空 */
	hire_date: string | null;
	education_level: string;
	school: string;
	recruitment: string;
};

export type ExperienceRow = {
	emp_id: string;
	kind: "internal" | "external";
	start_date: string;
	/** 为空表示至今 */
	end_date: string | null;
	org: string;
	org_path: string;
	org_meta: CompanyMeta | null;
	title: string;
	seq_l1: string;
	seq_l2: string;
	seq_l3: string;
	/** 推断的那两级由 `align.ts` 在灌库前填，管线一律交空 */
	seq_inferred_l1: string;
	seq_inferred_l2: string;
	level: string;
	description: string;
	months: number;
};

/** 待业段的岗位显示。它不是一个岗位名，是「这段时间没有工作」的表达。 */
export const UNEMPLOYED = "待业";

const DAY_MS = 86_400_000;
/** 一个月按多少天算：公历年平均 365.25 天 ÷ 12。 */
const DAYS_PER_MONTH = 30.44;

/** 源里的一个日期还没读出来时的三种状态。 */
type Maybe = Date | null | "invalid";

/**
 * 源里的一个日期 → UTC 零点的时刻。
 *
 * 三种结果分得开，缺一不可：`null` 是**没有值**（契约允许的未知或开放区间），
 * `"invalid"` 是**有值但读不懂**，其余是那一天。两者都收成空的话，一个错误的
 * 结束日会被当成开放区间封口，一段错误的历史会被当成当前经历。
 *
 * 只认 `YYYY-MM-DD` 和 `YYYY/MM/DD`，后面可以跟时刻（数仓导出常带 00:00:00）。
 * 宽松解析在这里是负债：把 `2024-13-01` 读成 2025 年一月的话，下面所有的区间
 * 校验都白做了。源里的别的写法归适配器翻译——那是那一套数据的形态。
 */
function parseDate(value: string): Maybe {
	const text = value.trim();
	if (!text) return null;
	const matched = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T].*)?$/.exec(text);
	if (!matched) return "invalid";
	const year = Number(matched[1]);
	const month = Number(matched[2]);
	const day = Number(matched[3]);
	const at = new Date(Date.UTC(year, month - 1, day));
	// 2 月 30 日这种日子在 Date.UTC 里会滚到下个月，滚过就说明它压根不存在
	if (
		at.getUTCFullYear() !== year ||
		at.getUTCMonth() !== month - 1 ||
		at.getUTCDate() !== day
	)
		return "invalid";
	return at;
}

/**
 * 这台机器墙上的今天，表示成管线里日期通用的样子：UTC 午夜、只有年月日。
 *
 * 取**本地**日历日，不取 UTC 日历日：源里的日期是人事系统按当地日历登记的，
 * 跑导入的人看的也是墙上那本日历。取 UTC 的话，东八区每天早上八点前「今天」
 * 还是昨天，当天生效的任职段会被判成「生效日在未来」拒掉。
 */
function today(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** ISO 日期串，写库用。 */
function isoDate(at: Date): string {
	return at.toISOString().slice(0, 10);
}

/**
 * 把一个**已经校验过**的闭区间换算成月数。
 *
 * 非法区间在这里抛错而不是兜底：能走到这一步说明上面的校验漏了，
 * 悄悄返回 1 会让一段错数据以合法经历的样子进库。
 */
function durationMonths(start: Date, end: Date): number {
	if (end < start)
		throw new Error(`无效日期区间：${isoDate(start)} — ${isoDate(end)}`);
	const days = (end.getTime() - start.getTime()) / DAY_MS;
	const months = Math.round((days + 1) / DAYS_PER_MONTH);
	return months > 0 ? months : 1;
}

/**
 * 剔除并报数。**拒绝必须报告**——静默丢数据的管线没人能验收。
 *
 * 经历按段数，员工档案按行数：报告里的量词得和被拒的东西对得上。
 */
function reject<T>(
	rows: T[],
	bad: (row: T) => boolean,
	why: string,
	report: Report,
	unit = "段",
): T[] {
	const kept = rows.filter((row) => !bad(row));
	const dropped = rows.length - kept.length;
	if (dropped) report(`  ${why} ${dropped} ${unit}，已拒绝导入`);
	return kept;
}

/**
 * 校验跑完之后，把「可能读不懂」的两个日期收成确定的值。
 *
 * 抛出来的那条路走不到——上面每一条拒绝都已经跑过。它在这里是为了让类型系统
 * 承认这件事，顺便在有人往前面插一条新校验、却忘了它会漏什么的时候当场炸掉。
 */
function settled<T extends { start: Maybe; end: Maybe }>(rows: T[]) {
	return rows.map((row) => {
		if (!(row.start instanceof Date) || row.end === "invalid")
			throw new Error("日期校验漏掉了一段无效区间");
		return { ...row, start: row.start, end: row.end };
	});
}

// ------------------------------------------------------------------ 公司内经历

/** 切段过程中的一段：日期已经读成时刻，文本已经修剪。 */
type Segment = {
	emp_id: string;
	start: Date;
	end: Date | null;
	org: string;
	org_path: string;
	title: string;
	level: string;
	seq_l1: string;
	seq_l2: string;
	seq_l3: string;
	segment_key: string;
	months: number;
};

function buildInternal(
	rows: SourceAssignment[],
	asOf: Date,
	report: Report,
): Segment[] {
	let parsed = rows.map((row) => ({
		emp_id: row.emp_id,
		start: parseDate(row.start_date),
		end: parseDate(row.end_date),
		org: row.org.trim(),
		org_path: row.org_path.trim(),
		title: row.title.trim(),
		level: row.level.trim(),
		seq_l1: row.seq_l1.trim(),
		seq_l2: row.seq_l2.trim(),
		seq_l3: row.seq_l3.trim(),
		segment_key: row.segment_key.trim(),
	}));

	parsed = reject(
		parsed,
		(r) => r.start === "invalid" || r.end === "invalid",
		"公司内经历日期格式无效",
		report,
	);
	parsed = reject(
		parsed,
		(r) => r.start === null,
		"公司内经历缺少开始日期",
		report,
	);

	let dated = settled(parsed);
	dated = reject(
		dated,
		(r) => r.start > asOf,
		"公司内经历生效日在未来",
		report,
	);
	dated = reject(
		dated,
		(r) => r.end !== null && r.end > asOf,
		"公司内经历结束日在未来",
		report,
	);
	dated = reject(
		dated,
		(r) => r.end !== null && r.end < r.start,
		"公司内经历日期倒置",
		report,
	);

	const keyless = dated.filter((r) => !r.segment_key).length;
	if (keyless)
		report(`  公司内经历缺少 segment_key ${keyless} 段，已保留为独立经历`);

	return mergeAdjacent(dated, asOf, report);
}

/**
 * 合并 `segment_key` 相同的相邻段，并按合并后的区间重算时长。
 *
 * 相同 key 只说明内容相同；时间连续或重叠才说明它们是同一段经历。合并区间取
 * 最早开始和最晚结束，只要其中一段开放，合并结果就开放；重算时长封到 `asOf`。
 */
function mergeAdjacent(
	rows: Omit<Segment, "months">[],
	asOf: Date,
	report: Report,
): Segment[] {
	/* 没有 key 的行各自成组：内容相同只是巧合，合并它们等于凭空拼出一段经历。 */
	const groups = new Map<string, Omit<Segment, "months">[]>();
	for (const [index, row] of rows.entries()) {
		const key = [
			row.emp_id,
			row.segment_key ? `segment:${row.segment_key}` : `row:${index}`,
		].join("\u001f");
		const group = groups.get(key);
		if (group) group.push(row);
		else groups.set(key, [row]);
	}

	const merged: Omit<Segment, "months">[] = [];
	for (const group of groups.values()) {
		// 开放段排在最后：它的结束「至今」比任何一个具体日子都晚
		const sorted = [...group].sort(
			(a, b) =>
				a.start.getTime() - b.start.getTime() ||
				(a.end?.getTime() ?? Number.POSITIVE_INFINITY) -
					(b.end?.getTime() ?? Number.POSITIVE_INFINITY),
		);
		let current: Omit<Segment, "months"> | null = null;
		for (const row of sorted) {
			if (!current) {
				current = { ...row };
				continue;
			}
			const currentEnd = current.end ?? asOf;
			if (row.start.getTime() > currentEnd.getTime() + DAY_MS) {
				merged.push(current);
				current = { ...row };
				continue;
			}
			current.end =
				current.end === null || row.end === null
					? null
					: new Date(Math.max(current.end.getTime(), row.end.getTime()));
		}
		if (current) merged.push(current);
	}

	if (rows.length !== merged.length)
		report(`  合并内容相同的相邻段 ${rows.length - merged.length} 条`);

	return merged
		.map((row) => ({
			...row,
			months: durationMonths(row.start, row.end ?? asOf),
		}))
		.sort(
			(a, b) =>
				a.emp_id.localeCompare(b.emp_id) ||
				a.start.getTime() - b.start.getTime(),
		);
}

// ------------------------------------------------------------------ 入职前经历

function buildExternal(
	rows: SourceExternal[],
	hireDates: Map<string, Date>,
	report: Report,
): ExperienceRow[] {
	let parsed = rows.map((row) => ({
		emp_id: row.emp_id,
		start: parseDate(row.start_date),
		end: parseDate(row.end_date),
		org: row.org.trim(),
		title: row.title.trim(),
		description: row.description.trim(),
		company_tag: row.company_tag.trim(),
		industry: row.industry.trim(),
		nature: row.nature.trim(),
		unemployed: row.unemployed,
	}));

	parsed = reject(
		parsed,
		(r) => r.start === "invalid" || r.end === "invalid",
		"入职前经历日期格式无效",
		report,
	);
	parsed = reject(
		parsed,
		(r) => r.start === null,
		"入职前经历缺少开始日期",
		report,
	);

	/*
	 * 用入职日封住开放区间；封不上的不导入。「一直干到入职这家公司为止」是这段
	 * 经历唯一说得通的读法；连入职日都没有时区间就没有边界，猜一个出来等于凭空
	 * 造经历。
	 */
	const closed = settled(parsed).map((row) => ({
		...row,
		end: row.end ?? hireDates.get(row.emp_id) ?? null,
	}));
	let valid = reject(
		closed,
		(r) => r.end === null,
		"入职前经历缺少结束日且无入职日",
		report,
	).map((row) => ({ ...row, end: required(row.end) }));

	valid = reject(valid, (r) => r.end < r.start, "入职前经历日期倒置", report);
	// 入职前经历不能越过已知入职日；开放区间封到入职日的边界合法。
	valid = reject(
		valid,
		(r) => {
			const hire = hireDates.get(r.emp_id);
			return hire !== undefined && r.end > hire;
		},
		"入职前经历结束日晚于入职日",
		report,
	);

	return valid.map((row) => ({
		emp_id: row.emp_id,
		kind: "external" as const,
		start_date: isoDate(row.start),
		end_date: isoDate(row.end),
		org: row.org,
		org_path: "",
		org_meta: companyMeta(row),
		title: row.unemployed ? UNEMPLOYED : row.title,
		seq_l1: "",
		seq_l2: "",
		seq_l3: "",
		seq_inferred_l1: "",
		seq_inferred_l2: "",
		level: "",
		description: row.unemployed ? "" : row.description,
		months: durationMonths(row.start, row.end),
	}));
}

/** 封口那一条拒绝跑过之后，结束日一定在。理由同 `settled`。 */
function required(end: Date | null): Date {
	if (end === null) throw new Error("封口校验漏掉了一段没有结束日的经历");
	return end;
}

/** 公司属性只存非空项。整体为空时写 NULL，不写 `{}`。 */
function companyMeta(row: {
	company_tag: string;
	industry: string;
	nature: string;
}): CompanyMeta | null {
	const meta: CompanyMeta = {};
	if (row.company_tag) meta.company_tag = row.company_tag;
	if (row.industry) meta.industry = row.industry;
	if (row.nature) meta.nature = row.nature;
	return Object.keys(meta).length ? meta : null;
}

// -------------------------------------------------------------------- 员工表

/** 已归一化的档案行：日期读过，文本修剪过。 */
type Profile = {
	emp_id: string;
	name: string;
	hire_date: Date | null;
	education_level: string;
	school: string;
	recruitment: string;
};

/**
 * 归一化是每一批档案都要做的第一件事：修剪文本、读入职日。
 *
 * 入职日读不懂时留空并报出来——它不像经历上那两个日期那样定义一段区间，缺了
 * 只是详情页少一行、入职前经历少一个封口点，为此拒绝整个人反而丢得更多。
 */
function normalizeProfiles(rows: SourceEmployee[], report: Report): Profile[] {
	let invalid = 0;
	const out = rows.map((row) => {
		const hire = parseDate(row.hire_date);
		if (hire === "invalid") invalid++;
		return {
			emp_id: row.emp_id.trim(),
			name: row.name.trim(),
			hire_date: hire === "invalid" ? null : hire,
			education_level: row.education_level.trim(),
			school: row.school.trim(),
			recruitment: row.recruitment.trim(),
		};
	});
	if (invalid) report(`  员工档案入职日期格式无效 ${invalid} 行，入职日已留空`);
	return out;
}

/**
 * 档案字段来自归一化后的源行，`cur_*` 一律从唯一的开放公司内经历派生。
 *
 * 当前部门、岗位、序列、职级不从源的快照里另取一份：那样库里就有两个「他现在
 * 在哪」，而时间线和结果行会各读一个。没有开放段就没有当前岗位；同时存在多段
 * 开放经历时，单值当前字段无法表达事实，因此留空并报出数据冲突，不猜一段。
 */
function buildEmployee(
	profiles: Profile[],
	internal: Segment[],
	report: Report,
): EmployeeRow[] {
	const open = new Map<string, Segment>();
	const ambiguous = new Set<string>();
	for (const segment of internal) {
		if (segment.end !== null) continue;
		if (open.has(segment.emp_id)) ambiguous.add(segment.emp_id);
		open.set(segment.emp_id, segment);
	}
	if (ambiguous.size) {
		const ids = [...ambiguous].sort();
		report(
			`  当前公司内经历冲突 ${ids.length} 人（${few(ids)}），当前字段已留空`,
		);
		for (const empId of ambiguous) open.delete(empId);
	}

	return [...profiles]
		.sort((a, b) => a.emp_id.localeCompare(b.emp_id))
		.map((profile) => {
			const current = open.get(profile.emp_id);
			return {
				emp_id: profile.emp_id,
				name: profile.name,
				cur_dept: current?.org ?? "",
				cur_title: current?.title ?? "",
				cur_seq_l1: current?.seq_l1 ?? "",
				cur_seq_l2: current?.seq_l2 ?? "",
				cur_seq_l3: current?.seq_l3 ?? "",
				cur_level: current?.level ?? "",
				hire_date: profile.hire_date ? isoDate(profile.hire_date) : null,
				education_level: profile.education_level,
				school: profile.school,
				recruitment: profile.recruitment,
			};
		});
}

/** 报告里点几个名字就够了：读的人要的是「是哪一类人」，不是一份名单。 */
function few(ids: string[]): string {
	return ids.slice(0, 5).join("、") + (ids.length > 5 ? "…" : "");
}

// ---------------------------------------------------------------------- 入口

/**
 * 源契约 → 可以直接写库的两张表。
 *
 * `asOf` 是这一次导入眼里的「今天」：公司内的开放段算时长封到它，生效日晚于它
 * 的记录是脏数据。默认取当天，调用方给一个固定值就能让整条管线可复现。
 */
export function build(
	data: SourceData,
	report: Report,
	asOf: Date = today(),
): { employee: EmployeeRow[]; experience: ExperienceRow[] } {
	let profiles = normalizeProfiles(data.employees, report);
	profiles = reject(
		profiles,
		(p) => !p.emp_id,
		"员工档案缺少工号",
		report,
		"行",
	);

	// 完全重复是导出毛刺；同工号冲突无法确定权威值，整个人退出本次人群。
	const unique = new Map<string, Profile>();
	for (const profile of profiles) {
		const identity = JSON.stringify([
			profile.emp_id,
			profile.name,
			profile.hire_date?.getTime() ?? null,
			profile.education_level,
			profile.school,
			profile.recruitment,
		]);
		if (!unique.has(identity)) unique.set(identity, profile);
	}
	if (profiles.length !== unique.size)
		report(`  员工档案整行重复 ${profiles.length - unique.size} 行，已去重`);
	profiles = [...unique.values()];

	const seen = new Map<string, number>();
	for (const profile of profiles)
		seen.set(profile.emp_id, (seen.get(profile.emp_id) ?? 0) + 1);
	const conflicting = [...seen]
		.filter(([, count]) => count > 1)
		.map(([empId]) => empId)
		.sort();
	if (conflicting.length) {
		report(
			`  员工档案字段冲突 ${conflicting.length} 人（${few(conflicting)}），已连同其经历拒绝导入`,
		);
		const rejected = new Set(conflicting);
		profiles = profiles.filter((profile) => !rejected.has(profile.emp_id));
	}

	const population = new Set(profiles.map((profile) => profile.emp_id));
	report(`  人群 ${population.size} 人`);

	const assignments = inPopulation(
		data.assignments,
		population,
		"公司内经历",
		report,
	);
	const external = inPopulation(
		data.external,
		population,
		"入职前经历",
		report,
	);

	const internal = buildInternal(assignments, asOf, report);
	report(`  公司内 ${internal.length} 段`);

	const employee = buildEmployee(profiles, internal, report);
	const hireDates = new Map<string, Date>();
	for (const profile of profiles)
		if (profile.hire_date) hireDates.set(profile.emp_id, profile.hire_date);

	const outside = buildExternal(external, hireDates, report);
	const idle = outside.filter((row) => row.title === UNEMPLOYED).length;
	report(`  入职前 ${outside.length} 段（其中待业 ${idle} 段）`);

	const experience = [
		...internal.map(
			(segment): ExperienceRow => ({
				emp_id: segment.emp_id,
				kind: "internal",
				start_date: isoDate(segment.start),
				end_date: segment.end ? isoDate(segment.end) : null,
				org: segment.org,
				org_path: segment.org_path,
				org_meta: null,
				title: segment.title,
				seq_l1: segment.seq_l1,
				seq_l2: segment.seq_l2,
				seq_l3: segment.seq_l3,
				seq_inferred_l1: "",
				seq_inferred_l2: "",
				level: segment.level,
				description: "",
				months: segment.months,
			}),
		),
		...outside,
	].sort(
		(a, b) =>
			a.emp_id.localeCompare(b.emp_id) ||
			a.start_date.localeCompare(b.start_date),
	);

	return { employee, experience };
}

/**
 * 人群由 `employees` 说了算：经历表里指向库外的人一律丢弃。
 *
 * 留着它们只会撞上 `experience.emp_id` 的外键，报一条读不懂的数据库错误。
 */
function inPopulation<T extends { emp_id: string }>(
	rows: T[],
	population: Set<string>,
	what: string,
	report: Report,
): T[] {
	const cleaned = rows.map((row) => ({ ...row, emp_id: row.emp_id.trim() }));
	const kept = cleaned.filter((row) => population.has(row.emp_id));
	if (cleaned.length !== kept.length)
		report(
			`  ${what} 有 ${cleaned.length - kept.length} 段不属于本次人群，已忽略`,
		);
	return kept;
}
