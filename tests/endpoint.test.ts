/**
 * 四个端点适配层共用的那一层：超时装在每一次请求上，超时之后由我们自己再试。
 *
 * 这里穿过真正的 AI SDK 打一台进程内的慢端点，不 mock 它：要钉住的正是
 * 「SDK 把超时当成中止直接抛、一次都不试」这件事——它决定了 `retryingTimeouts`
 * 必须存在，而这条只有让 SDK 真跑一遍才看得见。
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, test } from "node:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany } from "ai";
import { retryingTimeouts, timeoutFetch } from "#/server/endpoint";

/** 慢几次就慢几次，之后立刻答；顺便数一数被打了几次。 */
function slowEndpoint(slowTimes: number, slowMs: number) {
	let hits = 0;
	const server = createServer((_req, res) => {
		hits++;
		const answer = () =>
			res.writeHead(200, { "content-type": "application/json" }).end(
				JSON.stringify({
					object: "list",
					model: "fake",
					data: [{ object: "embedding", index: 0, embedding: [1, 0] }],
					usage: { prompt_tokens: 0, total_tokens: 0 },
				}),
			);
		if (hits <= slowTimes) setTimeout(answer, slowMs);
		else answer();
	});
	return new Promise<{
		hits: () => number;
		url: string;
		stop: () => Promise<void>;
	}>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			resolve({
				hits: () => hits,
				url: `http://127.0.0.1:${port}`,
				stop: () =>
					new Promise((done) => {
						server.close(() => done());
						server.closeAllConnections();
					}),
			});
		});
	});
}

const TIMEOUT_MS = 100;

function embeddingModelAt(url: string) {
	return createOpenAICompatible({
		name: "t",
		baseURL: url,
		fetch: timeoutFetch(TIMEOUT_MS),
	}).embeddingModel("fake");
}

/** 一台慢端点、一个模型，跑完关掉。 */
async function withEndpoint(
	slowTimes: number,
	run: (
		model: ReturnType<typeof embeddingModelAt>,
		hits: () => number,
	) => Promise<void>,
) {
	const endpoint = await slowEndpoint(slowTimes, TIMEOUT_MS * 4);
	try {
		await run(embeddingModelAt(endpoint.url), endpoint.hits);
	} finally {
		await endpoint.stop();
	}
}

describe("超时与重试", () => {
	test("SDK 自己不重试超时：慢一次就整通失败", () =>
		withEndpoint(1, async (model, hits) => {
			await assert.rejects(
				embedMany({ model, values: ["a"], maxRetries: 4 }),
				(error: Error) => error.name === "TimeoutError",
			);
			assert.equal(hits(), 1);
		}));

	test("包上 retryingTimeouts 之后，慢两次第三次答上", () =>
		withEndpoint(2, async (model, hits) => {
			const { embeddings } = await retryingTimeouts(2, () =>
				embedMany({ model, values: ["a"], maxRetries: 4 }),
			);
			assert.deepEqual(embeddings, [[1, 0]]);
			assert.equal(hits(), 3);
		}));

	test("次数用完还是超时，抛出来的还是超时", () =>
		withEndpoint(5, async (model, hits) => {
			await assert.rejects(
				retryingTimeouts(1, () =>
					embedMany({ model, values: ["a"], maxRetries: 4 }),
				),
				(error: Error) => error.name === "TimeoutError",
			);
			assert.equal(hits(), 2);
		}));

	test("不是超时的错一次都不重试", async () => {
		let calls = 0;
		await assert.rejects(
			retryingTimeouts(3, async () => {
				calls++;
				throw new Error("端点说不行");
			}),
			/端点说不行/,
		);
		assert.equal(calls, 1);
	});
});
