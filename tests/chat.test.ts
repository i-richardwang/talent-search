/**
 * 语料侧调用聊天端点的那一层：去重、缓存，以及答不出合法 JSON 时只丢那一段。
 *
 * 缓存跟着库走，所以这里连真库；端点是进程内那台假的（`fixture.ts`），回答由
 * 测试自己装。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { z } from "zod";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { complete } = await import("#/server/chat");

const SCHEMA = z.object({ a: z.number() });
const quiet = () => {};

/** 跑一次，回答固定，顺便数一数问了几次、问的是什么。 */
function asking(answer: unknown = { a: 1 }) {
	const asked: string[] = [];
	const restore = answerChat((_system, prompt) => {
		asked.push(prompt);
		return answer;
	});
	return { asked, restore };
}

describe("聊天端点", () => {
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

test("并发合法回答统一采用首个落库值", async () => {
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
