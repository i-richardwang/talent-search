import "@tanstack/react-start/server-only";
import type { CorpusClient } from "./session";

/** 清除正式边和暂存边都不再引用的说法。同步删除段与解析重写边共用。 */
export async function prunePhrases(client: CorpusClient): Promise<void> {
	await client.query(
		`delete from phrase p
		 where not exists (
			select 1 from experience_phrase ep where ep.phrase_id = p.id)
		 and not exists (
			select 1 from experience_phrase_next ep where ep.phrase_id = p.id)`,
	);
}
