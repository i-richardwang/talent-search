/**
 * 整理用的向量缓存：一个词只向端点问一次，之后读库里第一次写下的向量。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { answerEmbedding, fakeEmbedding, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { embed } = await import("#/corpus/embed");

test("缓存过的词不再问端点，端点后来的回答也不改写它", async () => {
	const requested: string[] = [];
	const restore = answerEmbedding((text) => {
		requested.push(text);
		// 和第一次不同的向量：读到它就说明缓存被绕过或被改写了
		return fakeEmbedding(`${text}漂移`);
	});
	try {
		const first = await embed(["合成缓存词"], () => {});
		const again = await embed(["合成新词", "合成缓存词", "合成新词"], () => {});
		assert.deepEqual(requested, ["合成缓存词", "合成新词"]);
		assert.deepEqual(again[1], first[0]);
		assert.deepEqual(again[2], again[0]);
	} finally {
		restore();
	}
});
