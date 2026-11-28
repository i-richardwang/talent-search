/** 测试和模型验收各自使用独立的空语料库，表与视图取自应用 schema。 */
import type { SQL } from "drizzle-orm";
import {
	getTableConfig,
	getViewConfig,
	PgDialect,
	type PgTable,
} from "drizzle-orm/pg-core";
import { Client } from "pg";
import {
	accountScope,
	auditEvent,
	authAccount,
	authSession,
	authUser,
	authVerification,
	CATALOG_VIEWS,
	company,
	companyAlias,
	completionCache,
	deriveRequest,
	deriveSchedule,
	embeddingCache,
	employeeRecord,
	employment,
	experience,
	experienceNext,
	experiencePhrase,
	experiencePhraseNext,
	experienceVerdict,
	industry,
	person,
	personCard,
	personIdentity,
	phrase,
	poolMember,
	poolTouch,
	profileExperience,
	profileSource,
	recordStream,
	resumeFile,
	resumeImport,
	reviewWord,
	SCOPED_TABLES,
	scale,
	scopeMember,
	searchTurn,
	sequenceCatalog,
	talentPool,
	taskRun,
	term,
	termInUse,
	visibleEmployment,
	visiblePool,
	visibleProfile,
	visibleSegment,
} from "#/db/schema";
import { catalogOf, tempSchema } from "./schema-name";

/** Postgres 把更长的名字静默截短；截短后和 schema 里的名字对不上，db:push 每次都会删了重建。 */
const NAME_MAX_BYTES = 63;

function ddl(schema: string, table: PgTable) {
	const {
		name,
		columns,
		checks,
		foreignKeys,
		indexes,
		uniqueConstraints,
		primaryKeys,
	} = getTableConfig(table);
	for (const named of [
		...checks.map((c) => c.name),
		...foreignKeys.map((f) => f.getName()),
		...indexes.map((i) => i.config.name ?? ""),
		...uniqueConstraints.map((u) => u.getName() ?? ""),
	])
		if (Buffer.byteLength(named) > NAME_MAX_BYTES)
			throw new Error(
				`${name} 的约束或索引名超过 ${NAME_MAX_BYTES} 字节：${named}`,
			);
	const dialect = new PgDialect();
	const cols = columns.map((c) => {
		const parts = [`"${c.name}"`, c.getSQLType()];
		if (c.primary) parts.push("primary key");
		// 约束名照 drizzle 的默认（`<表>_<列>_unique`），测试才能按名字识别它
		if (c.isUnique)
			parts.push(
				`constraint "${c.uniqueName ?? `${name}_${c.name}_unique`}" unique`,
			);
		if (c.notNull && !c.primary) parts.push("not null");
		if (c.generatedIdentity)
			parts.push(
				`generated ${c.generatedIdentity.type === "always" ? "always" : "by default"} as identity`,
			);
		if (c.generated) {
			// 库自己算的列（experience.content_key）。表达式是 SQL 或字符串，照 drizzle 的形态取
			const as =
				typeof c.generated.as === "function"
					? c.generated.as()
					: c.generated.as;
			const expression =
				typeof as === "string" ? as : dialect.sqlToQuery(as as SQL).sql;
			parts.push(`generated always as (${expression}) stored`);
		}
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
	for (const pk of primaryKeys) {
		const cols = pk.columns.map((c) => `"${c.name}"`).join(", ");
		constraints.push(`primary key (${cols})`);
	}
	// 表级 unique（列上那些由 `c.isUnique` 建）
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
			`constraint "${foreignKey.getName()}" foreign key (${local}) references ${schema}."${foreignName}" (${foreign}) on delete ${foreignKey.onDelete ?? "no action"}`,
		);
	}
	return `create table ${schema}."${name}" (${[...cols, ...constraints].join(", ")})`;
}

export async function isolatedDatabase(base: string) {
	const schema = tempSchema();
	const catalog = catalogOf(schema);
	const connection = new Client({ connectionString: base });
	await connection.connect();
	try {
		await connection.query("begin");
		await connection.query(`create schema ${schema}`);
		await connection.query(`create schema ${catalog}`);
		await connection.query(`set local search_path to ${schema}, public`);
		for (const t of [
			authUser,
			accountScope,
			authSession,
			authAccount,
			authVerification,
			person,
			personIdentity,
			employment,
			talentPool,
			poolMember,
			poolTouch,
			resumeFile,
			profileSource,
			experience,
			profileExperience,
			resumeImport,
			sequenceCatalog,
			phrase,
			experiencePhrase,
			experienceNext,
			experiencePhraseNext,
			searchTurn,
			experienceVerdict,
			auditEvent,
			term,
			reviewWord,
			embeddingCache,
			completionCache,
			deriveRequest,
			deriveSchedule,
			taskRun,
			recordStream,
			scale,
			employeeRecord,
			industry,
			company,
			companyAlias,
		])
			await connection.query(ddl(schema, t));
		const dialect = new PgDialect();
		// 先建公共视图，读取策略和目录随后使用它们。
		for (const view of [
			scopeMember,
			visibleEmployment,
			visiblePool,
			visibleProfile,
			visibleSegment,
			personCard,
		]) {
			const { name, query } = getViewConfig(view);
			if (!query) throw new Error(`视图 ${name} 没有定义`);
			await connection.query(
				`create view ${schema}."${name}" as ${dialect.sqlToQuery(query).sql}`,
			);
		}
		// 读取策略照 db:push 的样子建，不带条件：条件由 `db/snapshot.ts` 在第一次读之前写上，
		// 和生产走同一条路
		for (const t of SCOPED_TABLES) {
			const { name, policies } = getTableConfig(t);
			await connection.query(
				`alter table ${schema}."${name}" enable row level security`,
			);
			for (const p of policies)
				await connection.query(
					`create policy "${p.name}" on ${schema}."${name}" for ${p.for} to ${String(p.to)}`,
				);
		}
		for (const view of CATALOG_VIEWS) {
			const { name, query } = getViewConfig(view);
			if (!query) throw new Error(`目录视图 ${name} 没有定义`);
			await connection.query(
				`create view ${catalog}."${name}" as ${dialect.sqlToQuery(query).sql}`,
			);
		}
		// 现在用着的词不在数据目录里，和表建在同一个 schema
		const inUse = getViewConfig(termInUse);
		if (!inUse.query) throw new Error(`视图 ${inUse.name} 没有定义`);
		const invoker = inUse.with?.securityInvoker
			? " with (security_invoker = true)"
			: "";
		await connection.query(
			`create view ${schema}."${inUse.name}"${invoker} as ${dialect.sqlToQuery(inUse.query).sql}`,
		);
		await connection.query("commit");
	} finally {
		await connection.end();
	}
	const url = new URL(base);
	url.searchParams.set("options", `-c search_path=${schema},public`);
	return {
		url: url.toString(),
		catalog,
		async close() {
			const cleanup = new Client({ connectionString: base });
			await cleanup.connect();
			try {
				await cleanup.query(`drop schema ${catalog}, ${schema} cascade`);
			} finally {
				await cleanup.end();
			}
		},
	};
}

/** CLI 在设置独立连接之后才加载应用的数据库单例。 */
export async function withEvaluation<T>(
	work: (corpus: typeof import("./corpus")) => Promise<T>,
) {
	const base = process.env.DATABASE_URL;
	if (!base) throw new Error("模型验收需要 DATABASE_URL");
	const isolated = await isolatedDatabase(base);
	process.env.DATABASE_URL = isolated.url;
	process.env.TALENT_CATALOG_SCHEMA = isolated.catalog;
	process.env.TALENT_SOURCE = "csv-dir";
	process.env.TALENT_CSV_DIR = "src/corpus/sources/sample";
	process.env.DERIVE_MODE = "model";
	try {
		return await work(await import("./corpus"));
	} finally {
		try {
			await (await import("#/db")).pool.end();
		} finally {
			await isolated.close();
		}
	}
}
