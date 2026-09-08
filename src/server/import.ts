/**
 * 一次导入的生命周期：谁能开始、说过的话去哪、上一次是什么结果。
 *
 * **导入是这个应用自己的一次运行。** 网页上那个按钮和 `bun run import` 走的是
 * 同一个函数、同一条串行化锁、同一份记录；命令行只是多要了一份回显、并且等它跑完。
 * 语料侧那些步骤本身在 `src/corpus/load.ts`，这里只管边界上的四件事：
 *
 * 1. **一次只准一个人进**（`corpus/session.ts` 的 try 锁）。拿不到锁就当场说
 *    「已经有一次在跑」，不排队。
 * 2. **拿到锁之后，先给停在半路的记录收尾。** 拿得到锁就说明没有任何一次导入
 *    还活着，那些没有结束时间的行只可能是进程中途没了留下的。
 * 3. **说过的每一行都进那一行记录。** 攒着批量写，不是一行一次往返——整理能力词
 *    一轮能说出上千行。
 * 4. **失败写进记录，不只是抛给调用方。** 从网页按下按钮的人看不到服务器的
 *    标准输出，所以那条记录必须自己说得出为什么停了。
 */

import "@tanstack/react-start/server-only";
import { eq, isNull, sql } from "drizzle-orm";
import { load } from "#/corpus/load";
import type { Report } from "#/corpus/report";
import { acquireCorpusSession } from "#/corpus/session";
import { sourceName } from "#/corpus/sources";
import { db } from "#/db";
import { importRun } from "#/db/schema";

/** 「最近几次导入」列几行。再多也没人往下看。 */
const HISTORY = 10;

/** 攒多久写一次日志。够短，页面上看着是在动的；够长，上千行不变成上千次往返。 */
const FLUSH_MS = 400;

/**
 * 一次导入在页面上的样子。
 *
 * 时刻和用时**在库里算好**：服务端直出和浏览器水合各算一次的话，两边的时区
 * 不同就会渲染出两个不一样的字符串，而 React 只会在控制台嘀咕一句。
 * 管理页 `/skills` 的「几天前」是同一个道理。
 */
export type ImportRunView = {
	id: number;
	/** 这一次读的是哪个适配器 */
	source: string;
	/** 开始时刻，`MM-DD HH:MM` */
	startedAt: string;
	/** 用时秒数；还在跑时是 null */
	seconds: number | null;
	error: string | null;
};

/** 管理页一次载入要的全部：最近一次的全过程，以及在它之前的几次的结果。 */
export type ImportState = {
	/** 最近一次导入，连它说过的每一行；一次都没跑过时是 null */
	latest: (ImportRunView & { log: string[] }) | null;
	/** 更早的几次 */
	history: ImportRunView[];
};

export async function importState(): Promise<ImportState> {
	const { rows } = await db.execute<ImportRunView & { log: string[] }>(sql`
		select
			id,
			source,
			to_char(started_at, 'MM-DD HH24:MI') as "startedAt",
			extract(epoch from (finished_at - started_at))::int as seconds,
			error,
			log
		from import_run
		order by started_at desc, id desc
		limit ${HISTORY + 1}`);
	const [latest, ...history] = rows;
	return {
		latest: latest ?? null,
		history: history.map(({ log: _log, ...view }) => view),
	};
}

/**
 * 把说出来的话攒进那一行记录。
 *
 * 每行一次 UPDATE 会让整理能力词那一段变成上千次往返；攒着写，并且**同一时刻只有
 * 一次在途的追加**——上一次还没落库时新来的行排在它后面，不并发改同一行。
 */
function logger(runId: number) {
	let pending: string[] = [];
	let writing: Promise<void> = Promise.resolve();
	let timer: ReturnType<typeof setTimeout> | null = null;

	const flush = (): Promise<void> => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (pending.length === 0) return writing;
		const lines = pending;
		pending = [];
		writing = writing.then(async () => {
			await db
				.update(importRun)
				/*
				 * `sql.param` 把这一批行当**一个**数组参数送出去。直接内插的话
				 * 模板会把数组摊成一串参数，拼出来是 `($1, $2)` 一个记录，
				 * 而记录转不成 text[]——这条错只在多行一起落库时才出现。
				 */
				.set({ log: sql`${importRun.log} || ${sql.param(lines)}::text[]` })
				.where(eq(importRun.id, runId));
		});
		return writing;
	};

	const report: Report = (line) => {
		pending.push(line);
		if (!timer) timer = setTimeout(flush, FLUSH_MS);
	};

	return { report, flush };
}

/** 一次导入从开始到结束。返回 `null` 表示已经有一次在跑。 */
export type StartedImport = {
	runId: number;
	/**
	 * 整轮跑完之后的失败原因，成功是 null。
	 *
	 * **不 reject**：这个 promise 在网页那条路上没有人 await，reject 会变成一次
	 * 未处理的拒绝；失败本来就该以「那条记录上的一句话」的形式存在。
	 */
	finished: Promise<string | null>;
};

/**
 * 开一次导入：拿锁、落一条记录、开跑，然后立刻把记录 id 交出去。
 *
 * 交得早是有意的——按钮按下去要马上有反应，进度由那条记录自己长出来。命令行
 * 要等它跑完，`await` 那个 `finished` 就是了。
 */
export async function startImport(
	echo?: Report,
): Promise<StartedImport | null> {
	const session = await acquireCorpusSession();
	if (!session) return null;

	try {
		// 拿得到锁 ⇒ 没有任何一次导入还活着 ⇒ 没结束的行都是进程中断留下的
		await db
			.update(importRun)
			.set({ finishedAt: new Date(), error: "进程中断，没有跑完" })
			.where(isNull(importRun.finishedAt));

		const source = sourceName();
		const [row] = await db
			.insert(importRun)
			.values({ source, log: [] })
			.returning({ id: importRun.id });
		if (!row) throw new Error("没能落下这次导入的记录");

		const { report, flush } = logger(row.id);
		const say: Report = (line) => {
			echo?.(line);
			report(line);
		};

		const finished = (async (): Promise<string | null> => {
			let failure: string | null = null;
			try {
				await load(session, source, say);
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
				say(`✖ ${failure}`);
			} finally {
				await session.release();
			}
			await flush();
			await db
				.update(importRun)
				.set({ finishedAt: new Date(), error: failure })
				.where(eq(importRun.id, row.id));
			return failure;
		})();

		return { runId: row.id, finished };
	} catch (error) {
		await session.release();
		throw error;
	}
}
