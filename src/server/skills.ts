import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { type Judge, reviewJudge } from "#/corpus/vocabulary";
import { withCorpusSnapshot } from "#/db";
import { configured } from "./review";

/** 一个标准词：它属于哪个更宽的词、并进来的写法、它和它下面的词一共多少人、上次判它的裁判和时间。 */
export type SkillEntry = {
	canonical: string;
	/** 更宽的词；没有就是 null */
	parent: string | null;
	aliases: string[];
	/** 写了这个词或它下面任一个词的人数，和筛选栏同一口径 */
	people: number;
	/** 上次判这个词是几天前；0 是今天 */
	reviewedDaysAgo: number;
	/** 判它的裁判：`model:<模型名>` 或 `agent:<名字>` */
	judge: string;
};

export type SkillTable = {
	/** 词表里的标准词，人多的在前 */
	entries: SkillEntry[];
	/** 此刻谁在判卷 */
	judge: Judge;
	/**
	 * 外部交卷的接口开没开（`src/server/review.ts`）。只在判卷归外部时有读者：归外部却
	 * 没配凭据，题只会挂到过期，页面得说出「接口关着」，不然那个数只是在涨
	 */
	reachable: boolean;
	/** 队列里还等着人答的题；判卷归外部时这个数才有读者 */
	waiting: number;
};

/**
 * 能力词词表的一份快照，给管理页看。
 *
 * 只读：表由整理任务写（`src/corpus/vocabulary.ts`），这里不提供改它的路，改了下一轮整理
 * 就会被裁判的决定盖回去。人数按标准词连同它下面的词一起数，和筛选栏「入职前技能」
 * 同一口径——「数据分析」的人数包含写了「销售数据分析」的人。裁判起的名字（语料里没人
 * 写过的更宽的词）也是一行，人数全部来自它下面的词。表里的标准词有可能已经不在语料里
 * （写它的人的简历改了），那就是 0，照样列出来。「几天前」在库里算：页面直出和水合两边
 * 都不用碰时区。
 *
 * 队列里等着答的题数一起取：判卷归外部的时候，「机器还在不在整理」这个问题的答案
 * 就是这个数——没有它，一页停止增长的词表和一页正常工作的词表长得一模一样。
 */
export function listSkills(): Promise<SkillTable> {
	return withCorpusSnapshot(async (store) => {
		const entries = await store.execute<SkillEntry>(sql`
				with recursive under(term, word) as (
					select word, word from skill_term where word = canonical
					union
					select u.term, t.word from under u
					join skill_term t on t.parent = u.word
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
					(current_date - max(a.reviewed_at)::date)::int as "reviewedDaysAgo",
					(array_agg(a.judge order by a.reviewed_at desc))[1] as judge
				from skill_term a
				group by a.canonical
				order by people desc, a.canonical`);
		const waiting = await store.execute<{ waiting: number }>(
			sql`select count(*)::int as waiting from skill_review where judge is null`,
		);
		return {
			entries: entries.rows,
			judge: reviewJudge(),
			reachable: configured(),
			waiting: waiting.rows[0]?.waiting ?? 0,
		};
	});
}
