/**
 * 语料侧的聊天调用：模型请求、并发控制、进度和持久缓存。
 * 缓存保存通过 schema 校验的原始 JSON；领域校验由调用方执行。
 * 键由模型、提示词、schema 和输入文本确定，同一个输入只保留第一次写入的回答。
 * 无效回答报告后跳过且不缓存；持续的端点故障向调用方抛出。
 */

import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	generateText,
	NoObjectGeneratedError,
	NoOutputGeneratedError,
	Output,
} from "ai";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Report } from "#/corpus/report";
import { db } from "#/db";
import { completionCache } from "#/db/schema";
import { endpointFetch, positiveInt } from "./endpoint";

const BASE_URL = process.env.EXTRACT_BASE_URL?.trim();
const API_KEY = process.env.EXTRACT_API_KEY;

/**
 * 端点支不支持 `response_format: json_schema`。兼容层默认**关**这个开关，关着
 * 的时候 schema 根本没发给端点，模型全靠提示词自觉。所以这里默认打开；碰上老网关
 * 不认 json_schema，把 `EXTRACT_STRUCTURED_OUTPUTS=false` 设上即可。
 */
const STRUCTURED = process.env.EXTRACT_STRUCTURED_OUTPUTS !== "false";

/**
 * 推理模型的思考开关。设了才随请求发出（`enable_thinking`，SiliconFlow 一类
 * 网关认它）；不设就尊重端点默认值，标准 OpenAI 端点不会收到一个它不认的字段。
 */
const ENABLE_THINKING = process.env.EXTRACT_ENABLE_THINKING?.trim();

const TIMEOUT_MS = positiveInt(process.env.EXTRACT_TIMEOUT_MS, 180_000);
const CONCURRENCY = positiveInt(process.env.EXTRACT_CONCURRENCY, 4);
/**
 * 瞬时故障最多重试几次，全部尝试共用这一段的 TIMEOUT_MS 总时限。
 */
const RETRIES = 4;

/**
 * 端点整体配好了没有。地址和模型名缺一个就当没配：解析会打印说明后跳过这三件
 * 事，检索还能用，只是能力词为空、入职前经历不对齐序列。
 */
export function chatConfigured(): boolean {
	return Boolean(BASE_URL && process.env.EXTRACT_MODEL?.trim());
}

/** 整理模型是否完整配置；它可以单独使用 REVIEW_MODEL，不要求同时开启抽取。 */
export function reviewConfigured(): boolean {
	return Boolean(BASE_URL && reviewModel());
}

export function extractModel(): string {
	return process.env.EXTRACT_MODEL?.trim() ?? "";
}

/** 序列对齐用的模型；不设就用抽取模型。 */
export function alignModel(): string {
	return process.env.ALIGN_MODEL?.trim() || extractModel();
}

/**
 * 整理能力词写法用的模型，同一个端点；不设就用抽取模型。这一步只有两百来组，
 * 却要在「团队培训」和「团队管理」之间划线，小模型划不动，值得单独给一个大的。
 */
export function reviewModel(): string {
	return process.env.REVIEW_MODEL?.trim() || extractModel();
}

type ChatEndpoint = "extract" | "align";

// 按调用用途选端点，不按模型名选：同名模型也可能来自不同服务。
function getModel(model: string, endpoint: ChatEndpoint) {
	const alignURL =
		endpoint === "align" ? process.env.ALIGN_BASE_URL?.trim() : undefined;
	const baseURL = alignURL || BASE_URL;
	const apiKey = alignURL ? process.env.ALIGN_API_KEY : API_KEY;
	if (!baseURL || !model)
		throw new Error(
			"聊天端点未配置：需要调用所需的地址与模型（见 .env.example）",
		);
	return createOpenAICompatible({
		name: "talent-chat",
		baseURL,
		supportsStructuredOutputs: STRUCTURED,
		...(apiKey && { apiKey }),
		// 每一次请求各自超时、各自重试（见 `endpoint.ts`）
		fetch: endpointFetch({ timeoutMs: TIMEOUT_MS, retries: RETRIES }),
		// 兼容层的 provider 选项里没有 `enable_thinking`，它是网关自己的字段，
		// 只能在请求体成形之后补上去——这个钩子正是为此存在的。
		...(ENABLE_THINKING && {
			transformRequestBody: (body: Record<string, unknown>) => ({
				...body,
				enable_thinking: ENABLE_THINKING === "true",
			}),
		}),
	})(model);
}

function sha(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * 一批问题的身份：模型、提示词、schema。它是缓存的一半键，另一半是那段文字。
 * 服务地址不参与身份：同一模型按同一标准给出的回答可跨端点复用。
 * 换模型只影响新调用的缓存复用，不让已按同一标准处理的语料失效。
 */
function identityOf(
	model: string,
	system: string,
	schema: z.ZodType<unknown>,
): string {
	return sha(
		[model, system, JSON.stringify(z.toJSONSchema(schema))].join("\u001f"),
	);
}

/**
 * 一份标准的身份：那段提示词，加它要求的回答形状。**不含模型。**
 *
 * 抽取、对齐、释义和归并用它记录结果依据的标准。不同模型或外部判定方按同一份
 * 标准作答，已有结果继续有效；提示词或回答形状变化后才重新处理。
 */
export function standardOf(system: string, schema: z.ZodType<unknown>): string {
	return sha([system, JSON.stringify(z.toJSONSchema(schema))].join("\u001f"));
}

/** 一次查缓存问多少段。绑定参数有上限，几千段的语料一次问完会超过它。 */
const LOOKUP = 500;

async function cached(
	identity: string,
	texts: string[],
): Promise<Map<string, unknown>> {
	const out = new Map<string, unknown>();
	for (let start = 0; start < texts.length; start += LOOKUP) {
		const bySha = new Map(
			texts.slice(start, start + LOOKUP).map((text) => [sha(text), text]),
		);
		const rows = await db
			.select({
				textSha: completionCache.textSha,
				payload: completionCache.payload,
			})
			.from(completionCache)
			.where(
				and(
					eq(completionCache.identity, identity),
					inArray(completionCache.textSha, [...bySha.keys()]),
				),
			);
		for (const row of rows) {
			const text = bySha.get(row.textSha);
			if (text !== undefined) out.set(text, row.payload);
		}
	}
	return out;
}

/** 同一个输入只保留第一次写入的回答，所有调用者返回该值。 */
async function store(identity: string, text: string, payload: unknown) {
	const inserted = await db
		.insert(completionCache)
		.values({ identity, textSha: sha(text), payload })
		.onConflictDoNothing()
		.returning({ payload: completionCache.payload });
	if (inserted.length) return inserted[0]?.payload;
	// 冲突语句结束后重新取快照，才能看到并发事务刚提交的回答。
	const saved = await cached(identity, [text]);
	if (!saved.has(text)) throw new Error("聊天缓存写入后缺失");
	return saved.get(text);
}

/**
 * 一段文字的回答；答不出合法 JSON 就说一句、放弃这一段。
 *
 * 瞬时故障由 `endpointFetch` 重试，整次调用（含重试与正文读取）受 `EXTRACT_TIMEOUT_MS`
 * 限制；不发送输出 token 上限，让模型在时限内完成思考与回答。持续失败让这一轮解析中止。
 */
async function ask(
	model: string,
	system: string,
	schema: z.ZodType<unknown>,
	text: string,
	what: string,
	report: Report,
	endpoint: ChatEndpoint,
): Promise<unknown> {
	const abandon = (finishReason: unknown, usage: unknown) => {
		report(
			`  ${what}没有得到合法 JSON（finishReason=${finishReason}，` +
				`usage=${JSON.stringify(usage)}），放弃这一段`,
		);
		return undefined;
	};
	let result: Awaited<ReturnType<typeof generateText>>;
	try {
		result = await generateText({
			model: getModel(model, endpoint),
			output: Output.object({ schema }),
			instructions: system,
			prompt: text,
			// 降低生成随机性；并发结果的一致性由缓存决定。
			temperature: 0,
			maxRetries: 0,
			timeout: TIMEOUT_MS,
		});
	} catch (error) {
		if (!NoObjectGeneratedError.isInstance(error)) throw error;
		return abandon(error.finishReason, error.usage);
	}
	// 正文为空的应答（思考轨迹用光预算、finishReason 不是 stop）不在上面那个异常里：
	// SDK 把它推迟到取 `output` 的时候才抛。同样是这一段没答好，同样放弃这一段。
	try {
		return result.output;
	} catch (error) {
		if (!NoOutputGeneratedError.isInstance(error)) throw error;
		return abandon(result.finishReason, result.usage);
	}
}

/**
 * 对每段文字要一份 JSON；返回文字 → 模型给的 JSON，放弃的段不在里面。
 * `what` 是进度和报错里的名字（「抽取」「对齐」）。
 */
export async function complete(
	model: string,
	system: string,
	schema: z.ZodType<unknown>,
	texts: string[],
	what: string,
	report: Report,
	endpoint: ChatEndpoint = "extract",
): Promise<Map<string, unknown>> {
	const identity = identityOf(model, system, schema);
	const unique = [...new Set(texts)];
	const payloads = await cached(identity, unique);
	const missing = unique.filter((text) => !payloads.has(text));

	let done = 0;
	await pool(missing, CONCURRENCY, async (text) => {
		const payload = await ask(
			model,
			system,
			schema,
			text,
			what,
			report,
			endpoint,
		);
		done++;
		if (payload !== undefined) {
			payloads.set(text, await store(identity, text, payload));
		}
		if (done % 20 === 0 || done === missing.length)
			report(`  已${what} ${done}/${missing.length}`);
	});
	return payloads;
}

/** 失败后不再领新段，在途请求收尾后才交回首个错误，退出后不遗留后台请求。 */
async function pool<T>(
	items: T[],
	limit: number,
	work: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	let failed = false;
	let firstError: unknown;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			try {
				while (!failed && next < items.length) {
					const item = items[next++];
					if (item !== undefined) await work(item);
				}
			} catch (error) {
				if (!failed) firstError = error;
				failed = true;
			}
		},
	);
	await Promise.all(workers);
	if (failed) throw firstError;
}
