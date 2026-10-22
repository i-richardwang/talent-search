/**
 * 语料侧调用聊天端点的那一层：去重、缓存，以及答不出合法 JSON 时只丢那一段。
 *
 * 缓存跟着库走，所以这里连真库；端点是进程内那台假的（`fixture.ts`），回答由
 * 测试自己装。
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, describe, test } from "node:test";
import { z } from "zod";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const TIMEOUT_MS = 200;
process.env.EXTRACT_TIMEOUT_MS = String(TIMEOUT_MS);
process.env.EXTRACT_MAX_OUTPUT_TOKENS = "8";
process.env.EXTRACT_API_KEY = "extraction-only-test-key";
const { complete } = await import("#/server/chat");

const SCHEMA = z.object({ a: z.number() });
const quiet = () => {};

function asking(answer: unknown = { a: 1 }) {
	const asked: string[] = [];
	const restore = answerChat((_system, prompt) => {
		asked.push(prompt);
		return answer;
	});
	return { asked, restore };
}

describe("聊天端点", () => {
	test("未缓存的对齐调用使用独立端点和密钥，同名模型也不转发抽取密钥", async () => {
		const originalURL = process.env.ALIGN_BASE_URL;
		const originalKey = process.env.ALIGN_API_KEY;
		const server = createServer((req, res) => {
			const auth = req.headers.authorization;
			const a =
				auth === "Bearer alignment-only-test-key"
					? 42
					: auth === undefined
						? 43
						: -1;
			res.writeHead(200, { "content-type": "application/json" }).end(
				JSON.stringify({
					id: "alignment",
					object: "chat.completion",
					created: 0,
					model: "fake",
					choices: [
						{
							index: 0,
							message: { role: "assistant", content: JSON.stringify({ a }) },
							finish_reason: "stop",
						},
					],
				}),
			);
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		assert.ok(address && typeof address === "object");
		process.env.ALIGN_BASE_URL = `http://127.0.0.1:${address.port}`;
		const { restore } = asking({ a: 7 });
		try {
			for (const [key, expected] of [
				["alignment-only-test-key", 42],
				[undefined, 43],
			] as const) {
				if (key === undefined) delete process.env.ALIGN_API_KEY;
				else process.env.ALIGN_API_KEY = key;
				const got = await complete(
					"fake",
					"独立端点",
					SCHEMA,
					[`对齐${expected}`],
					"对齐",
					quiet,
					"align",
				);
				assert.deepEqual(got.get(`对齐${expected}`), { a: expected });
			}
			const extracted = await complete(
				"fake",
				"独立端点",
				SCHEMA,
				["抽取"],
				"抽取",
				quiet,
			);
			assert.deepEqual(extracted.get("抽取"), { a: 7 });
		} finally {
			if (originalURL === undefined) delete process.env.ALIGN_BASE_URL;
			else process.env.ALIGN_BASE_URL = originalURL;
			if (originalKey === undefined) delete process.env.ALIGN_API_KEY;
			else process.env.ALIGN_API_KEY = originalKey;
			restore();
			await new Promise<void>((resolve) => {
				server.close(() => resolve());
				server.closeAllConnections();
			});
		}
	});

	test("同一段文字只问一次，每个位置都答得上", async () => {
		const { asked, restore } = asking();
		const got = await complete(
			"fake",
			"提示",
			SCHEMA,
			["甲", "乙", "甲"],
			"抽取",
			quiet,
		);
		restore();

		assert.deepEqual(asked.sort(), ["乙", "甲"]);
		assert.deepEqual(got.get("甲"), { a: 1 });
		assert.deepEqual(got.get("乙"), { a: 1 });
	});

	test("再跑一次读缓存；换提示词或换模型就重新问", async () => {
		const first = asking();
		await complete("fake", "缓存提示", SCHEMA, ["丙"], "抽取", quiet);
		first.restore();
		assert.equal(first.asked.length, 1);

		const again = asking();
		const got = await complete(
			"fake",
			"缓存提示",
			SCHEMA,
			["丙"],
			"抽取",
			quiet,
		);
		assert.equal(again.asked.length, 0);
		assert.deepEqual(got.get("丙"), { a: 1 });

		await complete("fake", "另一份提示", SCHEMA, ["丙"], "抽取", quiet);
		await complete("another", "缓存提示", SCHEMA, ["丙"], "抽取", quiet);
		again.restore();
		assert.equal(again.asked.length, 2);
	});

	test("模型、标准和输入相同，换端点仍复用已保存的回答", async () => {
		const originalURL = process.env.ALIGN_BASE_URL;
		const { asked, restore } = asking({ a: 7 });
		try {
			delete process.env.ALIGN_BASE_URL;
			await complete(
				"fake",
				"端点不改变回答身份",
				SCHEMA,
				["同一输入"],
				"对齐",
				quiet,
				"align",
			);
			process.env.ALIGN_BASE_URL = "http://127.0.0.1:1";
			const got = await complete(
				"fake",
				"端点不改变回答身份",
				SCHEMA,
				["同一输入"],
				"对齐",
				quiet,
				"align",
			);
			assert.deepEqual(got.get("同一输入"), { a: 7 });
			assert.deepEqual(asked, ["同一输入"]);
		} finally {
			if (originalURL === undefined) delete process.env.ALIGN_BASE_URL;
			else process.env.ALIGN_BASE_URL = originalURL;
			restore();
		}
	});

	test("不向端点限制输出 token，旧配置也不截断回答", async () => {
		const restore = answerChat((_system, _prompt, request) => {
			if (
				request.max_tokens !== undefined ||
				request.max_completion_tokens !== undefined
			)
				return { a: "输出预算耗尽" };
			return { a: 42 };
		});
		try {
			const got = await complete(
				"fake",
				"输出由模型服务决定",
				SCHEMA,
				["长思考后的回答"],
				"抽取",
				quiet,
			);
			assert.deepEqual(got.get("长思考后的回答"), { a: 42 });
		} finally {
			restore();
		}
	});

	test("整次调用到时终止，不为重试再等一份预算", async () => {
		const restore = answerChat(() => new Promise(() => {}));
		try {
			const started = Date.now();
			await assert.rejects(
				complete("fake", "限时回答", SCHEMA, ["一直思考"], "抽取", quiet),
				{ name: "TimeoutError" },
			);
			assert.ok(Date.now() - started < 3 * TIMEOUT_MS);
		} finally {
			restore();
		}
	});

	test("一段失败后等在途请求收尾，不再领取新段；已完成的回答仍可复用", async () => {
		let enter!: () => void;
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		const asked: string[] = [];
		const restore = answerChat(async (_system, prompt) => {
			asked.push(prompt);
			if (prompt === "失败段") {
				await entered;
				return undefined;
			}
			if (prompt === "在途段") {
				enter();
				await waiting;
			}
			return { a: 7 };
		});
		let finished = false;
		const result = complete(
			"fake",
			"失败时收尾",
			SCHEMA,
			["失败段", "在途段", "未开始甲", "未开始乙"],
			"抽取",
			quiet,
		).then(
			() => assert.fail("应当报告端点失败"),
			(error: unknown) => {
				finished = true;
				return error;
			},
		);
		try {
			await entered;
			await new Promise((resolve) => setTimeout(resolve, 30));
			assert.equal(finished, false, "在途段未收尾时不能报告整批已退出");
			release();
			assert.equal(((await result) as { statusCode: number }).statusCode, 400);
			assert.deepEqual(asked.sort(), ["失败段", "在途段"].sort());

			const saved = await complete(
				"fake",
				"失败时收尾",
				SCHEMA,
				["在途段"],
				"抽取",
				quiet,
			);
			assert.deepEqual(saved.get("在途段"), { a: 7 });
			assert.equal(asked.length, 2);
		} finally {
			release();
			await result;
			restore();
		}
	});

	test("答不出合法 JSON 的那一段被丢掉，也不进缓存", async () => {
		const said: string[] = [];
		const bad = asking({ a: "不是数字" });
		const got = await complete(
			"fake",
			"坏提示",
			SCHEMA,
			["丁"],
			"抽取",
			(line) => said.push(line),
		);
		bad.restore();

		assert.equal(got.size, 0);
		assert.match(said.join("\n"), /放弃这一段/);

		// 没进缓存，所以下一轮还会再问一次
		const retry = asking();
		const second = await complete(
			"fake",
			"坏提示",
			SCHEMA,
			["丁"],
			"抽取",
			quiet,
		);
		retry.restore();
		assert.equal(retry.asked.length, 1);
		assert.deepEqual(second.get("丁"), { a: 1 });
	});
});

test("并发合法回答统一采用第一个成功写入的值", async () => {
	let release!: () => void;
	const both = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const restore = answerChat(async () => {
		const a = ++calls;
		if (calls === 2) release();
		await both;
		return { a };
	});
	try {
		const ask = () =>
			complete("fake", "并发缓存", SCHEMA, ["相同问题"], "抽取", quiet);
		const [a, b] = await Promise.all([ask(), ask()]);
		assert.equal(calls, 2);
		assert.deepEqual(a, b);
		assert.deepEqual(await ask(), a);
	} finally {
		restore();
	}
});
