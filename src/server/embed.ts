/**
 * 唯一一处把文本变成向量的地方（查询侧）。**薄到没有逻辑**：拿字符串去、
 * 拿向量回来。语料侧的向量由 ETL 用同一个端点、同一个模型产出（`etl/embed.py`）。
 *
 * 三条硬约束：
 *
 * 1. **端点收得到经历原文。** 这里出去的只有查询词，但 ETL 从同一个端点
 *    出去的是每个人的经历原文——`EMBED_BASE_URL` 指向公网就等于把简历交给第三方。
 *    放内网还是公网是部署方按数据政策做的决定，README 把这个差别写在配置表旁边。
 * 2. **没配就抛，不降级。** 查询理解没了模型可以退回规则解析，检索没了向量
 *    什么都做不了：装作能用只会返回一份空名单，而空名单在这个界面里的意思是
 *    「没有这样的人」。
 * 3. **嵌入空间必须与语料一致。** 配置先核对 space、model 与 dimension，随后
 *    重新嵌入语料保存的 canary；任一项不一致都拒绝检索。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { cosineSimilarity, embedMany } from "ai";
import { db } from "#/db";
import { EMBED_DIM, embeddingSpace } from "#/db/schema";

const BASE_URL = process.env.EMBED_BASE_URL;
const API_KEY = process.env.EMBED_API_KEY;
const MODEL = process.env.EMBED_MODEL;
const SPACE_ID = process.env.EMBED_SPACE_ID;

function positiveInt(value: string | undefined, fallback: number) {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const TIMEOUT_MS = positiveInt(process.env.EMBED_TIMEOUT_MS, 30_000);

/**
 * 同一串字永远得到同一个向量，所以缓存在语义上不可见。它省的是**每次导航**
 * 的一跳：翻页、改筛选都要重跑检索，而检索要先嵌入查询词——不缓存的话
 * 每按一次筛选都等一次模型。上限只是防止进程长期运行时无限长；
 * 超过就整个清掉，不做 LRU——这点数据不值一套淘汰逻辑。
 */
const CACHE_MAX = 4096;
const cache = new Map<string, number[]>();

let model: ReturnType<
	ReturnType<typeof createOpenAICompatible>["embeddingModel"]
> | null = null;
function getModel() {
	if (!BASE_URL || !MODEL || !SPACE_ID)
		throw new Error(
			"嵌入端点未配置：需要 EMBED_BASE_URL、EMBED_MODEL 与 EMBED_SPACE_ID（见 .env.example）",
		);
	if (!model)
		model = createOpenAICompatible({
			name: "talent-embed",
			baseURL: BASE_URL,
			...(API_KEY && { apiKey: API_KEY }),
		}).embeddingModel(MODEL);
	return model;
}

async function request(values: string[]) {
	const { embeddings } = await embedMany({
		model: getModel(),
		values,
		maxRetries: 1,
		abortSignal: AbortSignal.timeout(TIMEOUT_MS),
	});
	for (const vector of embeddings)
		if (
			vector.length !== EMBED_DIM ||
			vector.some((value) => !Number.isFinite(value)) ||
			!vector.some((value) => value !== 0)
		)
			throw new Error(
				`嵌入端点返回了无效向量：期望 ${EMBED_DIM} 个有限数值且范数非零`,
			);
	return embeddings;
}

let spaceVerified = false;
let spaceVerification: Promise<void> | null = null;

async function verifySpace() {
	getModel();
	const rows = await db.select().from(embeddingSpace).limit(2);
	const stored = rows[0];
	if (!stored || rows.length !== 1)
		throw new Error("语料没有唯一的嵌入空间元数据，请重新运行 ETL");
	if (
		stored.spaceId !== SPACE_ID ||
		stored.model !== MODEL ||
		stored.dimension !== EMBED_DIM
	)
		throw new Error(
			`查询端嵌入空间 ${SPACE_ID}/${MODEL}/${EMBED_DIM} 与语料 ${stored.spaceId}/${stored.model}/${stored.dimension} 不一致`,
		);
	const [fresh] = await request([stored.canaryText]);
	const similarity = fresh
		? cosineSimilarity(fresh, stored.canaryEmbedding)
		: Number.NaN;
	if (!Number.isFinite(similarity) || similarity < 0.999)
		throw new Error(
			"嵌入端点的实际输出与语料 canary 不一致，请更换 EMBED_SPACE_ID 并重新运行 ETL",
		);
}

async function ensureSpace() {
	if (spaceVerified) return;
	spaceVerification ??= verifySpace()
		.then(() => {
			spaceVerified = true;
		})
		.finally(() => {
			spaceVerification = null;
		});
	await spaceVerification;
}

/** 文本 → 向量，按入参顺序返回。空数组直接返回，不打端点。 */
export async function embed(texts: string[]): Promise<number[][]> {
	if (texts.length === 0) return [];
	await ensureSpace();
	const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
	if (missing.length > 0) {
		const embeddings = await request(missing);
		if (cache.size + missing.length > CACHE_MAX) cache.clear();
		missing.forEach((text, i) => {
			const v = embeddings[i];
			if (!v) throw new Error("嵌入端点漏掉了一个向量");
			cache.set(text, v);
		});
	}
	return texts.map((t) => cache.get(t) as number[]);
}

/** 向量的 SQL 字面量形态：pgvector 认 `[0.1,0.2,…]`，调用方再加 `::halfvec` 转型。 */
export function vectorLiteral(v: number[]) {
	return `[${v.join(",")}]`;
}
