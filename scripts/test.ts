import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { ownerOf } from "../tests/temp-schema";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("测试需要在 .env.local 中配置 DATABASE_URL");

/** 这个进程还在不在。没有权限给它发信号，也说明它在。 */
function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

// 每个测试文件跑完自己删临时 schema，被中断的来不及删。开跑前把建它的进程已经不在的删掉；
// 进程还在的属于正在跑的另一次测试，不碰。测试库在本机，进程号说的是这台机器上的进程。
const pool = new Pool({ connectionString: databaseUrl });
try {
	const { rows } = await pool.query<{ nspname: string }>(
		"select nspname from pg_namespace",
	);
	for (const { nspname } of rows) {
		const owner = ownerOf(nspname);
		if (owner !== null && !alive(owner))
			await pool.query(`drop schema if exists "${nspname}" cascade`);
	}
} finally {
	await pool.end();
}

const child = spawnSync(
	process.execPath,
	[
		"--no-env-file",
		"test",
		"--preload",
		"./tests/design-system-sources.ts",
		"--parallel",
		"tests/",
	],
	{
		env: {
			DATABASE_URL: databaseUrl,
			NODE_ENV: "test",
			TALENT_SOURCE: "csv-dir",
			TALENT_CSV_DIR: "src/corpus/sources/sample",
			PATH: process.env.PATH ?? "",
		},
		stdio: "inherit",
	},
);

if (child.error) throw child.error;
process.exit(child.status ?? 1);
