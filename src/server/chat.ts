/**
 * 语料侧调用聊天端点的那一层：一段文字进、一份 JSON 出，回答留在库里。
 *
 * 三处用它——`corpus/extract.ts`（简历描述 → 能力词与做过的事）、
 * `corpus/align.ts`（入职前岗位 → 公司序列）和 `corpus/vocabulary.ts`（能力词的
 * 写法归并）。它们各有各的模型、提示词、schema 与收窄，这里只有对三者都成立的
 * 事：把话发出去、要一份 JSON、控制并发、报进度，以及按身份键入的缓存。
 *
 * **缓存里存的是模型给的那份 JSON**——按 schema 定过形（不合形的段不进缓存，
 * 见 `ask`），但没有收窄：长度、枚举、去重这些判断在调用方读出时做，改收窄规则
 * 不动缓存。缓存的
 * 键是模型名、系统提示词与 schema 的摘要加上那段文字：会改变回答的东西都在键里，
 * 改了提示词（含对齐提示词里列出的那棵序列树）旧回答自然失效，不用人记得换什么
 * 身份。同一段文字、同一份提示词、同一个模型，永远同一份回答。
 *
 * **模型输出是不可信输入。** 答不出合法 JSON 的那一段打印说明后放弃、不进缓存，
 * 下次重跑再问；一个异常的响应不该让一整批派生回滚。
 *
 * 和查询侧那三个适配层一样，这里**没有判断**：什么算能力词、序列树长什么样、
 * 哪些写法算同一件事，全在各自的调用方。
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
import { positiveInt, retryingTimeouts, timeoutFetch } from "./endpoint";

const BASE_URL = process.env.EXTRACT_BASE_URL;
const API_KEY = process.env.EXTRACT_API_KEY;

/**
 * 端点支不支持 `response_format: json_schema`。兼容层默认**关**这个开关，关着
 * 的时候 schema 根本没出门，模型全靠提示词自觉。所以这里默认打开；碰上老网关
 * 不认 json_schema，把 `EXTRACT_STRUCTURED_OUTPUTS=false` 设上即可。
 */
const STRUCTURED = process.env.EXTRACT_STRUCTURED_OUTPUTS !== "false";

/**
 * 推理模型的思考开关。设了才随请求发出（`enable_thinking`，SiliconFlow 一类
 * 网关认它）；不设就不发，标准 OpenAI 端点不会收到一个它不认的字段。抽取这几件
 * 事都不需要思考轨迹，而思考会先把输出预算烧光、返回空内容，所以带思考的模型
 * 应当设成 false。
 */
const ENABLE_THINKING = process.env.EXTRACT_ENABLE_THINKING?.trim();

const TIMEOUT_MS = positiveInt(process.env.EXTRACT_TIMEOUT_MS, 120_000);
const CONCURRENCY = positiveInt(process.env.EXTRACT_CONCURRENCY, 4);
/**
 * 一段文字失败了再试几次。比查询侧多：一轮派生要跑几千段、几十分钟，为一次端点
 * 抖动整轮重来的代价远高于多等几次。
 */
const RETRIES = 4;
/**
 * 输出预算按「思考轨迹也算输出」给：推理模型在第一个字符之前先烧掉几百到上千
 * token，`auto` 一类按请求路由的网关还会换到更啰嗦的模型。给小了它在思考阶段撞上限，
 * 返回空内容而不报错。默认取宽，两个端点同一个数（`llm.ts`）。
 */
const MAX_OUTPUT_TOKENS = positiveInt(
	process.env.EXTRACT_MAX_OUTPUT_TOKENS,
	16_000,
);

/**
 * 端点整体配好了没有。地址和模型名缺一个就当没配：派生会打印说明后跳过这三件
 * 事，检索照常可用，只是能力词与做过的事两路为空、入职前经历不对齐序列。
 */
export function chatConfigured(): boolean {
	return Boolean(BASE_URL && process.env.EXTRACT_MODEL?.trim());
}

export function extractModel(): string {
	return process.env.EXTRACT_MODEL?.trim() ?? "";
}

/**
 * 整理能力词写法用的模型，同一个端点；不设就用抽取模型。这一步只有两百来组，
 * 却要在「团队培训」和「团队管理」之间划线，小模型划不动，值得单独给一个大的。
 */
export function reviewModel(): string {
	return process.env.REVIEW_MODEL?.trim() || extractModel();
}

export function chatEndpoint(): string {
	return BASE_URL ?? "";
}

// provider 延迟到首次使用时创建，未配置端点的进程可以安全导入本模块。
// 三处调用共用同一个端点，只有模型名不同，所以 provider 只有一个。
let provider: ReturnType<typeof createOpenAICompatible> | null = null;
function getModel(model: string) {
	if (!BASE_URL || !model)
		throw new Error(
			"抽取端点未配置：需要 EXTRACT_BASE_URL 与 EXTRACT_MODEL（见 .env.example）",
		);
	if (!provider)
		provider = createOpenAICompatible({
			name: "talent-chat",
			baseURL: BASE_URL,
			supportsStructuredOutputs: STRUCTURED,
			...(API_KEY && { apiKey: API_KEY }),
			// 超时装在每一次请求上，每一次尝试各有一份预算（见 `endpoint.ts`）
			fetch: timeoutFetch(TIMEOUT_MS),
			// 兼容层的 provider 选项里没有 `enable_thinking`，它是网关自己的字段，
			// 只能在请求体成形之后补上去——这个钩子正是为此存在的。
			...(ENABLE_THINKING && {
				transformRequestBody: (body: Record<string, unknown>) => ({
					...body,
					enable_thinking: ENABLE_THINKING === "true",
				}),
			}),
		});
	return provider(model);
}

function sha(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/**
 * 一批问题的身份：模型、提示词、schema。它是缓存的一半键，另一半是那段文字。
 * 派生任务也拿它算「派生到哪一版」（`corpus/derive.ts`）：会改变回答的东西变了，
 * 段就该重新派生，和缓存失效是同一个判据。
 */
export function identityOf(
	model: string,
	system: string,
	schema: z.ZodType<unknown>,
): string {
	return sha(
		[model, system, JSON.stringify(z.toJSONSchema(schema))].join("\u001f"),
	);
}

/** 一次查缓存问多少段。绑定参数有上限，几千段的语料一次问完会撞上它。 */
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

/**
 * 写的只有刚问回来的、库里刚查过没有的段，而同一时刻只有一个写者在跑
 * （`corpus/session.ts` 的锁），所以主键不会撞：撞了就是这两条前提有一条破了，让它报错。
 */
async function store(identity: string, text: string, payload: unknown) {
	await db
		.insert(completionCache)
		.values({ identity, textSha: sha(text), payload });
}

/**
 * 一段文字的回答；答不出合法 JSON 就说一句、放弃这一段。
 *
 * 瞬时故障重试 `RETRIES` 次：5xx 与限流由 AI SDK 按指数退避、遵守 `Retry-After`
 * 地试，超时由 `retryingTimeouts` 试（分工见 `endpoint.ts`）；每一次尝试各有一份
 * `EXTRACT_TIMEOUT_MS` 的预算。持续失败仍然会把这一轮派生带倒，那说明并发调太高
 * 或端点真的不可用，该改 `EXTRACT_CONCURRENCY`，不该由重试掩盖。
 */
async function ask(
	model: string,
	system: string,
	schema: z.ZodType<unknown>,
	text: string,
	what: string,
	report: Report,
): Promise<unknown> {
	const abandon = (finishReason: unknown, usage: unknown) => {
		report(
			`  ${what}没有得到合法 JSON（finishReason=${finishReason}，` +
				`usage=${JSON.stringify(usage)}），放弃这一段；` +
				"若 finishReason 是 length，调大 EXTRACT_MAX_OUTPUT_TOKENS",
		);
		return undefined;
	};
	let result: Awaited<ReturnType<typeof generateText>>;
	try {
		result = await retryingTimeouts(RETRIES, () =>
			generateText({
				model: getModel(model),
				output: Output.object({ schema }),
				system,
				prompt: text,
				// 这是一次翻译，不是创作：同一段文字每次给同一份回答
				temperature: 0,
				maxRetries: RETRIES,
				maxOutputTokens: MAX_OUTPUT_TOKENS,
			}),
		);
	} catch (error) {
		if (!NoObjectGeneratedError.isInstance(error)) throw error;
		return abandon(error.finishReason, error.usage);
	}
	// 正文为空的应答（思考轨迹烧光预算、finishReason 不是 stop）不在上面那个异常里：
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
 *
 * 先查缓存、再去重、最后才打端点；`what` 是进度和报错里的名字（「抽取」「对齐」）。
 */
export async function complete(
	model: string,
	system: string,
	schema: z.ZodType<unknown>,
	texts: string[],
	what: string,
	report: Report,
): Promise<Map<string, unknown>> {
	const identity = identityOf(model, system, schema);
	const unique = [...new Set(texts)];
	const payloads = await cached(identity, unique);
	const missing = unique.filter((text) => !payloads.has(text));

	let done = 0;
	await pool(missing, CONCURRENCY, async (text) => {
		const payload = await ask(model, system, schema, text, what, report);
		done++;
		if (payload !== undefined) {
			await store(identity, text, payload);
			payloads.set(text, payload);
		}
		if (done % 20 === 0 || done === missing.length)
			report(`  已${what} ${done}/${missing.length}`);
	});
	return payloads;
}

/**
 * 最多 `limit` 个一起跑，做完一个补一个。
 *
 * 不用 `Promise.all` 切批：切批的话每一批都得等最慢的那一个，几千段下来白等的
 * 时间比跑的时间还长。
 */
async function pool<T>(
	items: T[],
	limit: number,
	work: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const workers = Array.from(
		{ length: Math.min(limit, items.length) },
		async () => {
			while (next < items.length) {
				const item = items[next++];
				if (item !== undefined) await work(item);
			}
		},
	);
	await Promise.all(workers);
}
