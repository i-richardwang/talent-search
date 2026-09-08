/**
 * 一次导入的生命周期：谁能开始、说过的话去哪、上一次是什么结果。
 *
 * **导入是这个应用自己的一次运行。** 网页上那个按钮和 `bun run import` 走的是
 * 同一条串行化锁、同一份记录、同一个 `execute`；两者只差一件事——命令行等它跑完，
 * 网页不等。语料侧那些步骤本身在 `src/corpus/load.ts`，这里只管边界上的四件事：
 *
 * 1. **一次只准一个人进**（`corpus/session.ts` 的 try 锁）。拿不到锁就当场说
 *    「已经有一次在跑」，不排队。
 * 2. **活性问锁，历史问表。** 一行记录说的是「这一次发生过什么」；「此刻有没有人
 *    在跑」是连接的属性，由 `importRunning()` 去问 Postgres。两件事各有各的出处，
 *    于是没有一个要靠人来对齐的中间状态，也不需要「下一次开始时先给上一次收尾」
 *    那样的修补步骤——进程中断的那一行，此刻就看得出它是中断的。
 *    这要求**行写完才放锁**：锁在手里的时候行还没写完，读者只会读成「正在跑」；
 *    反过来先放锁，就会有一瞬间「没人持锁、行没写完」，读起来和进程中断一模一样。
 * 3. **说过的每一行都进那一行记录。** 攒着批量写，不是一行一次往返——整理能力词
 *    一轮能说出上千行。记录是关于这次运行的，不是它的前提：一批日志没能落库，
 *    去标准错误说一声，导入照跑，结果照写。
 * 4. **失败写进记录，不只是抛给调用方。** 从网页按下按钮的人看不到服务器的
 *    标准输出，所以那条记录必须自己说得出为什么停了。
 */

import "@tanstack/react-start/server-only";
import { eq, sql } from "drizzle-orm";
import { load } from "#/corpus/load";
import type { Report } from "#/corpus/report";
import {
	acquireCorpusSession,
	type CorpusSession,
	importRunning,
} from "#/corpus/session";
import { sourceName } from "#/corpus/sources";
import { db } from "#/db";
import { importRun } from "#/db/schema";

/** 「最近几次导入」列几行。再多也没人往下看。 */
const HISTORY = 10;

/** 攒多久写一次日志。够短，页面上看着是在动的；够长，上千行不变成上千次往返。 */
const FLUSH_MS = 400;

/** 一行记录里最多展开几层来由。有环的错误链也就到此为止。 */
const CAUSE_DEPTH = 5;

/**
 * 一次导入的四种样子。
 *
 * 「中断」不是事后补写进库的一句话，是当场看出来的：这一行没写完，而锁没人拿着。
 */
export type ImportOutcome = "running" | "interrupted" | "failed" | "done";

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
	/** 用时秒数；还在跑和中断的那一行没有用时 */
	seconds: number | null;
	error: string | null;
	outcome: ImportOutcome;
};

/** 管理页一次载入要的全部：最近一次的全过程，以及在它之前的几次的结果。 */
export type ImportState = {
	/** 最近一次导入，连它说过的每一行；一次都没跑过时是 null */
	latest: (ImportRunView & { log: string[] }) | null;
	/** 更早的几次 */
	history: ImportRunView[];
};

type StoredRun = Omit<ImportRunView, "outcome"> & { log: string[] };

/**
 * 一行记录现在算哪一种。
 *
 * `live` 只对**最近**那一行成立：锁至多有一个持有者，而它开跑时落下的正是最新的
 * 一行，所以更早的那些没写完的行必然是中断留下的。
 */
function outcome(run: StoredRun, live: boolean): ImportOutcome {
	if (run.seconds !== null) return run.error ? "failed" : "done";
	return live ? "running" : "interrupted";
}

export async function importState(): Promise<ImportState> {
	/*
	 * **先看锁，再看行**，不并发。`execute` 是行写完才放锁的，于是：锁不在，行必然
	 * 已经写完；锁在，行没写完就是正在跑。反过来先读行再看锁，两次读之间那一次
	 * 恰好收尾的话，读到的是「行没写完、锁没人拿」——和进程中断一模一样。
	 */
	const running = await importRunning();
	const { rows } = await db.execute<StoredRun>(sql`
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
		latest: latest ? { ...latest, outcome: outcome(latest, running) } : null,
		history: history.map(({ log: _log, ...view }) => ({
			...view,
			outcome: outcome({ ...view, log: [] }, false),
		})),
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
		writing = writing
			.then(async () => {
				await db
					.update(importRun)
					/*
					 * `sql.param` 把这一批行当**一个**数组参数送出去。直接内插的话
					 * 模板会把数组摊成一串参数，拼出来是 `($1, $2)` 一个记录，
					 * 而记录转不成 text[]——这条错只在多行一起落库时才出现。
					 */
					.set({ log: sql`${importRun.log} || ${sql.param(lines)}::text[]` })
					.where(eq(importRun.id, runId));
			})
			/*
			 * 这一批没落下去，下一批照追：链上不留一个拒绝的 promise，否则后面每一批
			 * 都跟着拒绝，定时器那条路上还没人接它。丢掉的行只剩标准错误这一处。
			 */
			.catch((error) => {
				console.error(
					`导入 ${runId} 的 ${lines.length} 行日志没能落库：`,
					error,
				);
			});
		return writing;
	};

	const report: Report = (line) => {
		pending.push(line);
		if (!timer) timer = setTimeout(flush, FLUSH_MS);
	};

	return { report, flush };
}

/**
 * 一条错误连同它的来由，外层在前。
 *
 * 只取最外层那一句会把真正发生的事丢掉：加载数据源失败时，外层说的是「读取数据源
 * hr-warehouse 失败」，而 `cause` 上挂着的才是「缺少依赖 hyparquet」。
 */
function causeChain(error: unknown): string[] {
	const lines: string[] = [];
	let current = error;
	while (
		current !== null &&
		current !== undefined &&
		lines.length < CAUSE_DEPTH
	) {
		lines.push(current instanceof Error ? current.message : String(current));
		current = current instanceof Error ? current.cause : undefined;
	}
	return lines.length ? lines : [String(error)];
}

/**
 * 一次导入从头到尾。
 *
 * **它不抛。** 导入本身失败，结果是那一行上的一句话，也作为返回值交给命令行；
 * 连记录这件事本身都失败时（库没了），唯一还能说话的地方是标准错误。网页那条路
 * 没有人接这个 promise，所以「不抛」不能是一条要调用方守住的约定，只能是这个
 * 函数体里没有一条漏得出去的路。
 */
async function execute(
	session: CorpusSession,
	runId: number,
	source: string,
	echo?: Report,
): Promise<string | null> {
	const { report, flush } = logger(runId);
	const say: Report = (line) => {
		echo?.(line);
		report(line);
	};

	let failure: string | null = null;
	try {
		try {
			await load(session, source, say);
		} catch (error) {
			const chain = causeChain(error);
			failure = chain[0] ?? String(error);
			// 来由逐层进日志：一句话装不下的诊断，本来就该是多行
			for (const [depth, line] of chain.entries())
				say(depth === 0 ? `✖ ${line}` : `  ${"  ".repeat(depth)}↳ ${line}`);
		}
		await flush();
		await db
			.update(importRun)
			.set({ finishedAt: new Date(), error: failure })
			.where(eq(importRun.id, runId));
	} catch (error) {
		console.error(`导入 ${runId} 的记录没能收尾：`, error);
		failure ??= causeChain(error)[0] ?? String(error);
	} finally {
		// 行写完才放锁（见文件头第 2 条）；行的更新走连接池，不依赖这条会话
		await session.release();
	}
	return failure;
}

/** 拿锁、落一条记录。已经有一次在跑时返回 `null`。 */
async function begin() {
	const session = await acquireCorpusSession();
	if (!session) return null;
	try {
		const source = sourceName();
		const [row] = await db
			.insert(importRun)
			.values({ source, log: [] })
			.returning({ id: importRun.id });
		if (!row) throw new Error("没能落下这次导入的记录");
		return { session, runId: row.id, source };
	} catch (error) {
		await session.release();
		throw error;
	}
}

/** 一次跑完的导入。`failure` 是那一行上的失败原因，成功是 null。 */
export type ImportResult = { runId: number; failure: string | null };

/**
 * 跑一次导入，跑完才返回。已经有一次在跑时返回 `null`。
 *
 * 命令行用它：过程回显到标准输出，结果按 `failure` 给退出码。
 */
export async function runImport(echo: Report): Promise<ImportResult | null> {
	const begun = await begin();
	if (!begun) return null;
	const failure = await execute(begun.session, begun.runId, begun.source, echo);
	return { runId: begun.runId, failure };
}

/**
 * 开一次导入就返回。已经有一次在跑时返回 `null`。
 *
 * 网页用它：按钮按下去要马上有反应，而一次导入是几十分钟、一次 HTTP 往返不是。
 * 剩下的过程长在 `import_run` 那一行上，页面重新载入状态就看得见。
 */
export async function startImport(): Promise<{ runId: number } | null> {
	const begun = await begin();
	if (!begun) return null;
	// 没有人接这个 promise——`execute` 不抛，这一点由它自己保证
	void execute(begun.session, begun.runId, begun.source);
	return { runId: begun.runId };
}
