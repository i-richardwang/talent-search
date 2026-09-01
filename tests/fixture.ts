/**
 * 检索的集成测试跑在一个临时 schema 上：真 Postgres、真 SQL，但不碰人才库。
 *
 * 建表语句由 schema.ts 现场推导，不手抄——加一列而忘了同步测试夹具这件事，
 * 在这里不可能发生。索引一概不建：夹具只有十几行，全表扫比建索引快，
 * 而索引不参与被测的语义。
 */
import type { SQL } from "drizzle-orm";
import { getTableConfig, PgDialect, type PgTable } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import { employee, experience, searchTurn } from "#/db/schema";

const SCHEMA = `talent_test_${process.pid}`;

function ddl(schema: string, table: PgTable) {
	const { name, columns, checks, foreignKeys, uniqueConstraints } =
		getTableConfig(table);
	const dialect = new PgDialect();
	const cols = columns.map((c) => {
		const parts = [`"${c.name}"`, c.getSQLType()];
		if (c.primary) parts.push("primary key");
		if (c.notNull && !c.primary) parts.push("not null");
		if (c.default !== undefined) {
			// 三种形态：字符串字面量、SQL 表达式（defaultNow）、jsonb 的对象默认值
			const d =
				typeof c.default === "string"
					? `'${c.default}'`
					: typeof c.default === "object" && c.default !== null
						? "queryChunks" in c.default
							? dialect.sqlToQuery(c.default as SQL).sql
							: `'${JSON.stringify(c.default)}'`
						: c.default;
			parts.push(`default ${d}`);
		}
		return parts.join(" ");
	});
	const constraints = checks.map((c) => {
		const expression = dialect
			.sqlToQuery(c.value)
			.sql.replaceAll(`"${name}".`, "");
		return `constraint "${c.name}" check (${expression})`;
	});
	// unique 不只是约束：search_turn 的复合外键引用 (id, root_turn_id)，
	// 没有对应的 unique，外键本身就建不起来
	for (const u of uniqueConstraints) {
		const cols = u.columns.map((c) => `"${c.name}"`).join(", ");
		constraints.push(`constraint "${u.name}" unique (${cols})`);
	}
	for (const foreignKey of foreignKeys) {
		const reference = foreignKey.reference();
		const foreignName = getTableConfig(reference.foreignTable).name;
		const local = reference.columns
			.map((column) => `"${column.name}"`)
			.join(", ");
		const foreign = reference.foreignColumns
			.map((column) => `"${column.name}"`)
			.join(", ");
		constraints.push(
			`constraint "${foreignKey.getName()}" foreign key (${local}) references ${schema}."${foreignName}" (${foreign}) on delete ${foreignKey.onDelete}`,
		);
	}
	return `create table ${schema}."${name}" (${[...cols, ...constraints].join(", ")})`;
}

/**
 * 建好临时 schema 并把 DATABASE_URL 指向它，然后才 import 检索模块。
 *
 * `#/db` 是模块级单例，一旦 import 就绑死了连接串——所以顺序不能反，
 * 调用方必须 `await setup()` 之后再动态 import 被测代码。
 */
export async function setup() {
	const base = process.env.DATABASE_URL;
	if (!base)
		throw new Error("DATABASE_URL 未配置，集成测试需要一个本地 Postgres");

	const admin = new Pool({ connectionString: base });
	await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	await admin.query(`create schema ${SCHEMA}`);
	for (const t of [employee, experience, searchTurn])
		await admin.query(ddl(SCHEMA, t));
	await admin.end();

	const url = new URL(base);
	url.searchParams.set("options", `-c search_path=${SCHEMA},public`);
	process.env.DATABASE_URL = url.toString();

	return async function teardown() {
		const { pool } = await import("#/db");
		await pool.end();
		const a = new Pool({ connectionString: base });
		await a.query(`drop schema if exists ${SCHEMA} cascade`);
		await a.end();
	};
}

/** 一个人 + 他的若干段经历。字段用默认值兜底，测试里只写与断言相关的那几个。 */
export type Seed = {
	empId: string;
	name: string;
	segments: Array<{
		kind?: "internal" | "external";
		months: number;
		/** 省略表示至今。近因因子看的就是它。 */
		endDate?: string;
		org?: string;
		orgPath?: string;
		title?: string;
		seqL1?: string;
		seqL2?: string;
		description?: string;
		companyTag?: string;
	}>;
};

export async function seed(rows: Seed[]) {
	const { db } = await import("#/db");
	const { employee: emp, experience: exp } = await import("#/db/schema");
	await db
		.insert(emp)
		.values(rows.map((r) => ({ empId: r.empId, name: r.name })));
	let day = 1;
	await db.insert(exp).values(
		rows.flatMap((r) =>
			r.segments.map((s) => {
				// 起始日只要自洽即可：打分看的是 months 与 endDate，不看它
				const start = `20${String(10 + (day++ % 80)).padStart(2, "0")}-01-01`;
				return {
					empId: r.empId,
					kind: s.kind ?? "internal",
					startDate: start,
					endDate: s.endDate ?? null,
					org: s.org ?? "",
					orgPath: s.orgPath ?? "",
					title: s.title ?? "",
					seqL1: s.seqL1 ?? "",
					seqL2: s.seqL2 ?? "",
					description: s.description ?? "",
					months: s.months,
					orgMeta: s.companyTag
						? {
								company_tag: s.companyTag,
								industry: "",
								nature: "",
							}
						: null,
				};
			}),
		),
	);
}
