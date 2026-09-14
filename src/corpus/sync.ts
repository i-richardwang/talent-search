/**
 * 同步：把数据源里的原始人事数据搬进库，只搬原始的那一半。
 *
 * 读适配器、切段校验（`pipeline.ts`）、然后一笔短事务：这次没出现的人和段删掉，
 * 新出现的插进去，没变的一行不动。它**一次模型都不调**，几万段在几秒内跑完，
 * 所以可以挂在 cron 上按天跑、也可以随手跑；模型要做的事全在派生任务里
 * （`derive.ts`），它只盯着「哪些段还没派生」，同步完自然就有活干。
 *
 * **段按内容认，不按位置认**：`experience.key` 是原始列的摘要，由库自己算
 * （`src/db/schema.ts`）。同步把这一次的行灌进一张同结构的暂存表，暂存表里的键
 * 也是库算的，于是「这一段还在不在」就是两张表按键做差，不用应用代码再算一遍
 * 摘要——两处算法一旦漂开，每次同步都会把整库删了重插，派生结果全部作废，而
 * 且没有任何报错。
 *
 * 一笔事务，所以原子：读者要么看到上一版的人群，要么看到这一版，不会看到删了
 * 一半的中间态。它短，锁不住谁。
 */

import "@tanstack/react-start/server-only";
import { prunePhrases } from "./derive";
import { build, type EmployeeRow, type ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import type { CorpusSession } from "./session";
import { loadSource } from "./sources";

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
				cur_level, hire_date, education_level, school, recruitment)
			 select * from unnest(
				$1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
				$7::text[], $8::text[], $9::date[], $10::text[], $11::text[], $12::text[])`,
			[
				chunk.map((row) => row.emp_id),
				chunk.map((row) => row.name),
				chunk.map((row) => row.cur_dept),
				chunk.map((row) => row.cur_title),
				chunk.map((row) => row.cur_seq_l1),
				chunk.map((row) => row.cur_seq_l2),
				chunk.map((row) => row.cur_seq_l3),
				chunk.map((row) => row.cur_level),
				chunk.map((row) => row.hire_date),
				chunk.map((row) => row.education_level),
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
	 * `including generated`：暂存表的 key 和正式表用同一个表达式，由库算。
	 * `including defaults`：派生那一半的列这里不写，靠默认值站住 not null。
	 * id 是正式表发的号，暂存表里没有它。
	 */
	await client.query(
		"create temp table staged_experience (like experience including generated including defaults) on commit drop",
	);
	await client.query("alter table staged_experience drop column id");
	for (const chunk of chunked(rows, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_experience (
				emp_id, kind, start_date, end_date, org, org_path, org_meta, title,
				seq_l1, seq_l2, seq_l3, level, description, months)
			 select * from unnest(
				$1::text[], $2::text[], $3::date[], $4::date[], $5::text[], $6::text[],
				$7::jsonb[], $8::text[], $9::text[], $10::text[], $11::text[],
				$12::text[], $13::text[], $14::int[])`,
			[
				chunk.map((r) => r.emp_id),
				chunk.map((r) => r.kind),
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
	"emp_id, name, cur_dept, cur_title, cur_seq_l1, cur_seq_l2, cur_seq_l3, cur_level, hire_date, education_level, school, recruitment";
const EXPERIENCE_COLUMNS =
	"emp_id, kind, start_date, end_date, org, org_path, org_meta, title, seq_l1, seq_l2, seq_l3, level, description, months";

/**
 * 把暂存的两张表和正式表做差：删这次没有的，插这次新来的，改了档案的人更新。
 * 段走了边跟着级联走，于是收尾清一次没人指的说法（`prunePhrases`）。
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
		"delete from experience where key not in (select key from staged_experience)",
	);
	const experienceNew = await client.query(
		`insert into experience (${EXPERIENCE_COLUMNS})
		 select ${EXPERIENCE_COLUMNS} from staged_experience s
		 where not exists (select 1 from experience e where e.key = s.key)`,
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
 * 幂等，可反复跑：同一份数据跑两遍，第二遍一行都不动。连接与锁由调用方给
 * （`session.ts`），说过的话交给 `report`。
 */
export async function sync(
	session: CorpusSession,
	sourceName: string,
	report: Report,
): Promise<void> {
	report(`读取数据源 ${sourceName}…`);
	const source = await loadSource(sourceName);
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
		`  employee ${employee.length} 人，其中离开 ${counts.employeesGone} 人；` +
			`experience ${experience.length} 段，新来 ${counts.experienceNew} 段、` +
			`离开 ${counts.experienceGone} 段`,
	);
}
