/**
 * 唯一一处把文本变成向量的地方。**薄到没有逻辑**：拿字符串去、拿向量回来。
 * 查询侧走 `embed`（进程内缓存 + 空间核验），语料侧走 `embedFresh`
 * （`src/corpus/embed.ts` 在外面加库里的缓存）——**同一个端点、同一份配置、
 * 同一个模型**，于是「语料和查询属于同一个嵌入空间」不是一条要记住的约定。
 *
 * 三条硬约束：
 *
 * 1. **端点收得到经历原文。** 查询侧出去的只有查询词，但派生从同一个端点
 *    出去的是每个人的经历原文——`EMBED_BASE_URL` 指向公网就等于把简历交给第三方。
 *    放内网还是公网是部署方按数据政策做的决定，README 把这个差别写在配置表旁边。
 * 2. **没配就抛，不降级。** 检索没了向量什么都做不了：装作能用只会返回一份
 *    空名单，而空名单在这个界面里的意思是「没有这样的人」。
 * 3. **嵌入空间必须与语料一致。** 配置先核对 space、model 与 dimension，随后
 *    重新嵌入语料保存的 canary；任一项不一致都拒绝检索。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { cosineSimilarity, embedMany } from "ai";
import { type DbExecutor, db } from "#/db";
import { EMBED_DIM, embeddingSpace } from "#/db/schema";
import { positiveInt, retryingTimeouts, timeoutFetch } from "./endpoint";

/*
 * 三个值在这里修剪一次，别处不再读它们（`embedSpace`）。各读各的话，
 * `EMBED_MODEL=bge-m3 ` 这样一个尾随空格会让语料侧写进库的身份和查询侧拿去核对的
 * 身份差一个字符，而报出来的是「查询端嵌入空间与语料不一致」——两个字符串打印出来
 * 一模一样。
 */
const BASE_URL = process.env.EMBED_BASE_URL?.trim();
const API_KEY = process.env.EMBED_API_KEY;
const MODEL = process.env.EMBED_MODEL?.trim();
const SPACE_ID = process.env.EMBED_SPACE_ID?.trim();

const TIMEOUT_MS = positiveInt(process.env.EMBED_TIMEOUT_MS, 30_000);

/**
 * 同一串字永远得到同一个向量，所以缓存在语义上不可见。它省的是**每次导航**
 * 的一跳：翻页、改筛选都要重跑检索，而检索要先嵌入查询词——不缓存的话
 * 每按一次筛选都等一次模型。上限只是防止进程长期运行时无限长。
 */
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
 * 这个进程说的嵌入空间：稳定身份与模型名。**两侧的唯一出处**——语料侧把它写进
 * `embedding_space`，查询侧拿它核对那一行。没配就抛，理由同上面第 2 条。
 */
export function embedSpace(): { spaceId: string; model: string } {
	const { spaceId, model } = configured();
	return { spaceId, model };
}

/** 端点地址，只为让派生把「向哪台机器要向量」说出来。 */
export function embedEndpoint(): string {
	return configured().baseURL;
}

let model: ReturnType<
	ReturnType<typeof createOpenAICompatible>["embeddingModel"]
> | null = null;
function getModel() {
	const config = configured();
	if (!model)
		model = createOpenAICompatible({
			name: "talent-embed",
			baseURL: config.baseURL,
			...(API_KEY && { apiKey: API_KEY }),
			// 超时装在每一次请求上，每一次尝试各有一份预算（见 `endpoint.ts`）
			fetch: timeoutFetch(TIMEOUT_MS),
		}).embeddingModel(config.model);
	return model;
}

/**
 * 一批文本 → 每个文本一个向量。返回的是**按文本键入的表**，不是一列向量：
 * 端点少给一个、多给一个或者换了顺序，都会让下游拿一个词的向量去搜另一个词，
 * 而错位的名单看起来完全正常。键入之后这种错只能表现为「少了谁」，在这里就报。
 */
async function request(
	values: string[],
	maxRetries: number,
): Promise<Map<string, number[]>> {
	// 两种失败各自重试同样的次数：可重试的应答由 SDK 在里面试，超时由外面这一层试
	const { embeddings } = await retryingTimeouts(maxRetries, () =>
		embedMany({ model: getModel(), values, maxRetries }),
	);
	const out = new Map<string, number[]>();
	for (const [index, vector] of embeddings.entries()) {
		if (
			vector.length !== EMBED_DIM ||
			vector.some((value) => !Number.isFinite(value)) ||
			!vector.some((value) => value !== 0)
		)
			throw new Error(
				`嵌入端点返回了无效向量：期望 ${EMBED_DIM} 个有限数值且范数非零`,
			);
		const text = values[index];
		if (text !== undefined) out.set(text, vector);
	}
	if (out.size !== new Set(values).size)
		throw new Error(
			`嵌入端点返回 ${embeddings.length} 个向量，送去的是 ${values.length} 个文本`,
		);
	return out;
}

const verifiedSpaceIdentities = new Map<string, string>();
const spaceVerifications = new Map<string, Promise<void>>();

async function storedSpace(store: DbExecutor) {
	getModel();
	const rows = await store.select().from(embeddingSpace).limit(2);
	const stored = rows[0];
	if (!stored || rows.length !== 1)
		throw new Error("语料没有唯一的嵌入空间元数据，等派生跑一轮");
	return stored;
}

async function verifySpace(stored: Awaited<ReturnType<typeof storedSpace>>) {
	if (
		stored.spaceId !== SPACE_ID ||
		stored.model !== MODEL ||
		stored.dimension !== EMBED_DIM
	)
		throw new Error(
			`查询端嵌入空间 ${SPACE_ID}/${MODEL}/${EMBED_DIM} 与语料 ${stored.spaceId}/${stored.model}/${stored.dimension} 不一致`,
		);
	const fresh = (await request([stored.canaryText], QUERY_RETRIES)).get(
		stored.canaryText,
	);
	const similarity = fresh
		? cosineSimilarity(fresh, stored.canaryEmbedding)
		: Number.NaN;
	if (!Number.isFinite(similarity) || similarity < 0.999)
		throw new Error(
			"嵌入端点的实际输出与语料 canary 不一致，请更换 EMBED_SPACE_ID，派生会重算",
		);
}

async function ensureSpace(store: DbExecutor) {
	const stored = await storedSpace(store);
	const identity = [
		stored.spaceId,
		stored.model,
		stored.dimension,
		stored.canaryText,
		stored.canaryEmbedding.join(","),
	].join("\u0001");
	const verified = verifiedSpaceIdentities.get(stored.spaceId);
	if (verified === identity) return;
	if (verified)
		throw new Error(
			`嵌入空间 ${stored.spaceId} 的身份在进程运行期间发生变化，请更换 EMBED_SPACE_ID`,
		);
	let verification = spaceVerifications.get(stored.spaceId);
	if (!verification) {
		verification = verifySpace(stored)
			.then(() => {
				verifiedSpaceIdentities.set(stored.spaceId, identity);
			})
			.finally(() => {
				spaceVerifications.delete(stored.spaceId);
			});
		spaceVerifications.set(stored.spaceId, verification);
	}
	await verification;
	if (verifiedSpaceIdentities.get(stored.spaceId) !== identity)
		throw new Error(
			`嵌入空间 ${stored.spaceId} 的身份在并发校验期间发生变化，请更换 EMBED_SPACE_ID`,
		);
}

/**
 * 文本 → 向量，按入参顺序返回。空数组直接返回，不打端点。
 *
 * **一次调用自洽**：这一批的向量先各自落到它要填的位置上，缓存才轮到被淘汰。
 * 反过来先淘汰的话，同一次调用里本来命中缓存的那几个词会跟着整批清空一起没了，
 * 而它们的向量刚刚还在手边——症状是「加一个新词，旧词就查不到向量了」。
 *
 * `cacheMax` 只有测试会传：淘汰这条路径要把缓存填满才走得到，而按真实上限填
 * 一次要往端点推四千个向量。它不是一项配置——进程里只有一个上限。
 */
export async function embed(
	texts: string[],
	store: DbExecutor = db,
	cacheMax: number = CACHE_MAX,
): Promise<number[][]> {
	if (texts.length === 0) return [];
	await ensureSpace(store);
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
	if (pending.size > 0) {
		const fresh = await request([...pending.keys()], QUERY_RETRIES);
		// 装不下就整个清掉，不做 LRU——这点数据不值一套淘汰逻辑
		if (cache.size + fresh.size > cacheMax) cache.clear();
		for (const [text, vector] of fresh) {
			cache.set(text, vector);
			for (const index of pending.get(text) ?? []) out[index] = vector;
		}
	}
	return out;
}

/**
 * 一批文本 → 按入参顺序的向量，不查任何缓存、不核对嵌入空间。
 *
 * 语料侧用它：那一侧的缓存在库里（`corpus/embed.ts`），而**空间那一行正是它写的**
 * ——发布前拿现在这个端点的真实输出当 canary，核对是查询侧后来的事。
 * `maxRetries` 由调用方给：一次检索和一轮派生愿意等的时间不是一个量级。
 */
export async function embedFresh(
	values: string[],
	maxRetries: number,
): Promise<number[][]> {
	if (values.length === 0) return [];
	const vectors = await request(values, maxRetries);
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
