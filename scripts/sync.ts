/**
 * 同步：把数据源里的原始人事数据搬进库。挂在 cron 上按天跑，或者随手跑。
 *
 * 它排队等锁：派生正跑着的话，等它这一轮结束（最多十分钟）再动手。过程回显到
 * 标准输出，同一份也进 `task_run` 那一行，任务台上看得到。退出码只反映同步本身。
 */
import { pool } from "#/db";
import { runTask } from "#/server/tasks";

const started = Date.now();
const run = await runTask("sync", {
	wait: true,
	echo: (line) => console.log(line),
});
await pool.end();
if (!run) throw new Error("排队等锁的调用不会返回 null");

const seconds = Math.round((Date.now() - started) / 1000);
console.log(
	run.failure ? `\n同步失败，用时 ${seconds}s` : `\n完成，用时 ${seconds}s`,
);
if (run.failure) process.exit(1);
