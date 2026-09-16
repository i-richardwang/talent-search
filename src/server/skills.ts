import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { withCorpusSnapshot } from "#/db";

/** 一个标准词：它属于哪个更宽的词、并进来的写法、它和它下面的词一共多少人、上次整理的时间。 */
export type SkillEntry = {
	canonical: string;
	/** 更宽的词；没有就是 null */
	parent: string | null;
	aliases: string[];
	/** 写了这个词、它的其他写法或它下面任一个词的人数，和筛选栏同一口径 */
	people: number;
	/** 上次整理这个词是几天前；0 是今天 */
	reviewedDaysAgo: number;
};

export type SkillTable = {
	/** 词表里的标准词，人多的在前 */
	entries: SkillEntry[];
};

/**
 * 能力词词表的一份快照，给管理页看。
 *
 * 只读：表由整理任务写（`src/corpus/vocabulary.ts`），这里不提供改它的路，改了下一轮整理
 * 就会被裁判的决定盖回去。人数按标准词连同它的其他写法、它下面的词一起数，和筛选栏
 * 「入职前技能」同一口径——「团队管理」的人数包含写了「人员管理」的人，「数据分析」的
 * 人数包含写了「销售数据分析」的人。裁判起的名字（语料里没人
 * 写过的更宽的词）也是一行，人数全部来自它下面的词。表里的标准词有可能已经不在语料里
 * （写它的人的简历改了），那就是 0，照样列出来。「几天前」在库里算：页面直出和水合两边
 * 都不用碰时区。
 */
export function listSkills(): Promise<SkillTable> {
	return withCorpusSnapshot(async (store) => {
		const entries = await store.execute<SkillEntry>(sql`
				with recursive under(term, word) as (
					select canonical, word from skill_term
					union
					select u.term, a.word from under u
					join skill_term c on c.parent = u.word
					join skill_term a on a.canonical = c.word
				)
				select
					a.canonical,
					max(a.parent) filter (where a.word = a.canonical) as parent,
					coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
					coalesce((
						select count(distinct e.emp_id)::int
						from under u
						join phrase p on p.text = u.word
						join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
						join experience e on e.id = ep.experience_id
						where u.term = a.canonical), 0) as people,
					(current_date - max(a.reviewed_at)::date)::int as "reviewedDaysAgo"
				from skill_term a
				group by a.canonical
				order by people desc, a.canonical`);
		return { entries: entries.rows };
	});
}
