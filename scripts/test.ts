import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("测试需要在 .env.local 中配置 DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl });
try {
	const { rowCount } = await pool.query(
		"select 1 from pg_extension where extname = 'vector'",
	);
	if (!rowCount)
		throw new Error("测试数据库需要预先安装 vector 扩展，见 README.md");
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
