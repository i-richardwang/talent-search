/**
 * 读取数据源，经 pipeline.ts 校验、切段后，在一笔短事务中同步人员、经历、记录与公司知识。
 * 正式表与暂存表共用数据库生成的 content_key：删除消失的段，插入新增段，
 * 同内容的段刷新累计月数并保留 id、边和解析版本。记录和公司知识没有解析产物，整表重写。
 * 同步不调用模型。
 */

import "@tanstack/react-start/server-only";
import { contactKeys } from "#/identity/contacts";
import type { SourceEmployee, SyncPart } from "./contract";
import { prunePhrases } from "./phrases";
import {
	build,
	type CompanyAliasRow,
	type CompanyRow,
	type EmployeeRow,
	type ExperienceRow,
	type IndustryRow,
	type RecordRow,
	type ScaleRow,
	type StreamRow,
} from "./pipeline";
import type { Report } from "./report";
import type { CorpusSession } from "./session";
import { loadSource, type SourceConfig } from "./sources";

const ROWS_PER_STATEMENT = 5_000;

function* chunked<T>(rows: T[], size: number): Generator<T[]> {
	for (let start = 0; start < rows.length; start += size)
		yield rows.slice(start, start + size);
}

/** 一次解析整批工号与已确认的跨源关联，人员和雇佣关系各按自己的表结构暂存。 */
async function stageEmployees({ client }: CorpusSession, rows: EmployeeRow[]) {
	await client.query(
		"create temp table staged_person (like person including generated, emp_id text primary key, linked_person_id text) on commit drop",
	);
	await client.query(
		"create temp table staged_employment (like employment including generated) on commit drop",
	);
	for (const chunk of chunked(rows, ROWS_PER_STATEMENT)) {
		const params = [JSON.stringify(chunk)];
		await client.query(
			`insert into staged_person(person_id, emp_id, linked_person_id, ${BIO_COLUMNS})
			select coalesce(i.person_id,r.linked_person_id,gen_random_uuid()::text),r.emp_id,r.linked_person_id,${BIO_COLUMNS}
			from jsonb_populate_recordset(null::staged_person,$1) r left join person_identity i on i.kind='emp_id' and i.value=r.emp_id`,
			params,
		);
		await client.query(
			`insert into staged_employment(person_id,${JOB_COLUMNS})
			select s.person_id, ${JOB_COLUMNS} from jsonb_populate_recordset(null::employment,$1) r
			join staged_person s using(emp_id)`,
			params,
		);
	}
	const duplicate = await client.query(
		"select 1 from staged_person group by person_id having count(*)>1 limit 1",
	);
	if (duplicate.rowCount)
		throw new Error("同一批人事数据中的多个工号关联了同一个人员编号");
	const occupied = await client.query(
		"select 1 from staged_person s join employment e using(person_id) where s.emp_id<>e.emp_id limit 1",
	);
	if (occupied.rowCount) throw new Error("关联的人员编号已绑定其他在职工号");
	const invalid =
		await client.query(`select 1 from staged_person s left join person p on p.person_id=s.linked_person_id
		where s.linked_person_id is not null and (p.person_id is null or s.person_id<>s.linked_person_id) limit 1`);
	if (invalid.rowCount)
		throw new Error("人事源的已确认人员关联无效或与现有工号冲突");
}

async function stageExperience(
	{ client }: CorpusSession,
	rows: ExperienceRow[],
): Promise<void> {
	/*
	 * `including generated`：暂存表的内容键和正式表用同一个表达式，由库算。
	 * `including defaults`：解析那一半的列这里不写，靠默认值满足 not null。
	 * id 是正式表发的号，暂存表里没有它。
	 */
	await client.query(
		"create temp table staged_experience (like experience including generated including defaults) on commit drop",
	);
	await client.query("alter table staged_experience drop column id");
	for (const chunk of chunked(rows, ROWS_PER_STATEMENT))
		await client.query(
			`insert into staged_experience (
				person_id, kind, unemployed, start_date, end_date, company, department, department_path, company_meta,
				title, seq_l1, seq_l2, seq_l3, level, description, months)
			 select s.person_id, r.kind, r.unemployed, r.start_date, r.end_date, r.company, r.department,
				r.department_path, r.company_meta, r.title, r.seq_l1, r.seq_l2, r.seq_l3, r.level, r.description, r.months
			 from unnest(
				$1::text[], $2::text[], $3::boolean[], $4::date[], $5::date[], $6::text[], $7::text[],
				$8::text[], $9::jsonb[], $10::text[], $11::text[], $12::text[], $13::text[],
				$14::text[], $15::text[], $16::int[]) r(emp_id, kind, unemployed, start_date, end_date, company, department, department_path,
				company_meta, title, seq_l1, seq_l2, seq_l3, level, description, months)
			 join staged_person s using(emp_id)`,
			[
				chunk.map((r) => r.emp_id),
				chunk.map((r) => r.kind),
				chunk.map((r) => r.unemployed),
				chunk.map((r) => r.start_date),
				chunk.map((r) => r.end_date),
				chunk.map((r) => r.company),
				chunk.map((r) => r.department),
				chunk.map((r) => r.department_path),
				chunk.map((r) => r.company_meta && JSON.stringify(r.company_meta)),
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

const BIO_COLUMNS =
	"name, education_level, education_rank, school, school_tier, overseas_educated";
const JOB_COLUMNS =
	"emp_id, cur_dept, cur_dept_path, cur_title, cur_seq_l1, cur_seq_l2, cur_seq_l3, cur_level, cur_level_band, cur_level_rank, hire_date, recruitment";
const EXPERIENCE_COLUMNS =
	"person_id, kind, unemployed, start_date, end_date, company, department, department_path, company_meta, title, seq_l1, seq_l2, seq_l3, level, description, months";

/**
 * 把暂存的两张表和正式表做差：删这次没有的，插这次新来的，改了档案的人更新。
 * 段删掉时边跟着级联删除，于是收尾清一次没有边指向的说法（`prunePhrases`）。
 */
async function reconcile({ client }: CorpusSession): Promise<{
	employeesGone: number;
	experienceGone: number;
	experienceNew: number;
}> {
	for (const [table, columns] of [
		["person", BIO_COLUMNS],
		["employment", JOB_COLUMNS],
	] as const) {
		await client.query(`insert into ${table}(person_id,${columns}) select person_id,${columns} from staged_${table}
			on conflict(person_id) do update set (${columns})=(${columns
				.split(", ")
				.map((c) => `excluded.${c}`)
				.join(",")})`);
	}
	await client.query(
		`insert into person_identity(kind,value,person_id) select 'emp_id',emp_id,person_id from staged_person on conflict do nothing`,
	);
	await client.query(
		`insert into profile_source(person_id,source_kind) select person_id,'hris' from staged_person
			on conflict(person_id) where source_kind='hris' do nothing`,
	);
	const employeesGone = await client.query(
		"delete from employment e where not exists(select from staged_person s where s.person_id=e.person_id)",
	);
	await client.query(
		"delete from profile_source f where f.source_kind='hris' and not exists(select from staged_person s where s.person_id=f.person_id)",
	);
	await client.query(`delete from profile_experience pe using profile_source f,experience e
		where f.id=pe.profile_id and f.source_kind='hris' and e.id=pe.experience_id
		and not exists(select from staged_experience s where s.content_key=e.content_key)`);
	await client.query(
		`update experience e set months = s.months
		 from staged_experience s where e.content_key = s.content_key and e.months <> s.months`,
	);
	const experienceNew = await client.query(
		`insert into experience (${EXPERIENCE_COLUMNS})
		 select ${EXPERIENCE_COLUMNS} from staged_experience s
		 where not exists (select 1 from experience e where e.content_key = s.content_key)`,
	);
	await client.query(`insert into profile_experience(profile_id,person_id,experience_id)
		select f.id,s.person_id,e.id from staged_experience s join experience e using(content_key)
		join profile_source f on f.person_id=s.person_id and f.source_kind='hris' on conflict do nothing`);
	const experienceGone = await client.query(
		"delete from experience e where not exists(select from profile_experience pe where pe.experience_id=e.id)",
	);
	await client.query(`delete from person p where not exists(select from profile_source s where s.person_id=p.person_id)
		and not exists(select from pool_member m where m.person_id=p.person_id)`);
	await prunePhrases(client);
	return {
		employeesGone: employeesGone.rowCount ?? 0,
		experienceGone: experienceGone.rowCount ?? 0,
		experienceNew: experienceNew.rowCount ?? 0,
	};
}

/** 记录流、档位表与记录照这一次的写；在人员之后写，记录的外键指向本次的人。 */
async function replaceRecords(
	{ client }: CorpusSession,
	streams: StreamRow[],
	scale: ScaleRow[],
	records: RecordRow[],
): Promise<void> {
	await client.query("delete from employee_record");
	await client.query("delete from record_stream");
	await client.query("delete from scale");
	await client.query(
		`insert into record_stream (stream, kind, label, period, notes)
		 select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
		[
			streams.map((r) => r.stream),
			streams.map((r) => r.kind),
			streams.map((r) => r.label),
			streams.map((r) => r.period),
			streams.map((r) => r.notes),
		],
	);
	await client.query(
		`insert into scale (stream, value, rank)
		 select * from unnest($1::text[], $2::text[], $3::int[])`,
		[
			scale.map((r) => r.stream),
			scale.map((r) => r.value),
			scale.map((r) => r.rank),
		],
	);
	for (const chunk of chunked(records, ROWS_PER_STATEMENT))
		await client.query(
			`insert into employee_record (person_id, stream, period_start, period_end, value)
			 select e.person_id,r.stream,r.start,r.finish,r.value from unnest($1::text[], $2::text[], $3::date[], $4::date[], $5::text[]) r(emp_id,stream,start,finish,value) join staged_person e using(emp_id)`,
			[
				chunk.map((r) => r.emp_id),
				chunk.map((r) => r.stream),
				chunk.map((r) => r.period_start),
				chunk.map((r) => r.period_end),
				chunk.map((r) => r.value),
			],
		);
}

/**
 * 行业树、公司和公司写法照这一次的写。经历上不存公司是什么，所以公司知识变了不动任何一段
 * 经历的身份和解析结果。数组逐行以 JSON 送入：`unnest` 会把二维数组摊平。
 */
async function replaceCompanies(
	{ client }: CorpusSession,
	industries: IndustryRow[],
	companies: CompanyRow[],
	aliases: CompanyAliasRow[],
): Promise<void> {
	await client.query("delete from company_alias");
	await client.query("delete from company");
	await client.query("delete from industry");
	await client.query(
		`insert into industry (name, parent)
		 select * from unnest($1::text[], $2::text[])`,
		[industries.map((r) => r.name), industries.map((r) => r.parent)],
	);
	const texts = (column: string) =>
		`array(select jsonb_array_elements_text(r -> '${column}'))`;
	for (const chunk of chunked(companies, ROWS_PER_STATEMENT))
		await client.query(
			`insert into company (name, group_name, industries, main_industries, circles)
			 select r ->> 'name', r ->> 'group_name', ${texts("industries")},
				${texts("main_industries")}, ${texts("circles")}
			 from unnest($1::jsonb[]) as r`,
			[chunk.map((r) => JSON.stringify(r))],
		);
	for (const chunk of chunked(aliases, ROWS_PER_STATEMENT))
		await client.query(
			`insert into company_alias (raw_name, company)
			 select * from unnest($1::text[], $2::text[])`,
			[chunk.map((r) => r.raw_name), chunk.map((r) => r.company)],
		);
}

async function replaceHrisContacts(
	{ client }: CorpusSession,
	profiles: SourceEmployee[],
) {
	await client.query(
		"delete from person_identity where origin='hris' and kind in ('phone','email')",
	);
	for (const batch of chunked(
		profiles.filter((p) => p.phone || p.email),
		ROWS_PER_STATEMENT,
	)) {
		const keys = batch.flatMap((p) =>
			contactKeys({ phone: p.phone ?? "", email: p.email ?? "" }).map((k) => ({
				...k,
				emp_id: p.emp_id.trim(),
			})),
		);
		await client.query(
			`insert into person_identity(person_id,kind,value,origin)
			select s.person_id,k.kind,k.value,'hris' from jsonb_to_recordset($1) k(emp_id text,kind text,value text)
			join staged_person s using(emp_id) on conflict do nothing`,
			[JSON.stringify(keys)],
		);
	}
}

/**
 * 同内容的段保留身份，累计月数按本次日期刷新。连接与锁由调用方给（`session.ts`）。
 */
export async function sync(
	session: CorpusSession,
	sourceConfig: SourceConfig,
	report: Report,
	part: SyncPart = "all",
): Promise<void> {
	report(`读取数据源 ${sourceConfig.name}…`);
	const source = await loadSource(sourceConfig);
	const data = await source.extract(report, part);

	report("");
	report("切段与校验…");
	const {
		employee,
		experience,
		streams,
		scale,
		records,
		industries,
		companies,
		companyAliases,
	} = build(data, report);

	report("");
	report("写入…");
	const { client } = session;
	await client.query("begin");
	let counts: Awaited<ReturnType<typeof reconcile>> | undefined;
	try {
		if (part !== "knowledge") {
			await stageEmployees(session, employee);
			await stageExperience(session, experience);
			counts = await reconcile(session);
			await replaceHrisContacts(session, data.employees);
			await replaceRecords(session, streams, scale, records);
		}
		if (part !== "people") {
			await client.query("delete from sequence_catalog");
			await client.query(
				`insert into sequence_catalog (seq_l1, seq_l2)
			 select * from unnest($1::text[], $2::text[])`,
				[
					data.sequences.map((row) => row.seq_l1.trim()),
					data.sequences.map((row) => row.seq_l2.trim()),
				],
			);
			await replaceCompanies(session, industries, companies, companyAliases);
		}

		await client.query("commit");
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
	if (part !== "people") report(`  现行岗位序列 ${data.sequences.length} 对`);
	if (counts)
		report(
			`  人员 ${employee.length} 人，其中离开 ${counts.employeesGone} 人；` +
				`经历 ${experience.length} 段，新增 ${counts.experienceNew} 段、` +
				`离开 ${counts.experienceGone} 段`,
		);
}
