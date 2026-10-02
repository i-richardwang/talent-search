/**
 * 读取数据源，经 pipeline.ts 校验、切段后，在一笔短事务中同步人员与经历。
 * 正式表与暂存表共用数据库生成的 content_key：删除消失的段，插入新增段，
 * 同内容的段刷新累计月数并保留 id、边和派生版本。同步不调用模型。
 */

import "@tanstack/react-start/server-only";
import { prunePhrases } from "./derive";
import { build, type EmployeeRow, type ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import type { CorpusSession } from "./session";
import { loadSource, type SourceConfig } from "./sources";

/** 一条语句写多少行。 */
const ROWS_PER_STATEMENT = 5_000;

function* chunked<T>(rows: T[], size: number): Generator<T[]> {
	for (let start = 0; start < rows.length; start += size)
		yield rows.slice(start, start + size);
}

async function stageEmployee(
	{ client }: CorpusSession,
	rows: EmployeeRow[],
): Promise<void> {
	await client.query(
		"create temp table staged_employee (like employee) on commit drop",
	);
	for (const chunk of chunked(rows, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_employee (
				emp_id, name, cur_dept, cur_title, cur_seq_l1, cur_seq_l2, cur_seq_l3,
				cur_level, cur_level_band, cur_level_rank, hire_date,
				education_level, education_rank, school, recruitment)
			 select * from unnest(
				$1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
				$7::text[], $8::text[], $9::text[], $10::int[], $11::date[],
				$12::text[], $13::int[], $14::text[], $15::text[])`,
			[
				chunk.map((row) => row.emp_id),
				chunk.map((row) => row.name),
				chunk.map((row) => row.cur_dept),
				chunk.map((row) => row.cur_title),
				chunk.map((row) => row.cur_seq_l1),
				chunk.map((row) => row.cur_seq_l2),
				chunk.map((row) => row.cur_seq_l3),
				chunk.map((row) => row.cur_level),
				chunk.map((row) => row.cur_level_band),
				chunk.map((row) => row.cur_level_rank),
				chunk.map((row) => row.hire_date),
				chunk.map((row) => row.education_level),
				chunk.map((row) => row.education_rank),
				chunk.map((row) => row.school),
				chunk.map((row) => row.recruitment),
			],
		);
}

async function stageExperience(
	{ client }: CorpusSession,
	rows: ExperienceRow[],
): Promise<void> {
	/*
	 * `including generated`：暂存表的内容键和正式表用同一个表达式，由库算。
	 * `including defaults`：派生那一半的列这里不写，靠默认值满足 not null。
	 * id 是正式表发的号，暂存表里没有它。
	 */
	await client.query(
		"create temp table staged_experience (like experience including generated including defaults) on commit drop",
	);
	await client.query("alter table staged_experience drop column id");
	for (const chunk of chunked(rows, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_experience (
				emp_id, kind, unemployed, start_date, end_date, org, org_path, org_meta, title,
				seq_l1, seq_l2, seq_l3, level, description, months)
			 select * from unnest(
				$1::text[], $2::text[], $3::boolean[], $4::date[], $5::date[], $6::text[], $7::text[],
				$8::jsonb[], $9::text[], $10::text[], $11::text[], $12::text[],
				$13::text[], $14::text[], $15::int[])`,
			[
				chunk.map((r) => r.emp_id),
				chunk.map((r) => r.kind),
				chunk.map((r) => r.unemployed),
				chunk.map((r) => r.start_date),
				chunk.map((r) => r.end_date),
				chunk.map((r) => r.org),
				chunk.map((r) => r.org_path),
				chunk.map((r) => r.org_meta && JSON.stringify(r.org_meta)),
				chunk.map((r) => r.title),
				chunk.map((r) => r.seq_l1),
				chunk.map((r) => r.seq_l2),
				chunk.map((r) => r.seq_l3),
				chunk.map((r) => r.level),
				chunk.map((r) => r.description),
				chunk.map((r) => r.months),
			],
		);
}

const EMPLOYEE_COLUMNS =
	"emp_id, name, cur_dept, cur_title, cur_seq_l1, cur_seq_l2, cur_seq_l3, cur_level, cur_level_band, cur_level_rank, hire_date, education_level, education_rank, school, recruitment";
const EXPERIENCE_COLUMNS =
	"emp_id, kind, unemployed, start_date, end_date, org, org_path, org_meta, title, seq_l1, seq_l2, seq_l3, level, description, months";

/**
 * 把暂存的两张表和正式表做差：删这次没有的，插这次新来的，改了档案的人更新。
 * 段删掉时边跟着级联删除，于是收尾清一次没有边指向的说法（`prunePhrases`）。
 */
async function reconcile({ client }: CorpusSession): Promise<{
	employeesGone: number;
	experienceGone: number;
	experienceNew: number;
}> {
	const employeesGone = await client.query(
		"delete from employee where emp_id not in (select emp_id from staged_employee)",
	);
	// 档案没有派生的一半，整行照这一次的写
	await client.query(
		`insert into employee (${EMPLOYEE_COLUMNS})
		 select ${EMPLOYEE_COLUMNS} from staged_employee
		 on conflict (emp_id) do update set ${EMPLOYEE_COLUMNS.split(", ")
				.filter((column) => column !== "emp_id")
				.map((column) => `${column} = excluded.${column}`)
				.join(", ")}`,
	);
	const experienceGone = await client.query(
		"delete from experience where content_key not in (select content_key from staged_experience)",
	);
	await client.query(
		`update experience e set months = s.months
		 from staged_experience s where e.content_key = s.content_key and e.months <> s.months`,
	);
	const experienceNew = await client.query(
		`insert into experience (${EXPERIENCE_COLUMNS})
		 select ${EXPERIENCE_COLUMNS} from staged_experience s
		 where not exists (select 1 from experience e where e.content_key = s.content_key)`,
	);
	await prunePhrases(client);
	return {
		employeesGone: employeesGone.rowCount ?? 0,
		experienceGone: experienceGone.rowCount ?? 0,
		experienceNew: experienceNew.rowCount ?? 0,
	};
}

/**
 * 一次同步：读数据源 → 切段校验 → 一笔事务做差。
 *
 * 同内容的段保留身份，累计月数按本次日期刷新。连接与锁由调用方给
 * （`session.ts`），输出写到 `report`。
 */
export async function sync(
	session: CorpusSession,
	sourceConfig: SourceConfig,
	report: Report,
): Promise<void> {
	report(`读取数据源 ${sourceConfig.name}…`);
	const source = await loadSource(sourceConfig);
	const data = await source.extract(report);

	report("");
	report("切段与校验…");
	const { employee, experience } = build(data, report);

	report("");
	report("写入…");
	const { client } = session;
	await client.query("begin");
	let counts: Awaited<ReturnType<typeof reconcile>>;
	try {
		await stageEmployee(session, employee);
		await stageExperience(session, experience);
		counts = await reconcile(session);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
	report(
		`  人员 ${employee.length} 人，其中离开 ${counts.employeesGone} 人；` +
			`经历 ${experience.length} 段，新增 ${counts.experienceNew} 段、` +
			`离开 ${counts.experienceGone} 段`,
	);
}
