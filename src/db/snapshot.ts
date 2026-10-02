import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool } from ".";
import { GLOSSED_ROUTES } from "./schema";

/** 应用查询与事务共享的最小数据库能力。 */
export type DbExecutor = Pick<typeof db, "execute" | "select">;

/** 在一个只读、可重复读的 PostgreSQL 快照里完成多条原生查询。 */
export async function withReadSnapshot<T>(
	read: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await pool.connect();
	let discard = true;
	try {
		await client.query(
			"begin transaction isolation level repeatable read read only",
		);
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
 * 在可重复读快照中核验语料标准与空间身份，再读取事实。
 * 已派生段和当前短说法的释义各自只能有一份标准；空版本表示未派生。
 * 模型调用在快照外完成，调用方以空间行版本核对嵌入与召回依据。
 */
export function withCorpusSnapshot<T>(
	read: (store: DbExecutor, generation: string) => Promise<T>,
): Promise<T> {
	return db.transaction(
		async (store) => {
			const rows = await store.execute<{ generation: string }>(
				sql`select space_id || ':' || xmin::text as generation from embedding_space`,
			);
			const [row] = rows.rows;
			if (!row || rows.rows.length !== 1)
				throw new Error("语料还没有派生过：先跑 bun run sync，派生会接上");
			const standards = await store.execute<{
				derived: boolean;
				glossed: boolean;
			}>(sql`
				select
					(select count(distinct derived_identity) > 1 from experience) as derived,
					(select count(distinct g.guide_identity) > 1
					 from phrase_gloss g join phrase p on p.text = g.text
					 where exists (select 1 from experience_phrase ep
					   where ep.phrase_id = p.id and ep.route in (${sql.join(
								GLOSSED_ROUTES.map((route) => sql`${route}`),
								sql`, `,
							)}))) as glossed`);
			if (standards.rows[0]?.derived || standards.rows[0]?.glossed)
				throw new Error("人才库正在更新判定标准，请等待派生与整理完成后重试");
			return read(store, row.generation);
		},
		{ isolationLevel: "repeatable read" },
	);
}
