/** 重排端点与持久缓存。每个查询词和完整候选文本采用首个成功落库的相关度。 */

import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { rerankCache } from "#/db/schema";
import { positiveInt, timeoutFetch } from "./endpoint";

const BASE_URL = process.env.RERANK_BASE_URL || process.env.EMBED_BASE_URL;
const API_KEY = process.env.RERANK_API_KEY || process.env.EMBED_API_KEY;
const RERANK_MODEL = process.env.RERANK_MODEL ?? "";
const RERANK_SPACE_ID = process.env.RERANK_SPACE_ID ?? "";

/**
 * 一次请求送多少个候选。端点对单次文档数有上限（各家 100 到 1000 不等），
 * 100 是都能过的数；候选是短文本，分批的开销只是几次往返。
 */
const BATCH = 100;
const LOOKUP_BATCH = 500;
/** 这一层不重试，所以一次请求就是一次尝试；超时的含义和另外三层一致。 */
const fetchWithTimeout = timeoutFetch(
	positiveInt(process.env.RERANK_TIMEOUT_MS, 30_000),
);
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

/** 检索在进入语料快照前校验重排配置。 */
export function rerankSpaceId() {
	if (!BASE_URL || !RERANK_MODEL || !RERANK_SPACE_ID)
		throw new Error(
			"重排端点未配置：需要 RERANK_MODEL 与 RERANK_SPACE_ID（端点与密钥默认沿用 EMBED_*，见 .env.example）",
		);
	return RERANK_SPACE_ID;
}

async function rerankBatch(query: string, documents: string[]) {
	const response = await fetchWithTimeout(
		`${BASE_URL?.replace(/\/$/, "")}/rerank`,
		{
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
		},
	);
	if (!response.ok) throw new Error(`重排端点返回 HTTP ${response.status}`);
	const payload = await response.json();
	if (!payload || !Array.isArray(payload.results))
		throw new Error("重排端点响应缺少 results 数组");
	const scores = new Array<number | undefined>(documents.length).fill(
		undefined,
	);
	for (const item of payload.results) {
		const row = (item ?? {}) as Record<string, unknown>;
		const index = row.index;
		const score = row.relevance_score;
		if (
			typeof index !== "number" ||
			!Number.isInteger(index) ||
			index < 0 ||
			index >= documents.length ||
			typeof score !== "number" ||
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
	return scores as number[];
}

function documentSha(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** 完整候选文本包括释义；缓存身份不依赖说法行的 id。 */
async function cached(space: string, query: string, documents: string[]) {
	const out = new Map<string, number>();
	const hashes = documents.map(documentSha);
	for (let start = 0; start < hashes.length; start += LOOKUP_BATCH) {
		const rows = await db
			.select()
			.from(rerankCache)
			.where(
				and(
					eq(rerankCache.space, space),
					eq(rerankCache.query, query),
					inArray(
						rerankCache.documentSha,
						hashes.slice(start, start + LOOKUP_BATCH),
					),
				),
			);
		for (const row of rows) out.set(row.documentSha, row.relevance);
	}
	return out;
}

/** 查询词对每个候选的相关度，[0, 1]，按入参顺序返回；并发调用消费相同的已保存值。 */
export async function rerank(
	query: string,
	documents: string[],
): Promise<number[]> {
	if (documents.length === 0) return [];
	const space = rerankSpaceId();
	const unique = [...new Set(documents)];
	const scores = await cached(space, query, unique);
	const missing = unique.filter((text) => !scores.has(documentSha(text)));
	const batches: string[][] = [];
	for (let start = 0; start < missing.length; start += BATCH)
		batches.push(missing.slice(start, start + BATCH));
	await Promise.all(
		batches.map((batch) =>
			withRequestSlot(async () => {
				const values = await rerankBatch(query, batch);
				await db
					.insert(rerankCache)
					.values(
						batch.map((text, index) => ({
							space,
							query,
							documentSha: documentSha(text),
							relevance: values[index] as number,
						})),
					)
					.onConflictDoNothing();
				for (const [key, value] of await cached(space, query, batch))
					scores.set(key, value);
			}),
		),
	);
	return documents.map((text) => {
		const value = scores.get(documentSha(text));
		if (value === undefined) throw new Error("重排分数未能落库");
		return value;
	});
}
