/**
 * 外部判定接口负责鉴权和 HTTP 格式转换，队列规则归 corpus/judgment.ts。
 * 接口只保存组上的判定原话，词表、释义和边由整理任务持锁校验并写入。
 * 对外提供短说法、人数和判定标准；部署限流由网关承担。
 */

import "@tanstack/react-start/server-only";
import { GLOSS_GUIDE } from "#/corpus/gloss";
import {
	agentJudge,
	type Judge,
	type Member,
	openGroups,
	REVIEW_INTERVAL_DAYS,
	type Submission,
	submitJudgment,
} from "#/corpus/judgment";
import { guideIdentities } from "#/corpus/review";
import { GUIDE } from "#/corpus/vocabulary";
import { pool } from "#/db";
import type { GroupKind } from "#/db/schema";
import { reviewConfigured as chatReviewConfigured } from "./chat";

/** 一次最多取几组。要得更多就多取一次——一份响应大到要翻页就没人读得完。 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/** 一份判定最大多少字节。判定方只回答一组几十个词，超出这个数的不是判定。 */
const MAX_BODY = 64 * 1024;

function token(): string {
	return process.env.REVIEW_TOKEN?.trim() ?? "";
}

/**
 * 整理的唯一模式开关。未显式选择时，有完整模型配置就用模型，否则关闭；拼错配置和
 * 显式选择一个不可用的模型都直接报错，避免任务看似运行却永远没有判定结果。
 */
export function reviewJudge(): Judge {
	const value = process.env.REVIEW_JUDGE?.trim();
	if (!value) return chatReviewConfigured() ? "model" : "off";
	if (value !== "model" && value !== "external" && value !== "off")
		throw new Error(
			`REVIEW_JUDGE=${value} 无效，只能是 model、external 或 off`,
		);
	if (value === "model" && !chatReviewConfigured())
		throw new Error(
			"REVIEW_JUDGE=model 需要 EXTRACT_BASE_URL 与 REVIEW_MODEL 或 EXTRACT_MODEL",
		);
	return value;
}

/**
 * 仅外部判定模式且已配置凭据时开放接口。
 * 路由据此区分接口不可用（404）与凭据错误（401）。
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
 * 判定方据此安排自己的工作。
 */
type GroupView = {
	id: number;
	kind: GroupKind;
	guideIdentity: string;
	words: Member[];
	collectedAt: string;
	expiresAt: string;
};

/**
 * 未判定且未过期的组按收集顺序返回，可被多个读者取走，接受首份提交。
 * guides 与自带模型共用各类组的判定标准。
 */
export async function pending(limit: number): Promise<{
	groups: GroupView[];
	guides: Record<GroupKind, { identity: string; text: string }>;
}> {
	const identities = guideIdentities();
	const rows = [
		...(await openGroups(pool, "group", identities.group, limit)),
		...(await openGroups(pool, "gloss", identities.gloss, limit)),
	]
		.sort(
			(a, b) =>
				a.collectedAt.getTime() - b.collectedAt.getTime() || a.id - b.id,
		)
		.slice(0, limit);
	return {
		groups: rows.map((one) => ({
			collectedAt: one.collectedAt.toISOString(),
			expiresAt: new Date(
				one.collectedAt.getTime() + REVIEW_INTERVAL_DAYS * 86_400_000,
			).toISOString(),
			id: one.id,
			kind: one.kind,
			guideIdentity: one.guideIdentity,
			words: one.words,
		})),
		guides: {
			gloss: { identity: identities.gloss, text: GLOSS_GUIDE },
			group: { identity: identities.group, text: GUIDE },
		},
	};
}

/** 从 URL 上读 `limit`。缺失、非法时用默认值，超上限时取上限，不为一个数否掉整次请求。 */
export function limitOf(url: string): number {
	const raw = Number(new URL(url).searchParams.get("limit"));
	if (!Number.isInteger(raw) || raw <= 0) return DEFAULT_LIMIT;
	return Math.min(raw, MAX_LIMIT);
}

/** 提交的结果：`Submission` 加上两种形状不对。 */
type Submitted =
	| { ok: true; submission: Submission }
	| { ok: false; why: string };

/**
 * 校验请求大小、组身份、判定方和判定数组形状，原话原样保存。
 * 内容按组的当前标准在整理任务生效时校验。
 */
export async function submit(request: Request): Promise<Submitted> {
	const raw = await request.arrayBuffer();
	if (raw.byteLength > MAX_BODY) return { ok: false, why: "这份判定太大" };
	let body: unknown;
	try {
		body = JSON.parse(new TextDecoder().decode(raw));
	} catch {
		return { ok: false, why: "这份判定不是 JSON" };
	}
	if (typeof body !== "object" || body === null)
		return { ok: false, why: "这份判定不是 JSON" };
	const { guideIdentity, id, judge, judgments, kind } = body as Record<
		string,
		unknown
	>;
	if (!Number.isInteger(id)) return { ok: false, why: "缺 id" };
	if (kind !== "group" && kind !== "gloss")
		return { ok: false, why: "kind 不是 group 或 gloss" };
	if (
		typeof guideIdentity !== "string" ||
		!/^[a-f0-9]{64}$/.test(guideIdentity)
	)
		return { ok: false, why: "缺 guideIdentity" };
	const name = agentJudge(judge);
	if (!name)
		return {
			ok: false,
			why: "judge 要是 1 到 40 个字母、数字、-、_ 或 .",
		};
	if (!Array.isArray(judgments))
		return { ok: false, why: "judgments 不是数组" };
	if (guideIdentity !== guideIdentities()[kind])
		return { ok: true, submission: "missing" };
	return {
		ok: true,
		submission: await submitJudgment(
			pool,
			id as number,
			kind,
			guideIdentity,
			name,
			judgments,
		),
	};
}
