/**
 * 运行一轮派生，完成后才返回。应用进程里的任务调度平时会自动运行它；这个脚本用于应用
 * 没有启动、或者想在标准输出里看完一轮的时候。已经有写者在运行就立即退出。
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
