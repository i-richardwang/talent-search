/**
 * 整理的判定队列：收集、取走、提交判定，以及生效时取回判定结果。判定的标准、
 * 校验与写表在 `vocabulary.ts`；整轮的顺序在 `review.ts`。
 *
 * 队列里一行是一个要判的词和它的参考词，等到有人判、判定生效为止。队列只认一件事：
 * 一份标准下的这个词、谁判的、判成什么。它不读判定结果的内容——什么算一条有效的判断
 * 是生效时的事；标准变化时队列里的行整体作废，那些词仍是没判过的，下一轮按新标准重新收集。
 */

import "@tanstack/react-start/server-only";
import type { Report } from "./report";
import type { CorpusClient } from "./session";

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

/** 一个要判的词发给判定方时长的样子。人数就在行上，不另查一遍语料。 */
export function promptOf(question: Question): string {
	const line = (one: Member) => `${one.word}（${one.people} 人）`;
	return `要判的词：${line(question)}\n参考词：\n${question.near.map(line).join("\n")}`;
}

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

/**
 * 队列里还等着人判的词，最早收集的在前。
 *
 * 两个读者：外部判定方取走（`src/server/review.ts`），以及自带模型判——模型判的
 * 是**所有**没判的词，不只是这一轮刚收的那些，于是上一次端点抖动漏掉的下一轮
 * 会补上，从 `external` 切回 `model` 时队列里剩下的也能接着判。
 */
export async function openWords(
	client: CorpusClient,
	guideIdentity: string,
	limit?: number,
): Promise<Pending[]> {
	const { rows } = await client.query<Row>(
		`select ${COLUMNS}
		 from review_word
		 where guide_identity = $1 and judge is null
		 order by collected_at, id
		 ${limit === undefined ? "" : "limit $2"}`,
		limit === undefined ? [guideIdentity] : [guideIdentity, limit],
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

/**
 * 自带模型的判定成批记在词上。答不出合法 JSON 的那几个（回答是 undefined）留在
 * 队列里，下一轮再问。
 */
export async function recordJudgments(
	client: CorpusClient,
	judge: string,
	guideIdentity: string,
	replies: [id: number, payload: unknown][],
): Promise<void> {
	const done = replies.filter(([, payload]) => payload !== undefined);
	if (done.length === 0) return;
	await client.query(
		`update review_word r set judge = a.judge, judgment = a.judgment
		 from unnest($1::int[], $2::text[], $3::jsonb[]) as a(id, judge, judgment)
		 where r.id = a.id and r.guide_identity = $4 and r.judge is null`,
		[
			done.map(([id]) => id),
			done.map(() => judge),
			done.map(([, payload]) => JSON.stringify(payload)),
			guideIdentity,
		],
	);
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
