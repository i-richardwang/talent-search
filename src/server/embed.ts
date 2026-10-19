/**
 * 查询与语料共用的嵌入端点、配置和向量校验。
 * 查询每次以新 canary 核验端点，返回向量及语料空间的行版本；缓存只省去重复文本的嵌入。
 * 端点接收查询词与经历内容，数据边界见 README；配置或输出无效时抛出错误。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { cosineSimilarity, embedMany, InvalidResponseDataError } from "ai";
import { getTableColumns, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { EMBED_DIM, embeddingSpace } from "#/db/schema";
import type { DbExecutor } from "#/db/snapshot";
import { endpointFetch, positiveInt } from "./endpoint";

/** 两侧共用修剪后的空间配置。 */
const BASE_URL = process.env.EMBED_BASE_URL?.trim();
const API_KEY = process.env.EMBED_API_KEY;
const MODEL = process.env.EMBED_MODEL?.trim();
const SPACE_ID = process.env.EMBED_SPACE_ID?.trim();

const TIMEOUT_MS = positiveInt(process.env.EMBED_TIMEOUT_MS, 30_000);

/** 稳定空间内的查询词缓存；上限防止进程长期运行时无限增长。 */
const CACHE_MAX = 4096;
const cache = new Map<string, number[]>();

/**
 * 一次检索里嵌入失败重试几次。查询侧只重一次：人在等着，第二次还不行就把错误
 * 交上去，界面画得出「出错了，重试」。语料侧的那个数在 `corpus/embed.ts` 里，
 * 它面对的是一轮跑几十分钟的批量作业，值得等得更久。
 */
const QUERY_RETRIES = 1;

function configured() {
	if (!BASE_URL || !MODEL || !SPACE_ID)
		throw new Error(
			"嵌入端点未配置：需要 EMBED_BASE_URL、EMBED_MODEL 与 EMBED_SPACE_ID（见 .env.example）",
		);
	return { baseURL: BASE_URL, model: MODEL, spaceId: SPACE_ID };
}

/**
 * 这个进程说的嵌入空间：稳定身份与模型名。**两侧的唯一出处**：语料侧把它写进
 * `embedding_space`，查询侧拿它核对那一行。未配置时抛出错误。
 */
export function embedSpace(): { spaceId: string; model: string } {
	const { spaceId, model } = configured();
	return { spaceId, model };
}

type EmbeddingModel = ReturnType<
	ReturnType<typeof createOpenAICompatible>["embeddingModel"]
>;
/** 重试次数装在 provider 的 `fetch` 上，查询侧和语料侧各用各的次数，各一个模型。 */
const models = new Map<number, EmbeddingModel>();
function getModel(retries: number) {
	const config = configured();
	let model = models.get(retries);
	if (!model) {
		model = createOpenAICompatible({
			name: "talent-embed",
			baseURL: config.baseURL,
			...(API_KEY && { apiKey: API_KEY }),
			// 每一批的请求各自超时、各自重试（见 `endpoint.ts`）
			fetch: endpointFetch({ timeoutMs: TIMEOUT_MS, retries }),
		}).embeddingModel(config.model);
		models.set(retries, model);
	}
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
 * 每一批的超时与重试在 `endpointFetch`。SDK 按回答里的先后排列向量、不读索引，所以
 * 对应关系在这里按原始响应体里的索引重排。
 */
async function request(
	values: string[],
	retries: number,
): Promise<Map<string, number[]>> {
	const { responses } = await embedMany({
		model: getModel(retries),
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

const knownSpaceIdentities = new Map<string, string>();

async function storedSpace(store: DbExecutor) {
	configured();
	const rows = await store
		.select({
			...getTableColumns(embeddingSpace),
			generation: sql<string>`${embeddingSpace.spaceId} || ':' || ${embeddingSpace}.xmin::text`,
		})
		.from(embeddingSpace)
		.limit(2);
	const stored = rows[0];
	if (!stored || rows.length !== 1)
		throw new Error("语料没有唯一的嵌入空间元数据，等解析跑一轮");
	return stored;
}

function spaceIdentity(stored: Awaited<ReturnType<typeof storedSpace>>) {
	if (
		stored.spaceId !== SPACE_ID ||
		stored.model !== MODEL ||
		stored.dimension !== EMBED_DIM
	)
		throw new Error(
			`查询端嵌入空间 ${SPACE_ID}/${MODEL}/${EMBED_DIM} 与语料 ${stored.spaceId}/${stored.model}/${stored.dimension} 不一致`,
		);
	const identity = [
		stored.spaceId,
		stored.model,
		stored.dimension,
		stored.canaryText,
		stored.canaryEmbedding.join(","),
	].join("\u0001");
	const known = knownSpaceIdentities.get(stored.spaceId);
	if (known && known !== identity)
		throw new Error(
			`嵌入空间 ${stored.spaceId} 的身份在进程运行期间发生变化，请更换 EMBED_SPACE_ID`,
		);
	return identity;
}

/** 元数据保存的 canary 与本次端点输出必须属于同一空间。 */
export function assertCanary(stored: number[], fresh: number[] | undefined) {
	const similarity = fresh ? cosineSimilarity(fresh, stored) : Number.NaN;
	if (!Number.isFinite(similarity) || similarity < 0.999)
		throw new Error(
			"嵌入端点的实际输出与语料 canary 不一致，请更换 EMBED_SPACE_ID，解析会重算",
		);
}

/**
 * 按入参顺序返回向量及核验依据的空间行版本。canary 与缺少的查询词同批嵌入。
 * 淘汰缓存前先填好本次命中的向量；cacheMax 供测试覆盖缓存容量边界。
 * 空输入不调用端点，返回空向量和空身份。
 */
export async function embed(
	texts: string[],
	store: DbExecutor = db,
	cacheMax: number = CACHE_MAX,
): Promise<{ vectors: number[][]; generation: string | null }> {
	if (texts.length === 0) return { vectors: [], generation: null };
	const stored = await storedSpace(store);
	spaceIdentity(stored);
	const out = new Array<number[]>(texts.length);
	// 同一个词可能出现在好几个位置（几条条件写了同一个取值），一次嵌入填全部
	const pending = new Map<string, number[]>();
	for (const [index, text] of texts.entries()) {
		const cached = cache.get(text);
		if (cached) {
			out[index] = cached;
			continue;
		}
		const slots = pending.get(text);
		if (slots) slots.push(index);
		else pending.set(text, [index]);
	}
	const fresh = await request(
		[...new Set([stored.canaryText, ...pending.keys()])],
		QUERY_RETRIES,
	);
	assertCanary(stored.canaryEmbedding, fresh.get(stored.canaryText));
	knownSpaceIdentities.set(stored.spaceId, spaceIdentity(stored));
	if (!pending.has(stored.canaryText)) fresh.delete(stored.canaryText);
	if (pending.size > 0) {
		// 达到容量上限时清空，已填入 out 的向量仍属于本次调用。
		if (cache.size + fresh.size > cacheMax) cache.clear();
		for (const [text, vector] of fresh) {
			cache.set(text, vector);
			for (const index of pending.get(text) ?? []) out[index] = vector;
		}
	}
	return { vectors: out, generation: stored.generation };
}

/** 直接请求端点，按入参顺序返回向量；语料侧管理持久缓存和空间核验。 */
export async function embedFresh(
	values: string[],
	retries: number,
): Promise<number[][]> {
	if (values.length === 0) return [];
	const vectors = await request(values, retries);
	return values.map((text) => {
		const vector = vectors.get(text);
		if (!vector)
			throw new Error(`嵌入端点漏掉了一个文本：${text.slice(0, 40)}`);
		return vector;
	});
}

/** 向量的 SQL 字面量形态：pgvector 认 `[0.1,0.2,…]`，调用方再加 `::halfvec` 转型。 */
export function vectorLiteral(v: number[]) {
	return `[${v.join(",")}]`;
}
