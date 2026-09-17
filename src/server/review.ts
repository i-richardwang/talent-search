/**
 * 外部判定方的那道口子：取走待判的组、提交判定。整理任务里「判定」这一步的 HTTP 形状。
 *
 * 只有两件事在这里——**认人**和**译形状**。谁能判、一组活多久在 `src/corpus/judgment.ts`，
 * 判定结果长什么样在各自那一种组的模块里：接口只是队列的另一个入口。
 *
 * **这条路只写组那一行。** 词表、释义和边由整理任务在写者锁里改（`corpus/session.ts`），
 * 所以提交不必等派生放锁几十分钟；外部也永远拿不到改词表的权限，它交上来的
 * 原话要过 `conform` 才算数，和自带模型交上来的走同一处收窄。
 *
 * **出这台机器的只有短说法和人数。** 没有姓名、工号，也没有简历原文——这条接口的
 * 数据边界比抽取端点窄得多，README 的部署那一章按这一档写。
 *
 * 限流按老规矩做在网关层：进程内计数器盖不住多实例。
 */

import "@tanstack/react-start/server-only";
import { GLOSS_GUIDE } from "#/corpus/gloss";
import {
	agentJudge,
	type Member,
	openGroups,
	REVIEW_INTERVAL_DAYS,
	reviewJudge,
	type Submission,
	submitJudgment,
} from "#/corpus/judgment";
import { GUIDE } from "#/corpus/vocabulary";
import { pool } from "#/db";
import type { GroupKind } from "#/db/schema";

/** 一次最多取几组。要得更多就多取一次——一份响应大到要翻页就没人读得完。 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/** 一份判定最大多少字节。判定方只回答一组几十个词，超出这个数的不是判定。 */
const MAX_BODY = 64 * 1024;

function token(): string {
	return process.env.REVIEW_TOKEN?.trim() ?? "";
}

/**
 * 这条路通不通：**判定归外部，而且配了凭据**，两样缺一就当接口不存在。
 *
 * 开关只有 `REVIEW_JUDGE` 一个。自带模型判定时队列里的组在同一轮就判完了，外面
 * 取到的永远是空名单、提交永远是 404 或 409——一条只会说「不」的接口不如没有；
 * 关掉整理时更没有人会来让判定生效。所以接口不另设一个开关，也不在 `model` 或 `off`
 * 下摆出一副能用的样子。判定归外部却没配凭据是配错了，整理任务会在记录里说出来
 * （`src/server/tasks.ts`），这里只管不放行。
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
 * 一组在响应里的样子：哪一种组，一组词各带人数。归并组里没有谁是「标准词」——标准
 * 写法由生效时按人数定，归属由判定方起名。`expiresAt` 说这一组还能判到什么时候，
 * 判定方据此排自己的活。
 */
type GroupView = {
	id: number;
	kind: GroupKind;
	words: Member[];
	collectedAt: string;
	expiresAt: string;
};

/**
 * 取走：还没人判、还没过期的组，最早收集的在前。
 *
 * **没有租约。** 两方取到同一组是允许的，先提交的算（`submitJudgment`）；租约会
 * 换来一个新的中间状态——「取了没判」，而它的代价只是偶尔一次白判。
 *
 * `guides` 按组的种类给出发给自带模型的那段标准，一字不差：标准每种只有一份，
 * 两边照着同一段字判。
 */
export async function pending(limit: number): Promise<{
	groups: GroupView[];
	guides: Record<GroupKind, string>;
}> {
	const rows = await openGroups(pool, limit);
	return {
		groups: rows.map((one) => ({
			collectedAt: one.collectedAt.toISOString(),
			expiresAt: new Date(
				one.collectedAt.getTime() + REVIEW_INTERVAL_DAYS * 86_400_000,
			).toISOString(),
			id: one.id,
			kind: one.kind,
			words: one.words,
		})),
		guides: { gloss: GLOSS_GUIDE, group: GUIDE },
	};
}

/** 从 URL 上读 `limit`。缺失、非法、超上限一律收窄，不为一个数否掉整次请求。 */
export function limitOf(url: string): number {
	const raw = Number(new URL(url).searchParams.get("limit"));
	if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_LIMIT;
	return Math.min(raw, MAX_LIMIT);
}

/** 提交的下场：`Submission` 加上两种形状不对。 */
type Submitted =
	| { ok: true; submission: Submission }
	| { ok: false; why: string };

/**
 * 提交判定。
 *
 * **原话原样存进组里，这里不收窄**：什么算一条有效的判断是生效时的事
 * （`conform`），改收窄规则不该让已经提交的判定失效。这里只看形状——认得出
 * 是哪一组、是谁判的、判定是不是一串判断。
 */
export async function submit(request: Request): Promise<Submitted> {
	const raw = await request.text();
	if (raw.length > MAX_BODY) return { ok: false, why: "这份判定太大" };
	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return { ok: false, why: "这份判定不是 JSON" };
	}
	if (typeof body !== "object" || body === null)
		return { ok: false, why: "这份判定不是 JSON" };
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
		submission: await submitJudgment(pool, id as number, name, judgments),
	};
}
