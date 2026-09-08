/**
 * 派生一轮，跑完才返回。应用进程里的排班平时自己会跑它；这条路给没起应用、
 * 或者想盯着标准输出看一轮的时候用。已经有写者在跑就当场退出。
 */
import { pool } from "#/db";
import { runTask } from "#/server/tasks";

const started = Date.now();
const run = await runTask("derive", { echo: (line) => console.log(line) });
await pool.end();

if (!run) {
	console.error("已经有一个语料侧的任务在跑");
	process.exit(1);
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(
	run.failure ? `\n派生失败，用时 ${seconds}s` : `\n完成，用时 ${seconds}s`,
);
if (run.failure) process.exit(1);
