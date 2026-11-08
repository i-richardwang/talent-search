import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

// schema.ts 是唯一表结构来源；结构变更直接由 db:push 应用，不生成迁移文件。
export default defineConfig({
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	// 数据目录的视图在 catalog schema（`schema.ts` 的 `catalog`）；pg-boss 自管的 pgboss 不在此列
	schemaFilter: ["public", "catalog"],
	dbCredentials: { url },
});
