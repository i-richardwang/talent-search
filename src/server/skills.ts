import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { type Judge, reviewJudge } from "#/corpus/aliases";
import { withCorpusSnapshot } from "#/db";
import { configured } from "./review";

/** 一个标准词：它并进来的写法、现在写着它的人数、上次判它的裁判和时间。 */
export type SkillEntry = {
	canonical: string;
	aliases: string[];
	people: number;
	/** 上次判这个词是几天前；0 是今天 */
	reviewedDaysAgo: number;
	/** 判它的裁判：`model:<模型名>` 或 `agent:<名字>` */
	judge: string;
};

export type SkillTable = {
	/** 对照表里的标准词，人多的在前 */
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
 * 能力词对照表的一份快照，给管理页看。
 *
 * 只读：表由整理任务写（`src/corpus/aliases.ts`），这里不提供改它的路，改了下一轮整理
 * 就会被裁判的决定盖回去。人数按标准词数，和筛选栏「入职前技能」同一口径——
 * 表里的标准词有可能已经不在语料里（写它的人的简历改了），那就是 0，照样列出来。
 * 「几天前」在库里算：页面直出和水合两边都不用碰时区。
 *
 * 队列里等着答的题数一起取：判卷归外部的时候，「机器还在不在整理」这个问题的答案
 * 就是这个数——没有它，一页停止增长的对照表和一页正常工作的对照表长得一模一样。
 */
export function listSkills(): Promise<SkillTable> {
	return withCorpusSnapshot(async (store) => {
		const entries = await store.execute<SkillEntry>(sql`
				select
					a.canonical,
					coalesce(array_agg(a.word order by a.word) filter (where a.word <> a.canonical), '{}') as aliases,
					coalesce((
						select count(distinct e.emp_id)::int
						from phrase p
						join experience_phrase ep on ep.phrase_id = p.id and ep.route = 'skill'
						join experience e on e.id = ep.experience_id
						where p.text = a.canonical), 0) as people,
					(current_date - max(a.reviewed_at)::date)::int as "reviewedDaysAgo",
					(array_agg(a.judge order by a.reviewed_at desc))[1] as judge
				from skill_alias a
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
