/** 嵌入协议的索引与向量校验；乱序回答仍对应同一份输入。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fakeEmbedding, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { embedFresh } = await import("#/server/embed");

async function responding(data: unknown, run: () => Promise<void>) {
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) =>
		String(input).endsWith("/embeddings")
			? Response.json({ data })
			: original(input, init);
	try {
		await run();
	} finally {
		globalThis.fetch = original;
	}
}

const values: [string, string] = ["索引算法", "索引运营"];
const first = { index: 0, embedding: fakeEmbedding(values[0]) };
const second = { index: 1, embedding: fakeEmbedding(values[1]) };

test("端点回答乱序时按索引返回，每个向量属于自己的文本", async () => {
	await responding([second, first], async () => {
		assert.deepEqual(await embedFresh(values, 0), [
			first.embedding,
			second.embedding,
		]);
	});
});

for (const [name, data] of [
	["遗漏", [first]],
	["重复", [first, first]],
	["多余", [first, second, { ...second, index: 2 }]],
	["越界", [first, { ...second, index: 2 }]],
	["负数", [first, { ...second, index: -1 }]],
	["缺索引", [first, { embedding: second.embedding }]],
	["零向量", [first, { index: 1, embedding: second.embedding.map(() => 0) }]],
	["维数不符", [first, { index: 1, embedding: [1] }]],
] as const) {
	test(`${name}的回答不能成为嵌入结果，纠正后可以重新请求`, async () => {
		await responding(data, async () => {
			await assert.rejects(embedFresh(values, 0), /嵌入端点/);
		});
		assert.deepEqual(await embedFresh(values, 0), [
			first.embedding,
			second.embedding,
		]);
	});
}

test("SDK 分批时每批索引从零开始，所有输入仍按完整顺序返回", async () => {
	const texts = Array.from({ length: 2049 }, (_, i) => `批次索引${i}`);
	const original = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async (input, init) => {
		if (!String(input).endsWith("/embeddings")) return original(input, init);
		calls++;
		const { input: batch } = JSON.parse(String(init?.body)) as {
			input: string[];
		};
		return Response.json({
			data: batch
				.map((text, index) => ({ index, embedding: fakeEmbedding(text) }))
				.reverse(),
		});
	};
	try {
		assert.deepEqual(await embedFresh(texts, 0), texts.map(fakeEmbedding));
		assert.equal(calls, 2);
	} finally {
		globalThis.fetch = original;
	}
});
