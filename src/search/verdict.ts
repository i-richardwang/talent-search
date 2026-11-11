/**
 * 查询理解对一段经历的结论按什么认：判据的文字，和确认的时候这一段的内容。保存
 * （`server/judged.ts`）和取回（`execute.ts` 的 `materializeHits`）用同一份。
 */

import { createHash } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";

/** 一条判据的键：判据文字的摘要，文字改一个字就是另一条。 */
export function criterionKey(criterion: string): string {
	return createHash("sha256").update(criterion).digest("hex");
}

/** 一段经历被确认的时候是什么样：内容键和解析版本。段的别名是 `e`。 */
export const SEGMENT_CONTENT: SQL = sql`(e.content_key || coalesce(e.derived_identity, ''))`;
