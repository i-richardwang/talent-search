/**
 * 整理的判定队列：收集、取走、提交判定、过期，以及生效时取回判定结果。两种组
 * （归并、释义）共用这一条队列和这一个判定方，各自的标准、收窄与落表在
 * `vocabulary.ts` 和 `gloss.ts`；整轮的顺序在 `review.ts`。
 *
 * 队列只认一件事：一组词、谁判的、判成什么。它不读判定结果的内容——什么算一条
 * 有效的判断是生效时各自那一种组的事，改收窄规则不该让已经提交的判定失效。
 */

import "@tanstack/react-start/server-only";
import type { GroupKind } from "#/db/schema";
import type { Report } from "./report";
import type { CorpusClient } from "./session";

/** 一个词判过之后多久才再做中心词；也是一组挂在队列里没人判的话多久过期。 */
export const REVIEW_INTERVAL_DAYS = 7;

/**
 * 谁来判。`REVIEW_JUDGE` 定，和模型名一个待遇：部署方的决定，重启生效。
 *
 * - `model`：自带的模型判定。收集、判定、生效在同一轮里连着做，队列跑完是空的。
 * - `external`：只收集和生效，组挂在队列里等外部 agent 提交（`src/server/review.ts`）。
 * - `off`：整理不跑（拦在 `src/server/jobs.ts`）。队列里已有的组留着，切回来接着算。
 *
 * 认不出的取值当 `model`：整理停摆是没人会发现的那种坏——筛选栏照常有词，只是
 * 新写法再也不合并了。
 */
export type Judge = "model" | "external" | "off";

export function reviewJudge(): Judge {
	const value = process.env.REVIEW_JUDGE?.trim();
	if (value === "external" || value === "off" || value === "model")
		return value;
	if (value)
		console.error(
			`REVIEW_JUDGE=${value} 认不出，按 model 处理（自带模型判定）`,
		);
	return "model";
}

/** 判定方在库里的写法：自带模型是 `model:<模型名>`，外部 agent 是 `agent:<名字>`。 */
export function modelJudge(model: string): string {
	return `model:${model}`;
}

/**
 * 外部判定方自报的名字，收窄成库里的写法；不合规矩的返回 null。
 *
 * 名字只作留痕（库里记下哪条是谁判的，任务日志按它计数），所以只要求它是个短标识：
 * 接口那一侧不必再想一遍什么算合法，这件事只有这一处知道。
 */
export function agentJudge(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return /^[A-Za-z0-9._-]{1,40}$/.test(trimmed) ? `agent:${trimmed}` : null;
}

/** 组里的一个词，和收集那一刻它下面的人数。 */
export type Member = { word: string; people: number };

/** 一组发给判定方时长的样子。人数就在组上，不另查一遍语料。 */
export function promptOf(words: Member[]): string {
	return words.map((one) => `${one.word}（${one.people} 人）`).join("\n");
}

/** 队列里的一组待判的词。 */
export type Group = {
	id: number;
	kind: GroupKind;
	words: Member[];
	collectedAt: Date;
};

/** 一组判过的：生效时读的形状，`judge` 与 `judgment` 都在。 */
export type Judged = Group & { judge: string; judgment: unknown };

/** 一组还没过期的判据，`collected_at` 上的那一句。读队列的地方共用它。 */
const FRESH = `collected_at > now() - interval '${REVIEW_INTERVAL_DAYS} days'`;

type Row = {
	id: number;
	kind: GroupKind;
	words: Member[];
	collected_at: Date;
	judge: string | null;
	judgment: unknown;
};

function group(row: Row): Group {
	return {
		collectedAt: row.collected_at,
		id: row.id,
		kind: row.kind,
		words: row.words,
	};
}

/**
 * 队列里还等着人判的组，最早收集的在前。
 *
 * 两个读者：外部判定方取走（`src/server/review.ts`），以及自带模型判——模型判的
 * 是**所有**没判的组，不只是这一轮刚收的那些，于是上一次端点抖动漏掉的组下一轮
 * 会补上，从 `external` 切回 `model` 时挂着的组也接得上。
 */
export async function openGroups(
	client: CorpusClient,
	limit?: number,
): Promise<Group[]> {
	const { rows } = await client.query<Row>(
		`select id, kind, words, collected_at, judge, judgment
		 from review_group
		 where judge is null and ${FRESH}
		 order by collected_at, id
		 ${limit === undefined ? "" : "limit $1"}`,
		limit === undefined ? [] : [limit],
	);
	return rows.map(group);
}

/** 队列里（没判的和判了还没生效的）组上出现的所有词：这一轮收集要绕开它们。 */
export async function busyWords(
	client: CorpusClient,
	kind: GroupKind,
): Promise<Set<string>> {
	const { rows } = await client.query<{ words: Member[] }>(
		`select words from review_group where kind = $1 and ${FRESH}`,
		[kind],
	);
	return new Set(rows.flatMap((row) => row.words.map((one) => one.word)));
}

/**
 * 收集：每组词落一行，进队列等人判。
 *
 * 一个词同时出现在两组同一种的组里，两份判定就会各说各的，而生效时挑哪一份都得
 * 有个说法——所以收集方先用 `busyWords` 绕开队列里已有的词。
 */
export async function collect(
	client: CorpusClient,
	kind: GroupKind,
	groups: Member[][],
): Promise<void> {
	if (groups.length === 0) return;
	await client.query(
		`insert into review_group (kind, words)
		 select $1, * from unnest($2::jsonb[])`,
		[kind, groups.map((one) => JSON.stringify(one))],
	);
}

/**
 * 一次提交的下场。组不在了和已经有人判过分开说：提交的一方要据此决定重不重试。
 */
export type Submission = "accepted" | "missing" | "taken";

/**
 * 把一份判定记在组上。**只写组这一行**，不碰词表、释义也不碰边——那些只在生效时改，
 * 而生效拿着语料的写者锁。所以外部提交不必等派生放锁。
 *
 * 先到先得：一组只有第一份判定落下，第二份得到 `taken`。不投票、不仲裁——两份
 * 判定不一致时挑哪一份都得有个说法，而「先到的算」是唯一不需要说法的那个。
 */
export async function submitJudgment(
	client: CorpusClient,
	id: number,
	judge: string,
	judgments: unknown,
): Promise<Submission> {
	const { rowCount } = await client.query(
		`update review_group set judge = $2, judgment = $3
		 where id = $1 and judge is null and ${FRESH}`,
		[id, judge, JSON.stringify({ judgments })],
	);
	if (rowCount) return "accepted";
	const { rows } = await client.query<{ judge: string | null }>(
		`select judge from review_group where id = $1 and ${FRESH}`,
		[id],
	);
	return rows[0]?.judge ? "taken" : "missing";
}

/**
 * 自带模型的判定成批记在组上。答不出合法 JSON 的那几组（回答是 undefined）留在
 * 队列里，下一轮再问。
 */
export async function recordJudgments(
	client: CorpusClient,
	judge: string,
	replies: [id: number, payload: unknown][],
): Promise<void> {
	const done = replies.filter(([, payload]) => payload !== undefined);
	if (done.length === 0) return;
	await client.query(
		`update review_group r set judge = a.judge, judgment = a.judgment
		 from unnest($1::int[], $2::text[], $3::jsonb[]) as a(id, judge, judgment)
		 where r.id = a.id and r.judge is null`,
		[
			done.map(([id]) => id),
			done.map(() => judge),
			done.map(([, payload]) => JSON.stringify(payload)),
		],
	);
}

/** 到期没人判的组过期：一周没人来判，说明这一轮没有判定方，下一轮重新收集。 */
export async function expire(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const { rowCount } = await client.query(
		`delete from review_group where judge is null and not (${FRESH})`,
	);
	if (rowCount)
		report(`  ${rowCount} 组过了 ${REVIEW_INTERVAL_DAYS} 天没人判，已过期`);
}

/** 某一种组里判过的、等着生效的，按收集顺序。 */
export async function judged(
	client: CorpusClient,
	kind: GroupKind,
): Promise<Judged[]> {
	const { rows } = await client.query<Row>(
		`select id, kind, words, collected_at, judge, judgment
		 from review_group where kind = $1 and judge is not null order by id`,
		[kind],
	);
	// `judge is not null` 是这条查询的谓词，所以这一列在这里一定有值
	return rows.map((row) => ({
		...group(row),
		judge: row.judge as string,
		judgment: row.judgment,
	}));
}

/** 生效完的组从队列里删掉。和落表在同一笔事务里，否则下一轮会把同一份判定再算一遍。 */
export async function remove(
	client: CorpusClient,
	ids: number[],
): Promise<void> {
	if (ids.length === 0) return;
	await client.query("delete from review_group where id = any($1::int[])", [
		ids,
	]);
}

/** 判定按判定方计数，报告里用：`agent:hr-bot 3 组、model:x 1 组`。 */
export function byJudge(rows: Judged[]): string {
	const counts = new Map<string, number>();
	for (const row of rows)
		counts.set(row.judge, (counts.get(row.judge) ?? 0) + 1);
	return [...counts].map(([judge, count]) => `${judge} ${count} 组`).join("、");
}
