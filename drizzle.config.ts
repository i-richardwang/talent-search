import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

/*
 * 改表只有一条路：改 schema.ts 然后 db:push。不生成迁移文件，所以没有 out——
 * 库是 schema.ts 的纯派生物，中间不隔第二份必须与它保持一致的东西。
 *
 * 成立的前提是没有一张表的数据是丢不起的：employee / experience 由每次导入
 * truncate 后重建，search_turn 目前只是当前会话留下的记录。等 search_turn
 * 开始承担模型评估——那些「模型判成必须、人改成加分」的修正不能再随 push 一起
 * 被 truncate 掉的时候，这里就该换成 generate + migrate。
 */
export default defineConfig({
	schema: "./src/db/schema.ts",
	dialect: "postgresql",
	dbCredentials: { url },
});
