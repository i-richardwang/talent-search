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
 * 在同一版语料上完成一组读取，并告诉回调它站在哪一版上。
 *
 * `embedding_space` 是语料锁：导入的发布事务先独占锁它，所有跨语句读取先共享
 * 锁它，因此重灌只能发生在整组读取之前或之后，一次结果不会混进两版数据。
 *
 * **模型调用不许发生在语料锁内。** 嵌入和重排是秒级的，而 ACCESS EXCLUSIVE 在
 * Postgres 里是排队的：一个慢端点挡住一个等着发布的导入，那次导入就挡住排在
 * 它后面的每一个新读者——一次端点抖动会变成全站不可用。所以准入（召回 + 重排）
 * 在语料锁外算完，再进语料锁取数。
 *
 * 代价是算出来的计划可能过期，`generation` 就是给调用方核对这件事用的：它是
 * `embedding_space` 那一行的行版本号，而整库重灌每次都会重写这一行
 * （`src/corpus/load.ts` 的 `_publish_corpus`），所以行版本变了就是换了一版。不另立一列
 * 代号——一列要靠人记得更新的代号，忘了更新不会报错。核对怎么用见
 * `search/phrases.ts` 的 `withAdmission`。
 */
export function withCorpusSnapshot<T>(
	read: (store: DbExecutor, generation: string) => Promise<T>,
): Promise<T> {
	return db.transaction(async (store) => {
		const rows = await store.execute<{ generation: string }>(
			sql`select space_id || ':' || xmin::text as generation from embedding_space`,
		);
		const [row] = rows.rows;
		if (!row) throw new Error("语料没有嵌入空间元数据，请先跑一次导入");
		return read(store, row.generation);
	});
}
