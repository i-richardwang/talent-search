import "@tanstack/react-start/server-only";
import { type SQL, sql } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import { db, pool } from ".";
import { catalogSchema } from "./catalog-schema";
import { SCOPED_TABLES } from "./schema";

/** 应用查询与事务共享的最小数据库能力。 */
export type DbExecutor = Pick<typeof db, "execute" | "select">;

/**
 * 这一次读取替谁读，决定读得到哪些人（`schema.ts` 的 `VISIBLE`）。
 *
 * - 一个账号：它的数据范围。
 * - 一次找人任务（链头的 id）：发起它的账号此刻的数据范围。名单、查询理解的工具、
 *   读经历都按它，后台处理也一样；链不存在时一个人都没有。
 * - 全部：命令行、验收，和管理员管整个系统的页面（任务、审计、账号）。
 */
export type Scope = "all" | { account: string } | { chain: string };

/** 一份查询替谁读：属于一次找人任务的按那次任务，不属于任何任务的（命令行、验收）读全部。 */
export const chainScope = (rootTurnId: string | null): Scope =>
	rootTurnId === null ? "all" : { chain: rootTurnId };

/** 读者角色：人员、经历、记录、边四张表的读取策略约束它。表的属主（写入方）不受约束。 */
const READER_ROLE = "talent_reader";

const dialect = new PgDialect();

let provisioned: Promise<void> | null = null;

/**
 * 读者角色和它的授权：没有就建，当前 schema 和数据目录里的表与视图都给 SELECT，应用角色要能
 * 切过去。四张带人的表的读取策略照 `schema.ts` 改上条件：db:push 建策略时不带条件，也不比较
 * 条件。表没开行级安全（还没 db:push）就不读。每个进程第一次读之前做一次，部署不另设一步；
 * 之后新建的表靠默认授权。几个进程同时做时用 advisory lock 排队。
 */
async function ensureReader(): Promise<void> {
	const client = await pool.connect();
	try {
		await client.query("begin");
		await client.query("select pg_advisory_xact_lock(hashtext($1))", [
			READER_ROLE,
		]);
		await client.query(`do $$ begin
			if not exists (select from pg_roles where rolname = '${READER_ROLE}') then
				create role ${READER_ROLE} nologin noinherit nosuperuser nocreatedb nocreaterole;
			end if;
		end $$`);
		const { rows } = await client.query<{ schema: string }>(
			"select current_schema() as schema",
		);
		const own = rows[0]?.schema;
		if (!own) throw new Error("连接没有当前 schema");
		for (const schema of [own, catalogSchema()]) {
			const name = `"${schema.replaceAll('"', '""')}"`;
			await client.query(`grant usage on schema ${name} to ${READER_ROLE}`);
			await client.query(
				`grant select on all tables in schema ${name} to ${READER_ROLE}`,
			);
			await client.query(
				`alter default privileges in schema ${name} grant select on tables to ${READER_ROLE}`,
			);
		}
		for (const table of SCOPED_TABLES) {
			const { name, policies } = getTableConfig(table);
			const secured = await client.query<{ on: boolean }>(
				"select relrowsecurity as on from pg_class where oid = to_regclass($1)",
				[`"${name}"`],
			);
			if (!secured.rows[0]?.on)
				throw new Error(`${name} 没有开启行级安全，先运行 db:push`);
			for (const policy of policies) {
				if (!policy.using) throw new Error(`读取策略 ${policy.name} 没有条件`);
				const { sql: using } = dialect.sqlToQuery(policy.using);
				await client.query(
					`alter policy "${policy.name}" on "${name}" using (${using})`,
				);
			}
		}
		const member = await client.query<{ ok: boolean }>(
			`select pg_has_role(current_user, '${READER_ROLE}', 'SET') as ok`,
		);
		if (!member.rows[0]?.ok)
			await client.query(`grant ${READER_ROLE} to current_user`);
		await client.query("commit");
	} catch (error) {
		await client.query("rollback").catch(() => {});
		throw error;
	} finally {
		client.release();
	}
}

/** 每个进程第一次读之前建好、授权；失败了下次再试。 */
function provision(): Promise<void> {
	provisioned ??= ensureReader().catch((error) => {
		provisioned = null;
		throw error;
	});
	return provisioned;
}

/** 声明这个事务替谁读，再切到读者角色。两样都只在这个事务里有效。 */
function declare(scope: Scope): SQL[] {
	const who =
		scope === "all"
			? sql`'*'`
			: "account" in scope
				? sql`${scope.account}`
				: sql`coalesce((select owner_id from search_turn where id = ${scope.chain}), '')`;
	return [
		sql`select set_config('talent.scope', ${who}, true)`,
		sql.raw(`set local role ${READER_ROLE}`),
	];
}

/** 在一个只读、可重复读的 PostgreSQL 快照里，替 `scope` 完成多条原生查询。 */
export async function withReadSnapshot<T>(
	scope: Scope,
	read: (client: PoolClient) => Promise<T>,
): Promise<T> {
	await provision();
	const client = await pool.connect();
	let discard = true;
	try {
		await client.query(
			"begin transaction isolation level repeatable read read only",
		);
		for (const statement of declare(scope)) {
			const { sql: text, params } = dialect.sqlToQuery(statement);
			await client.query(text, params);
		}
		const value = await read(client);
		await client.query("commit");
		discard = false;
		return value;
	} catch (error) {
		try {
			await client.query("rollback");
			discard = false;
		} catch {
			// 事务收尾失败的连接不能回池。
		}
		throw error;
	} finally {
		client.release(discard);
	}
}

/**
 * 在可重复读快照中核验语料标准，再替 `scope` 读取事实。
 * 已解析段只能有一份标准；空版本表示还没解析。模型调用在快照外完成。
 */
export async function withCorpusSnapshot<T>(
	scope: Scope,
	read: (store: DbExecutor) => Promise<T>,
): Promise<T> {
	await provision();
	return db.transaction(
		async (store) => {
			// 标准是整个语料的事，在切到读者角色之前看全部
			const standards = await store.execute<{ mixed: boolean }>(
				sql`select count(distinct derived_identity) > 1 as mixed from experience`,
			);
			if (standards.rows[0]?.mixed)
				throw new Error("人才库正在更新判定标准，请等待解析完成后重试");
			for (const statement of declare(scope)) await store.execute(statement);
			return read(store);
		},
		{ isolationLevel: "repeatable read" },
	);
}
