/**
 * 整理的题目队列：出题、拉题、交卷、作废、结算时取答卷。两种题（圈组、释义）
 * 共用这一条队列和这一个裁判，各自的标准、收窄与落表在 `vocabulary.ts` 和
 * `gloss.ts`；整轮的顺序在 `review.ts`。
 *
 * 队列只认「题」：一组词、谁答的、答了什么。它不读答卷的内容——什么算一条有效的
 * 判断是结算时各自那一种题的事，改收窄规则不该让已经交上来的答卷失效。
 */

import "@tanstack/react-start/server-only";
import type { QuestionKind } from "#/db/schema";
import type { Report } from "./report";
import type { CorpusClient } from "./session";

/** 一个词判过之后多久才再做中心词；也是一道题没人答的话多久作废。 */
export const REVIEW_INTERVAL_DAYS = 7;

/**
 * 谁来判卷。`REVIEW_JUDGE` 定，和模型名一个待遇：部署方的决定，重启生效。
 *
 * - `model`：自带的模型裁判。出题、答题、结算在同一轮里连着做，队列跑完是空的。
 * - `external`：只出题和结算，题挂在队列里等外部 agent 交卷（`src/server/review.ts`）。
 * - `off`：整理不跑（拦在 `src/server/jobs.ts`）。队列里已有的题留着，切回来接着算。
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
			`REVIEW_JUDGE=${value} 认不出，按 model 处理（自带模型判卷）`,
		);
	return "model";
}

/** 裁判在库里的写法：自带模型是 `model:<模型名>`，外部 agent 是 `agent:<名字>`。 */
export function modelJudge(model: string): string {
	return `model:${model}`;
}

/**
 * 外部裁判自报的名字，收窄成库里的写法；不合规矩的返回 null。
 *
 * 名字只作显示（管理页上「这条是谁判的」），所以只要求它是个短标识：接口那一侧
 * 不必再想一遍什么算合法，这件事只有这一处知道。
 */
export function agentJudge(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return /^[A-Za-z0-9._-]{1,40}$/.test(trimmed) ? `agent:${trimmed}` : null;
}

/** 题里的一个词，和出题那一刻它下面的人数。 */
export type Member = { word: string; people: number };

/** 一道题发给裁判时长的样子。人数就在题上，不另查一遍语料。 */
export function promptOf(words: Member[]): string {
	return words.map((one) => `${one.word}（${one.people} 人）`).join("\n");
}

/** 队列里的一道题。 */
export type Question = {
	id: number;
	kind: QuestionKind;
	words: Member[];
	askedAt: Date;
};

/** 一道答过的题：结算时读的形状，`judge` 与 `answer` 都在。 */
export type Answered = Question & { judge: string; answer: unknown };

/** 一道题还没过期的判据，`asked_at` 上的那一句。读队列的地方共用它。 */
const FRESH = `asked_at > now() - interval '${REVIEW_INTERVAL_DAYS} days'`;

type Row = {
	id: number;
	kind: QuestionKind;
	words: Member[];
	asked_at: Date;
	judge: string | null;
	answer: unknown;
};

function question(row: Row): Question {
	return {
		askedAt: row.asked_at,
		id: row.id,
		kind: row.kind,
		words: row.words,
	};
}

/**
 * 队列里还等着人答的题，最早出的在前。
 *
 * 两个读者：外部裁判拉题（`src/server/review.ts`），以及自带模型答题——模型答的
 * 是**所有**没答的题，不只是这一轮刚出的那些，于是上一次端点抖动漏掉的题下一轮
 * 会补上，从 `external` 切回 `model` 时挂着的题也接得上。
 */
export async function openQuestions(
	client: CorpusClient,
	limit?: number,
): Promise<Question[]> {
	const { rows } = await client.query<Row>(
		`select id, kind, words, asked_at, judge, answer
		 from review_question
		 where judge is null and ${FRESH}
		 order by asked_at, id
		 ${limit === undefined ? "" : "limit $1"}`,
		limit === undefined ? [] : [limit],
	);
	return rows.map(question);
}

/** 队列里（没答的和答了还没结算的）题上出现的所有词：这一轮出题要绕开它们。 */
export async function busyWords(
	client: CorpusClient,
	kind: QuestionKind,
): Promise<Set<string>> {
	const { rows } = await client.query<{ words: Member[] }>(
		`select words from review_question where kind = $1 and ${FRESH}`,
		[kind],
	);
	return new Set(rows.flatMap((row) => row.words.map((one) => one.word)));
}

/**
 * 出题：每组词落一行。
 *
 * 一个词同时出现在两道同种的题里，两份答卷就会各说各的，而结算时挑哪一份都得
 * 有个说法——所以出题方先用 `busyWords` 绕开队列里已有的词。
 */
export async function pose(
	client: CorpusClient,
	kind: QuestionKind,
	groups: Member[][],
): Promise<void> {
	if (groups.length === 0) return;
	await client.query(
		`insert into review_question (kind, words)
		 select $1, * from unnest($2::jsonb[])`,
		[kind, groups.map((group) => JSON.stringify(group))],
	);
}

/** 一次交卷的下场。题不在了和已经有人答过分开说：交卷的一方要据此决定重不重试。 */
export type Submission = "accepted" | "missing" | "taken";

/**
 * 把一份答卷记在题上。**只写题这一行**，不碰词表、释义也不碰边——那些只在结算时改，
 * 而结算拿着语料的写者锁。所以外部交卷不必等派生放锁。
 *
 * 先到先得：一道题只有第一份答卷落下，第二份得到 `taken`。不投票、不仲裁——两份
 * 答卷不一致时挑哪一份都得有个说法，而「先到的算」是唯一不需要说法的那个。
 */
export async function submitAnswer(
	client: CorpusClient,
	id: number,
	judge: string,
	judgments: unknown,
): Promise<Submission> {
	const { rowCount } = await client.query(
		`update review_question set judge = $2, answer = $3
		 where id = $1 and judge is null and ${FRESH}`,
		[id, judge, JSON.stringify({ judgments })],
	);
	if (rowCount) return "accepted";
	const { rows } = await client.query<{ judge: string | null }>(
		`select judge from review_question where id = $1 and ${FRESH}`,
		[id],
	);
	return rows[0]?.judge ? "taken" : "missing";
}

/**
 * 自带模型的答卷成批记在题上。答不出合法 JSON 的那几道（回答是 undefined）留在
 * 队列里，下一轮再问。
 */
export async function recordAnswers(
	client: CorpusClient,
	judge: string,
	replies: [id: number, payload: unknown][],
): Promise<void> {
	const answers = replies.filter(([, payload]) => payload !== undefined);
	if (answers.length === 0) return;
	await client.query(
		`update review_question r set judge = a.judge, answer = a.answer
		 from unnest($1::int[], $2::text[], $3::jsonb[]) as a(id, judge, answer)
		 where r.id = a.id and r.judge is null`,
		[
			answers.map(([id]) => id),
			answers.map(() => judge),
			answers.map(([, payload]) => JSON.stringify(payload)),
		],
	);
}

/** 到期没人答的题作废：一周没人来判，说明这一轮没有裁判，下一轮重新出。 */
export async function expire(
	client: CorpusClient,
	report: Report,
): Promise<void> {
	const { rowCount } = await client.query(
		`delete from review_question where judge is null and not (${FRESH})`,
	);
	if (rowCount)
		report(`  ${rowCount} 道题过了 ${REVIEW_INTERVAL_DAYS} 天没人答，作废`);
}

/** 某一种题里答过的、等着结算的，按出题顺序。 */
export async function answered(
	client: CorpusClient,
	kind: QuestionKind,
): Promise<Answered[]> {
	const { rows } = await client.query<Row>(
		`select id, kind, words, asked_at, judge, answer
		 from review_question where kind = $1 and judge is not null order by id`,
		[kind],
	);
	// `judge is not null` 是这条查询的谓词，所以这一列在这里一定有值
	return rows.map((row) => ({
		...question(row),
		answer: row.answer,
		judge: row.judge as string,
	}));
}

/** 结算完的题从队列里删掉。和落表在同一笔事务里，否则下一轮会把同一份答卷再算一遍。 */
export async function remove(
	client: CorpusClient,
	ids: number[],
): Promise<void> {
	if (ids.length === 0) return;
	await client.query("delete from review_question where id = any($1::int[])", [
		ids,
	]);
}

/** 答卷按裁判计数，报告里用：`agent:hr-bot 3 道、model:x 1 道`。 */
export function byJudge(rows: Answered[]): string {
	const counts = new Map<string, number>();
	for (const row of rows)
		counts.set(row.judge, (counts.get(row.judge) ?? 0) + 1);
	return [...counts].map(([judge, count]) => `${judge} ${count} 道`).join("、");
}
