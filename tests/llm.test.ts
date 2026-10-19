/**
 * 查询理解端点的失败方式：**没配就抛，失败就抛。**
 *
 * 一句话只有模型能读成条件，没有第二种办法能给出同一份结果。它在结果的
 * 关键路径上（工作台已经打开，名单还等着它回来），所以失败必须作为错误
 * 交给调用方，由界面画成错误与重试——装作能用给出的是一份空名单或反义
 * 名单，而它们在屏幕上和正确的名单长得一模一样。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";

// llm.ts 在模块求值时就读环境变量，所以配置必须写在 import 之前。
// 端口 1 上没有人接：这次调用必然失败，而失败正是这里要看的东西。
process.env.LLM_BASE_URL = "http://127.0.0.1:1";
process.env.LLM_MODEL = "fake";
const { understand, UnansweredError } = await import("#/server/llm");
const { endpointFault } = await import("#/server/endpoint");
const { APICallError, tool } = await import("ai");

const VOCAB = {
	companyTag: [],
	level: [],
	recruitment: [],
	education: [],
	schoolTier: [],
	overseas: [],
};

test("端点连不上时抛给调用方，不返回一份假理解", async () => {
	await assert.rejects(understand("做过算法的人", VOCAB, [], {} as never));
});

test("连不上认作 unreachable：那句话根本没被读过", async () => {
	const error = await understand("做过算法的人", VOCAB, [], {} as never).catch(
		(e) => e,
	);
	assert.equal(endpointFault(error), "unreachable");
});

test("端点答了一个 HTTP 错误认作 rejected", () => {
	const denied = new APICallError({
		message: "Unauthorized",
		url: "http://gateway/v1/chat/completions",
		requestBodyValues: {},
		statusCode: 401,
	});
	assert.equal(endpointFault(denied), "rejected");
});

test("端点答了但没按约定作答，不是端点的错", () => {
	assert.equal(endpointFault(new UnansweredError("没有合法对象")), null);
	assert.equal(endpointFault(new Error("别的意外")), null);
});

test("端点没理会必须调用工具、只回了正文，算没作答，不算意外", async () => {
	const agent = {
		tools: {
			submit: tool({ inputSchema: z.object({}), execute: async () => "" }),
		},
		passed: () => false,
		lastSubmitted: () => null,
	};
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		Response.json({
			id: "c",
			created: 0,
			model: "fake",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: "我觉得应该找算法" },
					finish_reason: "stop",
				},
			],
		});
	try {
		const error = await understand(
			"做过算法的人",
			VOCAB,
			[],
			agent as never,
		).catch((e) => e);
		assert.ok(error instanceof UnansweredError, String(error));
		assert.match(error.message, /finishReason=stop/);
		assert.match(error.message, /我觉得应该找算法/);
		assert.equal(endpointFault(error), null);
	} finally {
		globalThis.fetch = original;
	}
});
