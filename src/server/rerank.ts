/**
 * 唯一一处调用重排模型的地方（查询侧）。**薄到没有逻辑**：一个查询词、一批
 * 候选文本去，每个候选一个相关度回来。哪些候选、分数怎么用、缓存在哪，都在
 * `#/search/phrases`。
 *
 * 接口是 Cohere 式的 `/rerank`（SiliconFlow、Jina、Voyage 都是这一形状）：
 * `{model, query, documents}` → `{results: [{index, relevance_score}]}`。
 * 端点和密钥默认沿用嵌入的那一套——同一家服务商通常两个都提供；分开配也行。
 *
 * 和 `embed.ts` 同一条硬约束：**没配就抛，不降级。** 没有判定这一步，召回
 * 出来的候选里一半是「前端」对「后端」这种反义，装作能用等于给一份错名单。
 */

import "@tanstack/react-start/server-only";
import { positiveInt } from "./env";

const BASE_URL = process.env.RERANK_BASE_URL || process.env.EMBED_BASE_URL;
const API_KEY = process.env.RERANK_API_KEY || process.env.EMBED_API_KEY;
const RERANK_MODEL = process.env.RERANK_MODEL ?? "";
const RERANK_SPACE_ID = process.env.RERANK_SPACE_ID ?? "";

/**
 * 一次请求送多少个候选。端点对单次文档数有上限（各家 100 到 1000 不等），
 * 100 是都能过的数；候选是短文本，分批的开销只是几次往返。
 */
const BATCH = 100;
const TIMEOUT_MS = positiveInt(process.env.RERANK_TIMEOUT_MS, 30_000);
const CONCURRENCY = positiveInt(process.env.RERANK_CONCURRENCY, 4);

let activeRequests = 0;
const waitingRequests: Array<() => void> = [];

async function withRequestSlot<T>(request: () => Promise<T>): Promise<T> {
	if (activeRequests < CONCURRENCY) activeRequests++;
	else
		await new Promise<void>((resolve) => {
			// 释放方把当前占用的名额直接交给队首，因此这里恢复后不再递增。
			waitingRequests.push(resolve);
		});
	try {
		return await request();
	} finally {
		const next = waitingRequests.shift();
		if (next) next();
		else activeRequests--;
	}
}

/**
 * 校验端点配置并返回缓存使用的重排空间身份。
 *
 * 唯一的调用点在编排那一侧（`search/phrases.ts` 的 `withAdmission`）：没配这件事
 * 要在进语料快照之前就抛出来，而且分数是按这个身份缓存的，编排本来就要拿到它。
 * 同一件事在两处各查一遍，只会让人以为「没配」有两种不同的表现。
 */
export function rerankSpaceId() {
	if (!BASE_URL || !RERANK_MODEL || !RERANK_SPACE_ID)
		throw new Error(
			"重排端点未配置：需要 RERANK_MODEL 与 RERANK_SPACE_ID（端点与密钥默认沿用 EMBED_*，见 .env.example）",
		);
	return RERANK_SPACE_ID;
}

async function rerankBatch(query: string, documents: string[]) {
	const response = await fetch(`${BASE_URL?.replace(/\/$/, "")}/rerank`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(API_KEY && { authorization: `Bearer ${API_KEY}` }),
		},
		body: JSON.stringify({
			model: RERANK_MODEL,
			query,
			documents,
			return_documents: false,
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`重排端点返回 HTTP ${response.status}`);
	const payload = (await response.json()) as Record<string, unknown>;
	if (!Array.isArray(payload.results))
		throw new Error("重排端点响应缺少 results 数组");
	const scores = new Array<number>(documents.length);
	for (const item of payload.results) {
		const row = (item ?? {}) as Record<string, unknown>;
		const index = Number(row.index);
		const score = Number(row.relevance_score);
		if (
			!Number.isInteger(index) ||
			index < 0 ||
			index >= documents.length ||
			!Number.isFinite(score) ||
			score < 0 ||
			score > 1 ||
			scores[index] !== undefined
		)
			throw new Error("重排端点返回了无效或重复的候选分数");
		scores[index] = score;
	}
	if (scores.some((score) => score === undefined))
		throw new Error(
			`重排端点返回 ${payload.results.length} 个分数，送去的是 ${documents.length} 个候选`,
		);
	return scores;
}

/** 查询词对每个候选的相关度，[0, 1]，按入参顺序返回。空数组直接返回，不打端点。 */
export async function rerank(
	query: string,
	documents: string[],
): Promise<number[]> {
	if (documents.length === 0) return [];
	const batches: string[][] = [];
	for (let start = 0; start < documents.length; start += BATCH)
		batches.push(documents.slice(start, start + BATCH));
	// 全部批次一起交出去，实际并发由那把进程级信号量说了算。这里再搭一套
	// worker 池的话，实际上限是两个数的关系，而调其中一个不会改变它。
	const scored = await Promise.all(
		batches.map((batch) => withRequestSlot(() => rerankBatch(query, batch))),
	);
	// 批次按顺序切、按顺序拼，位置对应关系因此不必再算一遍下标
	return scored.flat();
}
