/**
 * 一次导入独占的那条数据库连接，以及「同一个库一次只准备一版语料」这条串行化。
 *
 * 为什么要独占一条连接：暂存表是**会话级**的临时表，跨过准备与发布两笔事务
 * （`load.ts`）；换一条连接就看不见它们了。
 *
 * 为什么锁是**会话级** advisory lock 而不是事务级：它要跨过那两笔事务活着。
 * 换成 `pg_advisory_xact_lock`，第一次 commit 就把它松开了，两代语料会赛跑。
 *
 * 为什么是 `try` 而不是等：这个锁背后是网页上那个按钮。拿不到就当场说「已经有
 * 一次导入在跑」，比让人对着一个转圈的按钮排队几十分钟诚实。
 *
 * 这把锁同时是**「此刻有没有人在跑」的唯一出处**（`importRunning`）：它随持锁的
 * 连接一起生灭，问它得到的永远是此刻的实情，不像库里的一列要靠谁去对齐。
 */

import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { pool } from "#/db";

/** 语料侧要用的那点数据库能力：手写 SQL，参数化，拿回行。 */
export type CorpusClient = Pick<PoolClient, "query">;

/** 锁的键，拼出来是 "talent" 六个字节。同一个库上的导入靠它排队。 */
const CORPUS_RELOAD_LOCK = "0x74616c656e74";

/** 一次导入独占的连接。用完必须 `release`，否则连接池会漏一条。 */
export type CorpusSession = {
	client: PoolClient;
	release: () => Promise<void>;
};

/**
 * 此刻有没有一次导入活着。
 *
 * **问的是锁，不是表。**「谁在跑」是连接的属性，Postgres 一直知道答案：持锁的
 * 连接一断，`pg_locks` 里那一行当场消失，不需要任何人事后来打扫。表里那个空的
 * `finished_at` 只说明「这一行没写完」——它分不出「正在跑」和「跑到一半进程没了」，
 * 拿它当活性用，一次崩溃就会在页面上留下一次永远跑不完的导入。
 *
 * 咨询锁是**按库**的，所以观察也按库来：同一个集群上的另一个库拿着同一把键，
 * 与这里无关。
 */
export async function importRunning(): Promise<boolean> {
	const { rows } = await pool.query<{ held: boolean }>(
		`select exists(
			select 1 from pg_locks
			where locktype = 'advisory'
				and database = (select oid from pg_database where datname = current_database())
				and classid = (${CORPUS_RELOAD_LOCK}::bigint >> 32)::int
				and objid = (${CORPUS_RELOAD_LOCK}::bigint & x'ffffffff'::bigint)::int
				and granted) as held`,
	);
	return rows[0]?.held ?? false;
}

/**
 * 取得导入连接与串行化锁。已经有一次导入在跑时返回 `null`，调用方负责说话。
 */
export async function acquireCorpusSession(): Promise<CorpusSession | null> {
	const client = await pool.connect();
	try {
		const { rows } = await client.query<{ locked: boolean }>(
			`select pg_try_advisory_lock(${CORPUS_RELOAD_LOCK}::bigint) as locked`,
		);
		if (!rows[0]?.locked) {
			client.release();
			return null;
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
				await client.query(
					`select pg_advisory_unlock(${CORPUS_RELOAD_LOCK}::bigint)`,
				);
				/*
				 * 暂存表也是**会话级**的，它们跟着这条连接回到池子里。不清掉的话
				 * 下一次导入拿到同一条连接，第一句 `create temp table` 就会撞上
				 * 「已经存在」——而这条错只在同一个进程里跑第二次时才出现。
				 */
				await client.query("discard temp");
			} catch {
				// 收不了尾的连接不能还回池里：它带着一身状态，下一个用它的人会中招
				broken = true;
			} finally {
				client.release(broken);
			}
		},
	};
}
