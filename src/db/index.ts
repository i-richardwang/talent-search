import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

export const pool = new Pool({ connectionString: url });
export const db = drizzle(pool, { schema });

/** 应用查询与事务共享的最小数据库能力。 */
export type DbExecutor = Pick<typeof db, "execute" | "select">;

/**
 * 在同一个语料快照上完成一组读取，并告诉回调它站在哪个嵌入空间上。
 *
 * 语料是增量长的：派生任务几百段一批地提交（`src/corpus/derive.ts`），同步一笔
 * 事务增删人和段（`src/corpus/sync.ts`）。一次检索要跨好几条语句取数，读提交
 * 隔离下两条语句之间一批派生刚好提交，同一份结果里就会一半是新边一半是旧边。
 * 所以这组读取跑在 **repeatable read** 里：事务开头拍一张快照，之后每条语句
 * 看到的都是它——Postgres 里这只是多一个快照，写者不用等读者，读者也不用等写者。
 *
 * **模型调用不许发生在这组读取里。** 嵌入和重排是秒级的，快照拿着不放没有锁的
 * 代价，但有连接的代价：一个慢端点占着一条池里的连接，并发一高池子就空了。
 * 所以准入（召回 + 重排）在快照外算完，再进快照取数。
 *
 * `generation` 是嵌入空间那一行的行版本号，给调用方核对「准入是对着哪个空间
 * 算的」：换嵌入空间时派生任务重写这一行（并清掉整张说法表），行版本变了就是
 * 换了空间，之前召回到的说法 id 已经不在了。不另立一列代号——一列要靠人记得
 * 更新的代号，忘了更新不会报错。核对怎么用见 `search/phrases.ts` 的 `withAdmission`。
 */
export function withCorpusSnapshot<T>(
	read: (store: DbExecutor, generation: string) => Promise<T>,
): Promise<T> {
	return db.transaction(
		async (store) => {
			const rows = await store.execute<{ generation: string }>(
				sql`select space_id || ':' || xmin::text as generation from embedding_space`,
			);
			const [row] = rows.rows;
			if (!row)
				throw new Error("语料还没有派生过：先跑 bun run sync，派生会接上");
			return read(store, row.generation);
		},
		{ isolationLevel: "repeatable read" },
	);
}
