/**
 * 四个端点适配层共用的那一层：每一次 HTTP 请求各自超时、各自重试。
 *
 * 这里穿过真正的 AI SDK 打一台进程内的端点，不 mock 它：要钉住的是重试的单位——
 * 多步对话里超时的那一步只重发它自己，前面的步不重来；以及用尽之后 SDK 交出来的错误
 * 仍然分得清连不上和端点报错。
 */
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { describe, test } from "node:test";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embedMany, generateText, isStepCount, tool } from "ai";
import { z } from "zod";
import { endpointFault, endpointFetch } from "#/server/endpoint";

type Reply =
	| { status: number; headers?: Record<string, string>; body?: unknown }
	| "hang";

/** 每个请求交给 `reply` 决定怎么答；记下每次请求的请求体。 */
async function endpoint(reply: (body: unknown, hit: number) => Reply) {
	const bodies: unknown[] = [];
	const server = createServer(async (req: IncomingMessage, res) => {
		let raw = "";
		for await (const chunk of req) raw += chunk;
		const body = JSON.parse(raw);
		bodies.push(body);
		const answer = reply(body, bodies.length);
		if (answer === "hang") return;
		res
			.writeHead(answer.status, {
				"content-type": "application/json",
				...answer.headers,
			})
			.end(JSON.stringify(answer.body ?? { error: { message: "不行" } }));
	});
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		url: `http://127.0.0.1:${port}`,
		bodies,
		stop: () =>
			new Promise<void>((done) => {
				server.close(() => done());
				server.closeAllConnections();
			}),
	};
}

const TIMEOUT_MS = 100;
/** 立刻重发，测试不等退避。 */
const NOW = { "retry-after-ms": "0" };

const EMBEDDING = {
	object: "list",
	model: "fake",
	data: [{ object: "embedding", index: 0, embedding: [1, 0] }],
	usage: { prompt_tokens: 0, total_tokens: 0 },
};

function completion(message: Record<string, unknown>, finish: string) {
	return {
		id: "c",
		created: 0,
		model: "fake",
		choices: [
			{
				index: 0,
				message: { role: "assistant", ...message },
				finish_reason: finish,
			},
		],
	};
}

function providerAt(url: string, retries: number) {
	return createOpenAICompatible({
		name: "t",
		baseURL: url,
		fetch: endpointFetch({ timeoutMs: TIMEOUT_MS, retries }),
	});
}

async function failure(run: () => Promise<unknown>) {
	return run().then(
		() => assert.fail("应当失败"),
		(error: unknown) => error,
	);
}

describe("每一次请求各自超时、各自重试", () => {
	test("第二步超时只重发第二步，第一步不重来", async () => {
		let secondStepTries = 0;
		const server = await endpoint((body) => {
			const { messages } = body as { messages: unknown[] };
			// 第一步只有用户那句话；第二步带上了工具调用与结果
			if (messages.length === 1)
				return {
					status: 200,
					body: completion(
						{
							content: null,
							tool_calls: [
								{
									id: "t1",
									type: "function",
									function: { name: "look", arguments: "{}" },
								},
							],
						},
						"tool_calls",
					),
				};
			secondStepTries++;
			return secondStepTries === 1
				? "hang"
				: { status: 200, body: completion({ content: "好" }, "stop") };
		});
		try {
			const result = await generateText({
				model: providerAt(server.url, 2)("fake"),
				tools: {
					look: tool({
						inputSchema: z.object({}),
						execute: async () => "查到了",
					}),
				},
				stopWhen: isStepCount(2),
				prompt: "做过算法的人",
				maxRetries: 0,
			});
			assert.equal(result.text, "好");
			const firstStep = server.bodies.filter(
				(b) => (b as { messages: unknown[] }).messages.length === 1,
			);
			assert.equal(firstStep.length, 1);
			assert.equal(secondStepTries, 2);
		} finally {
			await server.stop();
		}
	});

	test("限流按 Retry-After 等了再发，答上就用", async () => {
		const server = await endpoint((_body, hit) =>
			hit === 1
				? { status: 429, headers: NOW }
				: { status: 200, body: EMBEDDING },
		);
		try {
			const started = Date.now();
			const { embeddings } = await embedMany({
				model: providerAt(server.url, 2).embeddingModel("fake"),
				values: ["a"],
				maxRetries: 0,
			});
			assert.deepEqual(embeddings, [[1, 0]]);
			assert.equal(server.bodies.length, 2);
			// 照 Retry-After 的零等待重发，没有退回两秒的默认退避
			assert.ok(Date.now() - started < 1_000);
		} finally {
			await server.stop();
		}
	});

	test("次数用完还是超时：重发 retries 次，交出来的是超时，认作连不上", async () => {
		const server = await endpoint(() => "hang");
		try {
			const error = await failure(() =>
				embedMany({
					model: providerAt(server.url, 2).embeddingModel("fake"),
					values: ["a"],
					maxRetries: 0,
				}),
			);
			assert.equal(server.bodies.length, 3);
			assert.equal(endpointFault(error), "unreachable");
		} finally {
			await server.stop();
		}
	});

	test("5xx 用完次数，交出来的是带状态码的端点错误，认作端点报错", async () => {
		const server = await endpoint(() => ({ status: 503, headers: NOW }));
		try {
			const error = await failure(() =>
				embedMany({
					model: providerAt(server.url, 1).embeddingModel("fake"),
					values: ["a"],
					maxRetries: 0,
				}),
			);
			assert.equal(server.bodies.length, 2);
			assert.equal(endpointFault(error), "rejected");
		} finally {
			await server.stop();
		}
	});

	test("400 一次都不重发", async () => {
		const server = await endpoint(() => ({ status: 400 }));
		try {
			const error = await failure(() =>
				embedMany({
					model: providerAt(server.url, 3).embeddingModel("fake"),
					values: ["a"],
					maxRetries: 0,
				}),
			);
			assert.equal(server.bodies.length, 1);
			assert.equal(endpointFault(error), "rejected");
		} finally {
			await server.stop();
		}
	});

	test("整次调用的时限到了就停，退避中也不再重发", async () => {
		const server = await endpoint(() => ({ status: 503 }));
		try {
			const started = Date.now();
			const error = await failure(() =>
				generateText({
					model: providerAt(server.url, 5)("fake"),
					prompt: "做过算法的人",
					timeout: TIMEOUT_MS,
					maxRetries: 0,
				}),
			);
			// 503 之后进入两秒的退避，时限在退避中到了：当场停下，不等退避走完
			assert.ok(Date.now() - started < 1_000);
			assert.equal(server.bodies.length, 1);
			assert.equal((error as Error).name, "TimeoutError");
		} finally {
			await server.stop();
		}
	});

	test("连不上也重发，用完认作连不上", async () => {
		const server = await endpoint(() => ({ status: 200, body: EMBEDDING }));
		const { url } = server;
		await server.stop();
		const started = Date.now();
		const error = await failure(() =>
			embedMany({
				model: providerAt(url, 1).embeddingModel("fake"),
				values: ["a"],
				maxRetries: 0,
			}),
		);
		// 中间等过一次两秒的退避，说明确实重发了
		assert.ok(Date.now() - started >= 2_000);
		assert.equal(endpointFault(error), "unreachable");
	});
});
