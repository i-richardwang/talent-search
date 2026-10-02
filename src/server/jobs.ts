/**
 * pg-boss 在应用进程中调度派生与整理，队列和时刻存于 pgboss schema。
 * exclusive 队列各只保留一个待处理或运行任务。处理函数检查任务是否需要运行，
 * 记录、锁、日志与执行交给 tasks.ts。
 */

import "@tanstack/react-start/server-only";
import { PgBoss } from "pg-boss";
import type { TaskKind } from "#/lib/task";
import { reviewJudge } from "./review";
import { derivePending, runTask } from "./tasks";

/** 后台跑的两种任务。同步不在其中：它读的是别处的数据，由命令行按外面的节奏跑。 */
export type JobKind = Exclude<TaskKind, "sync">;

/**
 * 排班。派生只看「有没有还没派生的段」，同步之后几分钟内就会接上；整理一天一次，
 * 一个词一周判一次的节奏在它里面（`corpus/vocabulary.ts`）。判定归外部时这一轮仍然
 * 照跑——它要让外部提交的判定生效，并且收集新的组。
 */
const SCHEDULE: Record<JobKind, string> = {
	derive: "*/5 * * * *",
	review: "0 3 * * *",
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

/*
 * 进程里只有一个 boss。开发服务器改一个文件就重新求值一遍这个模块，而上一个
 * boss 还在轮询——存在 globalThis 上，重新求值拿到的是同一个。
 */
const HANDLE = Symbol.for("talent-search.jobs");
type Handle = { boss: PgBoss; ready: Promise<void> };
const registry = globalThis as { [HANDLE]?: Handle };

async function setup(boss: PgBoss): Promise<void> {
	reviewJudge();
	boss.on("error", (error) => console.error("pg-boss：", error));
	await boss.start();
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	for (const kind of Object.keys(SCHEDULE) as JobKind[]) {
		await boss.createQueue(kind, { policy: "exclusive", retryLimit: 0 });
		await boss.schedule(kind, SCHEDULE[kind], null, { tz });
	}
	await boss.work("derive", async () => {
		// 没有活就不留一行记录：每五分钟一行「没事」的历史没人要看
		if ((await derivePending()) === 0) return;
		await runTask("derive");
	});
	await boss.work("review", async () => {
		// 关掉的时候不留一行记录，和派生「没有活就不留一行」同一个道理：每天一行
		// 「已关闭」的历史没人要看，而这件事任务台上有别的说法（`tasksState`）
		if (reviewJudge() === "off") return;
		await runTask("review");
	});
}

/** 启动排班；服务端入口（`src/server.ts`）调一次。 */
export function startJobs(): Promise<void> {
	if (!registry[HANDLE]) {
		const boss = new PgBoss({ connectionString: url });
		registry[HANDLE] = { boss, ready: setup(boss) };
	}
	return registry[HANDLE].ready;
}

/**
 * 现在就来一次。排着或在跑的已经有一个时什么都不发，返回 false——任务台据此
 * 说「已经有一次在排队了」。
 */
export async function requestJob(kind: JobKind): Promise<boolean> {
	const handle = registry[HANDLE];
	if (!handle) throw new Error("后台任务没有启动：这条路只在应用进程里通");
	await handle.ready;
	return (await handle.boss.send(kind, {})) !== null;
}
