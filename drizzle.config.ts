import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

config({ path: [".env.local", ".env"] });

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

// 改表只有一条路：改 schema.ts 然后 db:push。不生成迁移文件，所以没有 out。
export default defineConfig({
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: { url },
});
