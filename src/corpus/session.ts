/**
 * 语料的写者一次只有一个：同步、派生、整理三种任务共用的那把锁，和持锁的那条连接。
 *
 * 为什么要串行：三者写的是同一批表。派生正在给一段连边时同步把那段删了，边就
 * 挂在不存在的段上；整理正在把边改指标准词时派生按旧词表写进新边，表里就有了
 * 两种答案。一次只让一个写者进来，这些交错根本不会发生，代码里也就不用为它们
 * 各留一条分支。读者不受影响：每一笔写都是短事务，读者看到的永远是某一笔提交
 * 之后的整体（`src/db/index.ts` 的 `withCorpusSnapshot`）。
 *
 * 为什么是**会话级** advisory lock：一次派生是几十分钟、几百笔短事务，锁要跨过
 * 它们活着。换成 `pg_advisory_xact_lock`，第一次 commit 就把它松开了。
 *
 * 拿不到锁时两种态度：后台任务**不等**，当场说「已经有人在写」——它反正几分钟
 * 后还会再来；命令行的同步**等**，跑脚本的人就站在那里，让它排在派生后面比让人
 * 重敲一遍诚实。
 *
 * 这把锁同时是**「此刻有没有人在写」的唯一出处**（`corpusSessionActive`）：它随
 * 持锁的连接一起生灭，问它得到的永远是此刻的实情，不像库里的一列要靠谁去对齐。
 */

import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { pool } from "#/db";

/** 语料侧要用的那点数据库能力：手写 SQL，参数化，拿回行。 */
export type CorpusClient = Pick<PoolClient, "query">;

/** 锁的键，拼出来是 "talent" 六个字节。同一个库上的写者靠它排队。 */
const CORPUS_LOCK = "0x74616c656e74";

/** 一个写者独占的连接。用完必须 `release`，否则连接池会漏一条。 */
export type CorpusSession = {
	client: PoolClient;
	release: () => Promise<void>;
};

/**
 * 此刻有没有写者活着。
 *
 * **问的是锁，不是表。**「谁在跑」是连接的属性，Postgres 一直知道答案：持锁的
 * 连接一断，`pg_locks` 里那一行当场消失，不需要任何人事后来打扫。表里那个空的
 * `finished_at` 只说明「这一行没写完」——它分不出「正在跑」和「跑到一半进程没了」，
 * 拿它当活性用，一次崩溃就会在页面上留下一次永远跑不完的任务。
 *
 * 咨询锁是**按库**的，所以观察也按库来：同一个集群上的另一个库拿着同一把键，
 * 与这里无关。
 */
export async function corpusSessionActive(): Promise<boolean> {
	const { rows } = await pool.query<{ held: boolean }>(
		`select exists(
			select 1 from pg_locks
			where locktype = 'advisory'
				and database = (select oid from pg_database where datname = current_database())
				and classid = (${CORPUS_LOCK}::bigint >> 32)::int
				and objid = (${CORPUS_LOCK}::bigint & x'ffffffff'::bigint)::int
				and granted) as held`,
	);
	return rows[0]?.held ?? false;
}

/**
 * 取得写者连接与锁。`wait` 为 false 时已经有写者就返回 `null`，调用方负责说话；
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
				/*
				 * 连接回池前不带任何会话状态。同步的暂存表是随事务消失的，但事务
				 * 中途断掉、或者哪天有人建了一张不随事务走的临时表，下一个拿到这条
				 * 连接的写者第一句 `create temp table` 就会撞上「已经存在」——而这条
				 * 错只在同一个进程里跑第二次时才出现。
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
