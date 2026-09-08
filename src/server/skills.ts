import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db";

/** 一个标准词：它并进来的写法、现在写着它的人数、机器上次判它的时间。 */
export type SkillEntry = {
	canonical: string;
	aliases: string[];
	people: number;
	/** 机器上次判这个词是几天前；0 是今天 */
	reviewedDaysAgo: number;
};

export type SkillTable = {
	/** 语料里现在有多少个不同的能力词（已归并） */
	vocabulary: number;
	/** 对照表里的标准词，人多的在前 */
	entries: SkillEntry[];
};

/**
 * 能力词对照表的一份快照，给管理页看。
 *
 * 只读：表由整理任务写（`src/corpus/aliases.ts`），这里不提供改它的路，改了下一轮整理
 * 就会被机器的决定盖回去。人数按标准词数，和筛选栏「入职前能力」同一口径——
 * 表里的标准词有可能已经不在语料里（写它的人的简历改了），那就是 0，照样列出来。
 * 「几天前」在库里算：页面直出和水合两边都不用碰时区。
 */
export function listSkills(): Promise<SkillTable> {
	return withCorpusSnapshot(async (store) => {
		const [vocabulary, entries] = await Promise.all([
			store.execute<{ n: number }>(sql`
				select count(distinct phrase_id)::int as n
				from experience_phrase where route = 'skill'`),
			store.execute<SkillEntry>(sql`
				select
					a.canonical,
					coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
					coalesce((
						select count(distinct e.emp_id)::int
						from phrase p
						join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
						join experience e on e.id = ep.experience_id
						where p.text = a.canonical), 0) as people,
					(current_date - max(a.reviewed_at)::date)::int as "reviewedDaysAgo"
				from skill_alias a
				group by a.canonical
				order by people desc, a.canonical`),
		]);
		return {
			vocabulary: vocabulary.rows[0]?.n ?? 0,
			entries: entries.rows,
		};
	});
}
