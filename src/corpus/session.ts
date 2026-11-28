/**
 * HRIS 同步、简历入池、解析和整理共用一个会话级 advisory lock；写者独占一个连接，跨批次的短事务
 * 都拿着锁。
 * 后台任务拿不到锁就返回，命令行同步排队等待。检索使用自己的数据库快照。
 * 拿到锁的那个连接用 application_name 标记自己在跑哪一次，连接断开后锁跟着释放。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { db, pool } from "#/db";
import type { DbExecutor } from "#/db/snapshot";

/** 语料侧要用的那点数据库能力：手写 SQL，参数化，拿回行。 */
export type CorpusClient = Pick<PoolClient, "query">;

/** 锁的键，拼出来是 "talent" 六个字节。同一个库上的写者靠它排队。 */
const CORPUS_LOCK = 0x74616c656e74n;
const RUN_LOCK = { derive: CORPUS_LOCK + 1n, review: CORPUS_LOCK + 2n };

/** 语料操作拿着写者锁，等待模型期间释放它，恢复后才能继续写入。 */
export type CorpusWriter = {
	client: CorpusClient;
	outsideWriter: <T>(work: () => Promise<T>) => Promise<T>;
};

export type CorpusSession = CorpusWriter & {
	client: PoolClient;
	release: () => Promise<void>;
};

/** 本库持有写者锁或同类任务运行锁的连接名，用来识别仍在执行的任务。 */
export async function corpusSessionOwners(
	store: DbExecutor = db,
): Promise<string[]> {
	const { rows } = await store.execute<{
		name: string;
	}>(sql`select distinct a.application_name as name from pg_locks l
		 join pg_stat_activity a on a.pid = l.pid
		 where l.locktype = 'advisory'
		   and l.objsubid = 1
		   and l.database = (select oid from pg_database where datname = current_database())
		   and ((l.classid::bigint << 32) | l.objid::bigint) in
		     (${String(CORPUS_LOCK)}::bigint, ${String(RUN_LOCK.derive)}::bigint, ${String(RUN_LOCK.review)}::bigint)
		   and l.granted`);
	return rows.map((row) => row.name);
}

/**
 * 放锁并清掉这个写者留在会话上的东西（整理任务的临时表、运行身份），连接才能还回池里。
 * 停在事务里或清理失败的连接残留会话状态，下一个使用者会出错，返回 false。
 */
async function reset(client: PoolClient): Promise<boolean> {
	if (client.getTransactionStatus() !== "I") return false;
	try {
		await client.query("select pg_advisory_unlock_all()");
		await client.query("discard temp");
		await client.query("reset application_name");
		return true;
	} catch {
		return false;
	}
}

/**
 * 取得写者连接与锁。`wait` 为 false 时已经有写者就返回 `null`，调用方负责报告；
 * 为 true 时排队等到拿到为止。
 */
export async function acquireCorpusSession(
	wait = false,
	kind?: "sync" | "derive" | "review",
	maxWaitMs?: number,
): Promise<CorpusSession | null> {
	const client = await pool.connect();
	let broken = false;
	const locks =
		kind === "derive" || kind === "review"
			? [RUN_LOCK[kind], CORPUS_LOCK]
			: [CORPUS_LOCK];
	try {
		if (maxWaitMs)
			await client.query("select set_config('lock_timeout',$1,false)", [
				String(maxWaitMs),
			]);
		for (const key of locks) {
			if (wait) await client.query(`select pg_advisory_lock(${key}::bigint)`);
			else {
				const { rows } = await client.query<{ locked: boolean }>(
					`select pg_try_advisory_lock(${key}::bigint) as locked`,
				);
				if (rows[0]?.locked) continue;
				await client.query("select pg_advisory_unlock_all()");
				client.release();
				return null;
			}
		}
		if (maxWaitMs) await client.query("reset lock_timeout");
	} catch (error) {
		// 请求失败时可能已取得锁；销毁连接才能释放未知的会话状态。
		client.release(true);
		throw error;
	}
	async function writerLock(action: "lock" | "unlock") {
		try {
			await client.query(
				`select pg_advisory_${action}(${CORPUS_LOCK}::bigint)`,
			);
		} catch (error) {
			broken = true;
			throw error;
		}
	}
	return {
		client,
		outsideWriter: async (work) => {
			await writerLock("unlock");
			try {
				return await work();
			} finally {
				await writerLock("lock");
			}
		},
		// 收不了尾的连接销毁而不还回池里，销毁连接同时释放锁
		release: async () => client.release(broken || !(await reset(client))),
	};
}

/** 网页提交语料时与同步、解析共用写者锁，磁盘写入与数据库提交可分阶段完成。 */
export async function withCorpusWrite<T>(
	work: (client: PoolClient) => Promise<T>,
) {
	const session = await acquireCorpusSession(true, undefined, 8000);
	if (!session) throw new Error("无法取得语料写入连接");
	try {
		return await work(session.client);
	} finally {
		await session.release();
	}
}
export async function inTransaction<T>(
	client: PoolClient,
	work: () => Promise<T>,
) {
	await client.query("begin");
	try {
		const value = await work();
		await client.query("commit");
		return value;
	} catch (error) {
		await client.query("rollback");
		throw error;
	}
}
export function corpusTransaction<T>(work: (client: PoolClient) => Promise<T>) {
	return withCorpusWrite((c) => inTransaction(c, () => work(c)));
}
