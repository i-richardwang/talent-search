/**
 * 查询理解对经历下的结论：一条判据下，一段经历算不算。判断是理解一句话的那个模型自己下的——它
 * 搜出候选的段、读原文、把符合的挑出来（`agent-tools.ts` 的 `read` 与 `judge`），这里只负责
 * 把段写成给它读的文字、把它的结论存下来。
 *
 * 结论属于产生它的那一次找人任务（一条链，`rootTurnId`），在任务里按「判据 × 段的内容」保存，
 * 第一个写入的算数：同一条判据换一个 `where`、下一轮原样沿用，确认过的段都不用再看；段的内容或
 * 解析结果变了就对不上，按没确认过算。别的任务里写了一样的判据也从头看：读的时候模型眼前是那
 * 一次的整段对话，同一句判据换一次对话不一定是同一个意思。执行时怎么用这些结论见
 * `search/execute.ts` 的 `materializeHits`。
 */

import "@tanstack/react-start/server-only";
import { sql } from "drizzle-orm";
import { db } from "#/db";
import type { DbExecutor } from "#/db/snapshot";
import { dots } from "#/lib/format";
import { criterionKey, SEGMENT_CONTENT } from "#/search/verdict";

type SegmentRow = {
	id: number;
	content: string;
	kind: "internal" | "external";
	company: string;
	department_path: string;
	department: string;
	title: string;
	seq_l1: string;
	seq_l2: string;
	seq_l3: string;
	description: string;
	skills: { text: string; engagement: string | null }[];
};

/**
 * 一段经历写成给模型读的文字：在哪家公司或哪个部门、序列、岗位、读出的技能（前面是投入）和
 * 简历原文。起止时间不给：离现在多久、做了多长由排序去管。
 *
 * 搜索捞得到的文字这里都给全（`corpus/route-texts.ts` 的四类说法：序列和岗位、岗位名、技能、
 * 整段原文），原文不截断：没交的段按不算存下，模型没看到的内容不能变成一条结论。
 */
function segmentText(row: SegmentRow): string {
	const lines =
		row.kind === "internal"
			? [
					`公司内的任职，部门：${row.department_path || row.department || "未登记"}`,
				]
			: [`入职前的经历，公司：${row.company || "未登记"}`];
	const seq = dots(row.seq_l1, row.seq_l2, row.seq_l3);
	if (seq) lines.push(`序列：${seq}`);
	lines.push(`岗位：${row.title || "未登记"}`);
	if (row.skills.length > 0)
		lines.push(
			`技能：${row.skills
				.map((s) => [s.engagement, s.text].filter(Boolean).join(" "))
				.join("、")}`,
		);
	const description = row.description.trim();
	if (description) lines.push(`简历原文：${description}`);
	return lines.join("\n");
}

/** 这些段各自的文字和内容，按段的 id。 */
export async function segmentTexts(
	ids: readonly number[],
): Promise<Map<number, { content: string; text: string }>> {
	const out = new Map<number, { content: string; text: string }>();
	if (ids.length === 0) return out;
	const { rows } = await db.execute<SegmentRow>(sql`
		select e.id, ${SEGMENT_CONTENT} as content, e.kind, e.company, e.department,
			e.department_path, e.title, e.seq_l1, e.seq_l2, e.seq_l3, e.description,
			coalesce((
				select json_agg(json_build_object(
					'text', ph.text, 'engagement', ep.engagement) order by ph.text)
				from experience_phrase ep join phrase ph on ph.id = ep.phrase_id
				where ep.experience_id = e.id and ep.route = 'skill'), '[]') as skills
		from experience e
		where e.id = any(${sql.param([...ids])}::int[])`);
	for (const row of rows)
		out.set(row.id, { content: row.content, text: segmentText(row) });
	return out;
}

/** 一条判据下，一段内容的结论。 */
export type Verdict = { criterion: string; content: string; fits: boolean };

/**
 * 存下这次找人任务的一批结论。同一条判据下同样内容的段已经有结论时不改。`store` 是写入用的
 * 连接或事务：生产中和这一步的进度在同一个事务里（`server/turn.ts`）。
 */
export async function saveVerdicts(
	rootTurnId: string,
	verdicts: readonly Verdict[],
	store: Pick<DbExecutor, "execute">,
): Promise<void> {
	if (verdicts.length === 0) return;
	await store.execute(sql`
		insert into experience_verdict (root_turn_id, criterion_key, content, fits)
		select ${rootTurnId}, * from unnest(
			${sql.param(verdicts.map((v) => criterionKey(v.criterion)))}::text[],
			${sql.param(verdicts.map((v) => v.content))}::text[],
			${sql.param(verdicts.map((v) => v.fits))}::boolean[])
		on conflict do nothing`);
}
