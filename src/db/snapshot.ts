import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool } from ".";

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
 * 在可重复读快照中核验语料标准，再读取事实。
 * 已解析段只能有一份标准；空版本表示还没解析。模型调用在快照外完成。
 */
export function withCorpusSnapshot<T>(
	read: (store: DbExecutor) => Promise<T>,
): Promise<T> {
	return db.transaction(
		async (store) => {
			const standards = await store.execute<{ mixed: boolean }>(
				sql`select count(distinct derived_identity) > 1 as mixed from experience`,
			);
			if (standards.rows[0]?.mixed)
				throw new Error("人才库正在更新判定标准，请等待解析完成后重试");
			return read(store);
		},
		{ isolationLevel: "repeatable read" },
	);
}
