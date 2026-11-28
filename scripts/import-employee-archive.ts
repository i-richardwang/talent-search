/** 在已恢复的旧库副本上运行。来源 schema 只读，目标为空且已由 db:push 建好。 */
import type { PoolClient } from "pg";
import { corpusTransaction } from "#/corpus/session";
import { pool } from "#/db";
import { upgradePersonQueries } from "./upgrade-person-queries";

function ident(name: string) {
	return `"${name.replaceAll('"', '""')}"`;
}

type Column = { column_name: string; is_identity: string };
async function columns(client: PoolClient, schema: string, table: string) {
	const { rows } = await client.query<Column>(
		"select column_name,is_identity from information_schema.columns where table_schema=$1 and table_name=$2 and is_generated='NEVER' order by ordinal_position",
		[schema, table],
	);
	if (!rows.length) throw new Error(`缺少表 ${schema}.${table}`);
	return rows;
}

const commonBefore = [
	"auth_user",
	"account_scope",
	"auth_session",
	"auth_account",
	"auth_verification",
	"sequence_catalog",
	"record_stream",
	"scale",
	"industry",
	"company",
	"company_alias",
	"term",
	"review_word",
	"embedding_cache",
	"completion_cache",
	"derive_schedule",
	"task_run",
	"search_turn",
];
const commonAfter = [
	"phrase",
	"experience_phrase",
	"experience_next",
	"experience_phrase_next",
	"derive_request",
];

async function importEmployeeArchive(archive: string) {
	if (!/^[a-z_][a-z_0-9]{0,62}$/.test(archive))
		throw new Error("无效的源 schema 名");
	return corpusTransaction(async (c) => {
		const target =
			(await c.query<{ name: string }>("select current_schema() as name"))
				.rows[0]?.name ?? "";
		if (!target || target === archive)
			throw new Error("目标库必须使用独立的空 schema");
		const src = ident(archive);
		const tables = await c.query<{ name: string }>(
			"select table_name as name from information_schema.tables where table_schema=$1 and table_type='BASE TABLE'",
			[target],
		);
		for (const { name } of tables.rows) {
			const used = await c.query(
				`select 1 from ${ident(target)}.${ident(name)} limit 1`,
			);
			if (used.rowCount) throw new Error(`目标表 ${name} 已有数据`);
		}
		const sequences: { table: string; column: string }[] = [];
		async function copy(
			table: string,
			source = table,
			from = "",
			replace: Record<string, string> = {},
		) {
			const cols = await columns(c, target, table);
			const select = cols.map(
				({ column_name: n }) => replace[n] ?? `s.${ident(n)}`,
			);
			for (const col of cols)
				if (col.is_identity === "YES")
					sequences.push({ table, column: col.column_name });
			return c.query(`insert into ${ident(target)}.${ident(table)}(${cols.map((v) => ident(v.column_name)).join(",")}) overriding system value
				select ${select.join(",")} from ${src}.${ident(source)} s ${from}`);
		}
		for (const table of commonBefore) await copy(table);
		const queries = await upgradePersonQueries(c);
		await c.query(`create temp table archive_person on commit drop as select emp_id,gen_random_uuid()::text as person_id from
			(select emp_id from ${src}.employee union select emp_id from ${src}.audit_event where emp_id is not null) u`);
		await c.query("create unique index on archive_person(emp_id)");
		const linked = "join archive_person m using(emp_id)";
		const people = await copy("person", "employee", linked, {
			person_id: "m.person_id",
		});
		await copy("employment", "employee", linked, { person_id: "m.person_id" });
		await c.query(
			"insert into person_identity(person_id,kind,value) select person_id,'emp_id',emp_id from employment",
		);
		await c.query(
			"insert into profile_source(source_kind,person_id) select 'hris',person_id from person",
		);
		const work = await copy("experience", "experience", linked, {
			person_id: "m.person_id",
		});
		await c.query(
			"insert into profile_experience(profile_id,person_id,experience_id) select f.id,e.person_id,e.id from experience e join profile_source f using(person_id) where f.source_kind='hris'",
		);
		await copy("employee_record", "employee_record", linked, {
			person_id: "m.person_id",
		});
		for (const table of commonAfter) await copy(table);
		await copy(
			"experience_verdict",
			"experience_verdict",
			`left join ${src}.experience old on old.content_key=left(s.content,32) left join experience e on e.id=old.id`,
			{ content: "coalesce(e.content_key||substr(s.content,33),s.content)" },
		);
		const audits = await copy(
			"audit_event",
			"audit_event",
			"left join archive_person m using(emp_id)",
			{ person_id: "m.person_id" },
		);
		for (const { table, column } of sequences) {
			await c.query(
				`select setval(pg_get_serial_sequence($1,$2),coalesce(max(${ident(column)}),1),count(*)>0) from ${ident(table)}`,
				[`${target}.${table}`, column],
			);
		}
		return {
			queries,
			people: people.rowCount,
			experiences: work.rowCount,
			audits: audits.rowCount,
		};
	});
}
if (import.meta.main) {
	try {
		const source = process.argv[2];
		if (!source)
			throw new Error("用法：bun run db:import-employees 旧库的只读源schema");
		console.log(await importEmployeeArchive(source));
	} finally {
		await pool.end();
	}
}
