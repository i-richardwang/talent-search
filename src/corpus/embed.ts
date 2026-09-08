/**
 * 语料侧的嵌入：一批文本进、一批向量出，算过的留在库里。
 *
 * 端点由 `src/server/embed.ts` 那一个适配层出面打，查询侧用的是同一个模块、
 * 同一份配置——**语料和查询属于同一个嵌入空间**因此不是一条要靠人维护的约定，
 * 而是同一个进程里的同一个常量。
 *
 * 同一串字永远得到同一个向量，所以先查缓存、再去重、最后才打端点：语料里序列名
 * 只有一百多种、岗位名几千种，逐段送过去是把同一个问题问四遍；重跑导入更是把
 * 整份语料再问一遍。缓存按（空间、模型、文本）键入，换空间自然失效，
 * 而且**跟着库走**——换台机器、换个人跑，省下的还是同一批请求。
 */

import "@tanstack/react-start/server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import { embeddingCache } from "#/db/schema";
import { embedFresh, embedSpace } from "#/server/embed";
import type { Report } from "./report";

/**
 * 一次请求送多少段。bge-m3 在 CPU 上一批几十条是延迟与吞吐的平衡点，再大只是
 * 让单次请求更容易超时。整条链路只有这一个批量：调用方把整份语料一次交给
 * `embed`，请求批量、缓存和进度都由它决定。
 */
const BATCH = 32;

/**
 * 一次查缓存问多少个文本。绑定参数和结果集都随它涨：几万种说法一次问完，
 * 光是把向量读进内存就是一次几百兆的尖峰。
 */
const LOOKUP = 500;

/**
 * 导入时嵌入失败重试几次。比查询侧那一个大：一轮导入要跑几十分钟，为一次端点
 * 抖动整轮重来的代价远高于多等几秒。
 */
const IMPORT_RETRIES = 4;

/** 每多少批报一次进度。 */
const PROGRESS_EVERY = 10;

function sha(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

async function cached(texts: string[]): Promise<Map<string, number[]>> {
	const space = embedSpace();
	const out = new Map<string, number[]>();
	for (let start = 0; start < texts.length; start += LOOKUP) {
		const part = texts.slice(start, start + LOOKUP);
		const bySha = new Map(part.map((text) => [sha(text), text]));
		const rows = await db
			.select({
				textSha: embeddingCache.textSha,
				embedding: embeddingCache.embedding,
			})
			.from(embeddingCache)
			.where(
				and(
					eq(embeddingCache.spaceId, space.spaceId),
					eq(embeddingCache.model, space.model),
					inArray(embeddingCache.textSha, [...bySha.keys()]),
				),
			);
		for (const row of rows) {
			const text = bySha.get(row.textSha);
			if (text !== undefined) out.set(text, row.embedding);
		}
	}
	return out;
}

/**
 * 写的只有刚从端点拿回来的、库里刚查过没有的文本，而同一时刻只有一次导入在跑
 * （`session.ts` 的锁），所以主键不会撞：撞了就是这两条前提有一条破了，让它报错。
 */
async function store(fresh: [string, number[]][]) {
	const space = embedSpace();
	await db.insert(embeddingCache).values(
		fresh.map(([text, embedding]) => ({
			spaceId: space.spaceId,
			model: space.model,
			textSha: sha(text),
			embedding,
		})),
	);
}

/** 按入参顺序返回向量。进度只报没命中缓存的那几种——要等端点的就是它们。 */
export async function embed(
	texts: string[],
	report: Report,
): Promise<number[][]> {
	const unique = [...new Set(texts)];
	const vectors = await cached(unique);
	const missing = unique.filter((text) => !vectors.has(text));
	for (let start = 0; start < missing.length; start += BATCH) {
		const chunk = missing.slice(start, start + BATCH);
		const embeddings = await embedFresh(chunk, IMPORT_RETRIES);
		const fresh: [string, number[]][] = [];
		for (const [index, text] of chunk.entries()) {
			const vector = embeddings[index];
			// `embedFresh` 保证一一对应，对不上说明它坏了，别把空向量写进缓存
			if (!vector) throw new Error(`嵌入端点漏掉了 ${text.slice(0, 40)}`);
			fresh.push([text, vector]);
			vectors.set(text, vector);
		}
		await store(fresh);
		const done = start + chunk.length;
		// 几万种说法就是几百批：每批报一行的话，日志里除了进度什么都看不见了
		if (done === missing.length || (start / BATCH) % PROGRESS_EVERY === 0)
			report(`  已嵌入 ${done}/${missing.length} 种新说法`);
	}
	return texts.map((text) => {
		const vector = vectors.get(text);
		if (!vector) throw new Error(`没有拿到向量：${text.slice(0, 40)}`);
		return vector;
	});
}

/** 绕过缓存读端点的真实输出，给语料的嵌入空间 canary 用。 */
export async function probe(text: string): Promise<number[]> {
	const [vector] = await embedFresh([text], IMPORT_RETRIES);
	if (!vector) throw new Error("嵌入端点没有返回 canary 向量");
	return vector;
}
