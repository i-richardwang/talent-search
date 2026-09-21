import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

// schema.ts 是唯一表结构来源；结构变更直接由 db:push 应用，不生成迁移文件。
export default defineConfig({
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: { url },
});
