/**
 * 查询侧的嵌入缓存。同一串字永远得到同一个向量，所以缓存在语义上不可见——
 * 它唯一能被看见的方式就是**弄错**：淘汰顺序不对时，一次调用会少交一个向量。
 * 这条路径要把缓存填满才走得到，所以上限由入参给（真实上限是四千个向量）。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { fakeEmbedding, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { embed } = await import("#/server/embed");

test("缓存淘汰不会带走同一次调用里已经命中的向量", async () => {
	await embed(["算法"], undefined, 1);
	// 缓存里已经有「算法」，再要一个新词就装不下：淘汰必须发生在这一次的
	// 向量取齐**之后**，否则刚刚还在手边的那个向量会跟着整批清空一起没了。
	const [cached, fresh] = await embed(["算法", "渠道运营"], undefined, 1);
	assert.deepEqual(cached, fakeEmbedding("算法"));
	assert.deepEqual(fresh, fakeEmbedding("渠道运营"));
});

test("同一个词出现在多个位置时各处都拿到向量", async () => {
	const vectors = await embed(["带团队", "算法", "带团队"]);
	assert.deepEqual(vectors[0], fakeEmbedding("带团队"));
	assert.deepEqual(vectors[2], vectors[0]);
	assert.deepEqual(vectors[1], fakeEmbedding("算法"));
});
