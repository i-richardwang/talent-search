/**
 * 同步、派生、整理共用一个会话级 advisory lock；写者独占连接，跨批次短事务持锁。
 * 后台任务拿不到锁就返回，命令行同步排队等待。检索使用自己的数据库快照。
 * 持锁连接的 application_name 标记运行身份，连接断开后锁随之释放。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool } from "#/db";
import type { DbExecutor } from "#/db/snapshot";

/** 语料侧要用的那点数据库能力：手写 SQL，参数化，拿回行。 */
export type CorpusClient = Pick<PoolClient, "query">;

/** 锁的键，拼出来是 "talent" 六个字节。同一个库上的写者靠它排队。 */
const CORPUS_LOCK = String(BigInt("0x74616c656e74"));

/** 一个写者独占的连接。用完必须 `release`，否则连接池会漏一条。 */
export type CorpusSession = {
	client: PoolClient;
	release: () => Promise<void>;
};

/** 当前数据库持锁连接的会话名；没有持锁连接时为 null。 */
export async function corpusSessionOwner(
	store: DbExecutor = db,
): Promise<string | null> {
	const { rows } = await store.execute<{
		name: string;
	}>(sql`select a.application_name as name from pg_locks l
		 join pg_stat_activity a on a.pid = l.pid
		 where l.locktype = 'advisory'
		   and l.objsubid = 1
		   and l.database = (select oid from pg_database where datname = current_database())
		   and l.classid = (${CORPUS_LOCK}::bigint >> 32)::int
		   and l.objid = (${CORPUS_LOCK}::bigint & x'ffffffff'::bigint)::int
		   and l.granted`);
	return rows[0]?.name ?? null;
}

/**
 * 取得写者连接与锁。`wait` 为 false 时已经有写者就返回 `null`，调用方负责报告；
 * 为 true 时排队等到拿到为止。
 */
export async function acquireCorpusSession(
	wait = false,
): Promise<CorpusSession | null> {
	const client = await pool.connect();
	try {
		if (wait) {
			await client.query(`select pg_advisory_lock(${CORPUS_LOCK}::bigint)`);
		} else {
			const { rows } = await client.query<{ locked: boolean }>(
				`select pg_try_advisory_lock(${CORPUS_LOCK}::bigint) as locked`,
			);
			if (!rows[0]?.locked) {
				client.release();
				return null;
			}
		}
	} catch (error) {
		client.release();
		throw error;
	}
	return {
		client,
		release: async () => {
			let broken = false;
			try {
				await client.query(`select pg_advisory_unlock(${CORPUS_LOCK}::bigint)`);
				// 清理整理任务的会话级临时表与运行身份，再将连接归还池。
				await client.query("discard temp");
				await client.query("reset application_name");
			} catch {
				// 收不了尾的连接不能还回池里：它可能残留会话状态，下一个使用者会出错
				broken = true;
			} finally {
				client.release(broken);
			}
		},
	};
}
