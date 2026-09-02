import "@tanstack/react-start/server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL 未配置");

export const pool = new Pool({ connectionString: url });
export const db = drizzle(pool, { schema });

/** 应用查询与事务共享的最小数据库能力。 */
export type DbExecutor = Pick<
	typeof db,
	"execute" | "insert" | "select" | "update"
>;

/**
 * 在同一代语料上完成一组读取。embedding_space 是换代门闩：ETL 的发布事务
 * 先独占锁它，所有跨语句读取先共享锁它，因此换代只能发生在整组读取之前或之后。
 */
export function withCorpusSnapshot<T>(
	read: (store: DbExecutor) => Promise<T>,
): Promise<T> {
	return db.transaction(async (store) => {
		await store
			.select({ spaceId: schema.embeddingSpace.spaceId })
			.from(schema.embeddingSpace)
			.limit(1);
		return read(store);
	});
}
