/**
 * 命令行跑一次整库导入：bun run import
 *
 * 和管理页 `/imports` 上那个按钮是同一件事、同一条串行化锁、同一份记录
 * （`src/server/import.ts`）。命令行多两样：过程回显到标准输出，以及等它跑完，
 * 于是它能被 cron 之类的东西按退出码判断成功还是失败。
 */
import { pool } from "#/db";
import { runImport } from "#/server/import";

const started = Date.now();
const run = await runImport((line) => {
	console.log(line);
});
await pool.end();

if (!run) {
	console.error("已经有一次导入在进行中");
	process.exit(1);
}

const seconds = Math.round((Date.now() - started) / 1000);
console.log(
	run.failure ? `\n导入失败，用时 ${seconds}s` : `\n完成，用时 ${seconds}s`,
);
if (run.failure) process.exit(1);
