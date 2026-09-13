/**
 * 外部裁判的那道口子：拉题、交卷。整理任务里「判卷」这一步的 HTTP 形状。
 *
 * 只有两件事在这里——**认人**和**译形状**。谁能答、答卷长什么样、一道题活多久，
 * 全在 `src/corpus/vocabulary.ts`：那里是整理这件事的主人，接口只是它的另一个入口。
 *
 * **这条路只写题那一行。** 词表和边由整理任务在写者锁里改（`corpus/session.ts`），
 * 所以交卷不必等派生放锁几十分钟；外部也永远拿不到改词表的权限，它交上来的
 * 原话要过 `conform` 才算数，和自带模型交上来的走同一处收窄。
 *
 * **出这台机器的只有能力词和人数。** 没有姓名、工号，也没有简历原文——这条接口的
 * 数据边界比抽取端点窄得多，README 的部署那一章按这一档写。
 *
 * 限流按老规矩做在网关层：进程内计数器盖不住多实例。
 */

import "@tanstack/react-start/server-only";
import {
	agentJudge,
	GUIDE,
	openQuestions,
	REVIEW_INTERVAL_DAYS,
	reviewJudge,
	type Submission,
	submitAnswer,
} from "#/corpus/vocabulary";
import { pool } from "#/db";

/** 一次最多拉几道题。要得更多就多拉一次——一份响应大到要翻页就没人读得完。 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/** 一份答卷最大多少字节。裁判只回答一组十来个词，超出这个数的不是答卷。 */
const MAX_BODY = 64 * 1024;

function token(): string {
	return process.env.REVIEW_TOKEN?.trim() ?? "";
}

/**
 * 这条路通不通：**判卷归外部，而且配了凭据**，两样缺一就当接口不存在。
 *
 * 开关只有 `REVIEW_JUDGE` 一个。自带模型判卷时队列里的题在同一轮就被答掉，外面
 * 拉到的永远是空名单、交卷永远是 404 或 409——一条只会说「不」的接口不如没有；
 * 关掉整理时更没有人会来结算答卷。所以接口不另设一个开关，也不在 `model` 或 `off`
 * 下摆出一副能用的样子。判卷归外部却没配凭据是配错了，整理任务会在记录里说出来
 * （`src/server/tasks.ts`），这里只管不开门。
 *
 * 没配与配了但对不上，回给外面的下场不一样（404 与 401），判断只有这一处。
 */
export function configured(): boolean {
	return reviewJudge() === "external" && token().length > 0;
}

export function authorized(request: Request): boolean {
	const header = request.headers.get("authorization") ?? "";
	const expected = `Bearer ${token()}`;
	return configured() && header === expected;
}

/**
 * 题在响应里的样子：一组词，各带人数，没有谁是「标准词」——标准写法由结算按人数定，
 * 归属由裁判起名。`expiresAt` 说这道题还能答到什么时候，裁判据此排自己的活。
 */
type QuestionView = {
	id: number;
	words: { word: string; people: number }[];
	askedAt: string;
	expiresAt: string;
};

/**
 * 拉题：还没人答、还没过期的题，最早出的在前。
 *
 * **没有租约。** 两个裁判拉到同一道题是允许的，先交的算（`submitAnswer`）；租约会
 * 换来一个新的中间状态——「租了没答」，而它的代价只是偶尔一次白判。
 *
 * `guide` 就是发给自带模型的那段判卷标准，一字不差：标准只有一份，两种裁判照着
 * 同一段字判。
 */
export async function questions(
	limit: number,
): Promise<{ questions: QuestionView[]; guide: string }> {
	const rows = await openQuestions(pool, limit);
	return {
		guide: GUIDE,
		questions: rows.map((one) => ({
			askedAt: one.askedAt.toISOString(),
			expiresAt: new Date(
				one.askedAt.getTime() + REVIEW_INTERVAL_DAYS * 86_400_000,
			).toISOString(),
			id: one.id,
			words: one.words,
		})),
	};
}

/** 从 URL 上读 `limit`。缺失、非法、超上限一律收窄，不为一个数作废整次请求。 */
export function limitOf(url: string): number {
	const raw = Number(new URL(url).searchParams.get("limit"));
	if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_LIMIT;
	return Math.min(raw, MAX_LIMIT);
}

/** 交卷的下场：`Submission` 加上两种形状不对。 */
type Answered =
	| { ok: true; submission: Submission }
	| { ok: false; why: string };

/**
 * 交卷。
 *
 * **原话原样存进题里，这里不收窄**：什么算一条有效的判断是结算时的事
 * （`conform`），改收窄规则不该让已经交上来的答卷失效。这里只看形状——认得出
 * 是哪道题、是谁答的、答卷是不是一串判断。
 */
export async function answer(request: Request): Promise<Answered> {
	const raw = await request.text();
	if (raw.length > MAX_BODY) return { ok: false, why: "答卷太大" };
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return { ok: false, why: "答卷不是 JSON" };
	}
	if (typeof body !== "object" || body === null)
		return { ok: false, why: "答卷不是 JSON" };
	const { id, judge, judgments } = body as Record<string, unknown>;
	if (!Number.isInteger(id)) return { ok: false, why: "缺 id" };
	const name = agentJudge(judge);
	if (!name)
		return {
			ok: false,
			why: "judge 要是 1 到 40 个字母、数字、-、_ 或 .",
		};
	if (!Array.isArray(judgments))
		return { ok: false, why: "judgments 不是数组" };
	return {
		ok: true,
		submission: await submitAnswer(pool, id as number, name, judgments),
	};
}
