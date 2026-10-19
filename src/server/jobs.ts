/**
 * pg-boss 在应用进程中调度解析与整理，队列和时刻存于 pgboss schema。
 * exclusive 队列各只保留一个待处理或运行任务。处理函数检查任务是否需要运行，
 * 记录、锁、日志与执行交给 tasks.ts。
 */

import "@tanstack/react-start/server-only";
import { PgBoss, type UpdateQueueOptions } from "pg-boss";
import type { TaskKind } from "#/lib/task";
import { reviewJudge } from "./review";
import { deriveProgress, runTask } from "./tasks";

/** 后台跑的两种任务。同步不在其中：它读的是别处的数据，由命令行按外面的节奏跑。 */
export type JobKind = Exclude<TaskKind, "sync">;

/**
 * 排班。解析只看「有没有还没有当前标准结果、或暂存结果还没替换进去的段」，同步之后几分钟内解析会自动继续；整理一天一次，
 * 一个词一周判一次的节奏在它里面（`corpus/vocabulary.ts`）。判定归外部时这一轮
 * 仍然会跑——它要让外部提交的判定生效，并且收集新的组。
 */
const SCHEDULE: Record<JobKind, string> = {
	derive: "*/5 * * * *",
	review: "0 3 * * *",
};

/**
 * 两个队列共用的设置，每次启动写一遍，库里的队列总是这里的样子。失败不重试：下一次
 * 排班自然再来。
 *
 * pg-boss 把跑过 `expireInSeconds` 的任务判失败，而一轮解析可能跑好几个小时，所以时限
 * 放到它允许的最长一天；进程死掉由心跳在一两分钟内发现，exclusive 队列不会因为一个
 * 没人在跑的任务停一整天。
 */
const QUEUE = {
	retryLimit: 0,
	expireInSeconds: 24 * 60 * 60,
	heartbeatSeconds: 60,
} satisfies UpdateQueueOptions;

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
	boss.on("warning", ({ message, data }) =>
		console.warn("pg-boss：", message, data),
	);
	// 进程可能比库先起来：先等一会儿库，约两分半钟后仍不通才放弃
	await boss.start({ attempts: 10 });
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	for (const kind of Object.keys(SCHEDULE) as JobKind[]) {
		// 策略只能在建队列时定；已有的队列 `createQueue` 不动它，其余设置由 `updateQueue` 写
		await boss.createQueue(kind, { policy: "exclusive" });
		await boss.updateQueue(kind, QUEUE);
		await boss.schedule(kind, SCHEDULE[kind], null, { tz });
	}
	await boss.work("derive", async () => {
		// 没有活就不留一行记录：每五分钟一行「没事」的历史没人要看
		const { done, total, staging } = await deriveProgress();
		if (done === total && !staging) return;
		await runTask("derive");
	});
	await boss.work("review", async () => {
		// 关掉的时候不留一行记录：任务台上另有说法（`tasksState`）
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
