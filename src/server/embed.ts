/**
 * 嵌入端点的配置、请求和向量校验。只有整理用它：把写法相近的词凑成待判的组
 * （`corpus/embed.ts` 管批量与持久缓存）。端点接收简历里读出的短说法，数据边界见 README；
 * 配置或输出无效时抛出错误。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany, InvalidResponseDataError } from "ai";
import { z } from "zod";
import { EMBED_DIM } from "#/db/schema";
import { endpointPolicy, positiveInt } from "./endpoint";

const BASE_URL = process.env.EMBED_BASE_URL?.trim();
const API_KEY = process.env.EMBED_API_KEY;
const MODEL = process.env.EMBED_MODEL?.trim();
const SPACE_ID = process.env.EMBED_SPACE_ID?.trim();

const TIMEOUT_MS = positiveInt(process.env.EMBED_TIMEOUT_MS, 30_000);

/**
 * 一批请求失败重试几次。调用方是一轮要嵌几万个词的批量作业，为一次端点抖动整轮重来的
 * 代价远高于多等几秒。
 */
const RETRIES = 4;

/** 没配时整理不收集新的组，其余照常（`corpus/vocabulary.ts`）。 */
export function embedConfigured(): boolean {
	return Boolean(BASE_URL && MODEL && SPACE_ID);
}

function configured() {
	if (!BASE_URL || !MODEL || !SPACE_ID)
		throw new Error(
			"嵌入端点未配置：需要 EMBED_BASE_URL、EMBED_MODEL 与 EMBED_SPACE_ID（见 .env.example）",
		);
	return { baseURL: BASE_URL, model: MODEL, spaceId: SPACE_ID };
}

/**
 * 这个进程说的嵌入空间：稳定身份与模型名，向量缓存按它分开存。模型、权重、归一化或端点
 * 实现变了就换 `EMBED_SPACE_ID`，旧空间的向量不再被读到。未配置时抛出错误。
 */
export function embedSpace(): { spaceId: string; model: string } {
	const { spaceId, model } = configured();
	return { spaceId, model };
}

type EmbeddingModel = ReturnType<
	ReturnType<typeof createOpenAICompatible>["embeddingModel"]
>;
let model: EmbeddingModel | undefined;
function getModel() {
	const config = configured();
	model ??= createOpenAICompatible({
		name: "talent-embed",
		baseURL: config.baseURL,
		...(API_KEY && { apiKey: API_KEY }),
		// 每一批的请求各自超时、各自重试（见 `endpoint.ts`）
		fetch: endpointPolicy({ timeoutMs: TIMEOUT_MS, retries: RETRIES }).fetch,
	}).embeddingModel(config.model);
	return model;
}

const EMBEDDING_RESPONSE = z.object({
	data: z.array(
		z.object({
			index: z.int().nonnegative(),
			embedding: z.array(z.number()),
		}),
	),
});

/**
 * 按响应索引对应请求文本，拒绝重复、越界或无效向量。SDK 负责分批并核对每批的向量数，
 * 每一批的超时与重试在 `endpointPolicy`。SDK 按回答里的先后排列向量、不读索引，所以
 * 对应关系在这里按原始响应体里的索引重排。
 */
async function request(values: string[]): Promise<Map<string, number[]>> {
	const { responses } = await embedMany({
		model: getModel(),
		values,
		maxRetries: 0,
	}).catch((error) => {
		// SDK 比对每批的向量数，比到不一致时抛它的英文错误
		if (InvalidResponseDataError.isInstance(error))
			throw new Error("嵌入端点返回的向量数与请求不一致", { cause: error });
		throw error;
	});
	const out = new Map<string, number[]>();
	let offset = 0;
	// 原始响应体是可选字段；没有它就对不上索引
	for (const response of responses ?? [undefined]) {
		const parsed = EMBEDDING_RESPONSE.safeParse(response?.body);
		if (!parsed.success) throw new Error("嵌入端点响应缺少有效的索引与向量");
		// 每批的向量数 SDK 已经核对过等于这一批的文本数，索引各占一位就一个不缺
		const batch = parsed.data.data;
		const seen = new Set<number>();
		for (const { index, embedding } of batch) {
			if (index >= batch.length || seen.has(index))
				throw new Error("嵌入端点返回了重复或越界的向量索引");
			seen.add(index);
			if (
				embedding.length !== EMBED_DIM ||
				embedding.some((value) => !Number.isFinite(value)) ||
				!embedding.some((value) => value !== 0)
			)
				throw new Error(
					`嵌入端点返回了无效向量：期望 ${EMBED_DIM} 个有限数值且范数非零`,
				);
			const text = values[offset + index];
			if (text !== undefined) out.set(text, embedding);
		}
		offset += batch.length;
	}
	return out;
}

/** 直接请求端点，按入参顺序返回向量；持久缓存在 `corpus/embed.ts`。 */
export async function embedFresh(values: string[]): Promise<number[][]> {
	if (values.length === 0) return [];
	const vectors = await request(values);
	return values.map((text) => {
		const vector = vectors.get(text);
		if (!vector)
			throw new Error(`嵌入端点漏掉了一个文本：${text.slice(0, 40)}`);
		return vector;
	});
}
