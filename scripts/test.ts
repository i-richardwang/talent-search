import { spawnSync } from "node:child_process";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("测试需要在 .env.local 中配置 DATABASE_URL");

const child = spawnSync(
	process.execPath,
	["--no-env-file", "test", "--parallel", "tests/"],
	{
		env: {
			DATABASE_URL: databaseUrl,
			NODE_ENV: "test",
			PATH: process.env.PATH ?? "",
		},
		stdio: "inherit",
	},
);

if (child.error) throw child.error;
process.exit(child.status ?? 1);
