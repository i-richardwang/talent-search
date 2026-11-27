/**
 * 一行队列保存一个词、出题时的参考词和首份判定。工具提交时按这道题核对判定，
 * 整理任务在写者锁内应用。指南变化后重新收集待判词。
 */

import "@tanstack/react-start/server-only";
import type { Report } from "./report";
import type { CorpusClient } from "./session";
import { conform } from "./vocabulary-rules";

export type Judge = "model" | "external" | "off";

/** 判定方在库里的写法：自带模型是 `model:<模型名>`，外部 agent 是 `agent:<名字>`。 */
export function modelJudge(model: string): string {
	return `model:${model}`;
}

/**
 * 外部判定方自报的名字，校验并转成库里的写法；不合规矩的返回 null。
 *
 * 名字只作留痕（库里记下哪条是谁判的，任务日志按它计数），所以只要求它是个短标识：
 * 接口那一侧不必再想一遍什么算合法，这件事只有这一处知道。
 */
export function agentJudge(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return /^[A-Za-z0-9._-]{1,40}$/.test(trimmed) ? `agent:${trimmed}` : null;
}

/** 一个词，和收集那一刻它下面的人数。 */
export type Member = { word: string; people: number };

/** 一个要判的词，和词表里与它写法最接近的几个参考词。 */
export type Question = Member & { near: Member[] };

/** 队列里的一个待判的词。 */
type Pending = Question & {
	id: number;
	guideIdentity: string;
	collectedAt: Date;
};

type Judged = Pending & { judge: string; judgment: unknown };

type Row = {
	id: number;
	guide_identity: string;
	word: string;
	people: number;
	near: Member[];
	collected_at: Date;
	judge: string | null;
	judgment: unknown;
};

const COLUMNS =
	"id, guide_identity, word, people, near, collected_at, judge, judgment";

function pending(row: Row): Pending {
	return {
		collectedAt: row.collected_at,
		guideIdentity: row.guide_identity,
		id: row.id,
		near: row.near,
		people: row.people,
		word: row.word,
	};
}

/** 按收集顺序领取当前指南下的待判词。内置 agent 可暂缓本轮反复作答无效的题。 */
export async function openWords(
	client: CorpusClient,
	guideIdentity: string,
	limit?: number,
	skipped: number[] = [],
): Promise<Pending[]> {
	const { rows } = await client.query<Row>(
		`select ${COLUMNS}
		 from review_word
		 where guide_identity = $1 and judge is null and not (id=any($2::int[]))
		 order by collected_at, id limit $3`,
		[guideIdentity, skipped, limit ?? null],
	);
	return rows.map(pending);
}

/** 队列里（没判的和判了还没生效的）所有的词：这一轮收集要绕开它们。 */
export async function busyWords(
	client: CorpusClient,
	guideIdentity: string,
): Promise<Set<string>> {
	const { rows } = await client.query<{ word: string }>(
		"select word from review_word where guide_identity = $1",
		[guideIdentity],
	);
	return new Set(rows.map((row) => row.word));
}

/** 收集方用 busyWords 绕开队列里已有的词，一个词在队列里只有一行。 */
export async function collect(
	client: CorpusClient,
	guideIdentity: string,
	questions: Question[],
): Promise<void> {
	if (questions.length === 0) return;
	await client.query(
		`insert into review_word (guide_identity, word, people, near)
		 select $1, * from unnest($2::text[], $3::int[], $4::jsonb[])`,
		[
			guideIdentity,
			questions.map((one) => one.word),
			questions.map((one) => one.people),
			questions.map((one) => JSON.stringify(one.near)),
		],
	);
}

/**
 * 一次提交的结果。这一行不在了和已经有人判过分开说：提交的一方要据此决定重不重试。
 */
export type Submission = "accepted" | "missing" | "taken";

/**
 * 把一份判定记在词上。**只写队列的这一行**，不碰词表也不碰边——词表只在生效时改，
 * 而生效拿着语料的写者锁。所以外部提交不必等解析让出锁。
 *
 * 一个词只记下第一份判定，后续提交返回 taken。
 */
export async function submitJudgment(
	client: CorpusClient,
	id: number,
	guideIdentity: string,
	judge: string,
	judgment: unknown,
): Promise<Submission> {
	const { rowCount } = await client.query(
		`update review_word set judge = $3, judgment = $4
		 where id = $1 and guide_identity = $2 and judge is null`,
		[id, guideIdentity, judge, JSON.stringify(judgment)],
	);
	if (rowCount) return "accepted";
	const { rows } = await client.query<{ judge: string | null }>(
		"select judge from review_word where id = $1 and guide_identity = $2",
		[id, guideIdentity],
	);
	return rows[0]?.judge ? "taken" : "missing";
}

/** 工具即时核对这道题的参考词，让判定方能在第一份答案保存前修正。 */
export async function submitPlacement(
	client: CorpusClient,
	id: number,
	identity: string,
	judge: string,
	judgment: unknown,
) {
	const { rows } = await client.query<Pick<Row, "word" | "near" | "judge">>(
		"select word,near,judge from review_word where id=$1 and guide_identity=$2",
		[id, identity],
	);
	const row = rows[0];
	if (!row) return "missing";
	if (row.judge) return "taken";
	if (
		!conform(
			judgment,
			row.word,
			row.near.map((r) => r.word),
		)
	)
		return "invalid";
	return submitJudgment(client, id, identity, judge, judgment);
}

/** 不是这一份标准的行作废：按旧标准问的、按旧标准答的都不算数。 */
export async function discardStale(
	client: CorpusClient,
	report: Report,
	guideIdentity: string,
): Promise<void> {
	const { rowCount } = await client.query(
		"delete from review_word where guide_identity <> $1",
		[guideIdentity],
	);
	if (rowCount)
		report(`  ${rowCount} 个词的判定标准已更新，已作废并按新标准重收`);
}

/** 判过的、等着生效的词，按收集顺序。 */
export async function judged(
	client: CorpusClient,
	guideIdentity: string,
): Promise<Judged[]> {
	const { rows } = await client.query<Row>(
		`select ${COLUMNS}
		 from review_word
		 where guide_identity = $1 and judge is not null
		 order by id`,
		[guideIdentity],
	);
	// `judge is not null` 是这条查询的谓词，所以这一列在这里一定有值
	return rows.map((row) => ({
		...pending(row),
		judge: row.judge as string,
		judgment: row.judgment,
	}));
}

/** 生效完的词从队列里删掉。和写表在同一笔事务里，否则下一轮会把同一份判定再算一遍。 */
export async function remove(
	client: CorpusClient,
	ids: number[],
): Promise<void> {
	if (ids.length === 0) return;
	await client.query("delete from review_word where id = any($1::int[])", [
		ids,
	]);
}

/** 判定按判定方计数，报告里用。 */
export function byJudge(rows: Judged[]): string {
	const counts = new Map<string, number>();
	for (const row of rows)
		counts.set(row.judge, (counts.get(row.judge) ?? 0) + 1);
	return [...counts].map(([judge, count]) => `${judge} ${count} 个`).join("、");
}
