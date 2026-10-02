/** 重排回答必须完整，缓存按完整输入采用首个落库值。 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { rerank } = await import("#/server/rerank");
const { pool } = await import("#/db");

async function answering<T>(
	answer: (body: { documents: string[] }) => unknown,
	use: () => Promise<T>,
) {
	const original = globalThis.fetch;
	globalThis.fetch = async (input, init) =>
		String(input).endsWith("/rerank")
			? Response.json(await answer(JSON.parse(String(init?.body))))
			: original(input, init);
	try {
		return await use();
	} finally {
		globalThis.fetch = original;
	}
}

describe("重排端点边界", () => {
	for (const payload of [null, {}, { results: null }]) {
		test(`不完整的回答结构 ${JSON.stringify(payload)} 不能进入缓存`, async () => {
			await answering(
				() => payload,
				async () => {
					await assert.rejects(
						rerank(`结构-${JSON.stringify(payload)}`, ["算法"]),
						/results 数组/,
					);
				},
			);
		});
	}
	for (const [name, results] of [
		["缺少分数", [{ index: 1, relevance_score: 0.9 }]],
		[
			"重复索引",
			[
				{ index: 0, relevance_score: 0.9 },
				{ index: 0, relevance_score: 0.8 },
			],
		],
		["越界索引", [{ index: 2, relevance_score: 0.9 }]],
		["空索引", [{ index: null, relevance_score: 0.9 }]],
		["空分数", [{ index: 0, relevance_score: null }]],
		["字符串分数", [{ index: 0, relevance_score: "0.9" }]],
		["超出范围", [{ index: 0, relevance_score: 1.1 }]],
	] as const) {
		test(`${name}不能进入缓存，纠正后的回答仍会重新请求`, async () => {
			const query = `边界-${name}`;
			await answering(
				() => ({ results }),
				async () => {
					await assert.rejects(rerank(query, ["算法", "运营"]), /重排端点/);
				},
			);
			const rows = await pool.query(
				"select count(*)::int as n from rerank_cache where query = $1",
				[query],
			);
			assert.equal(rows.rows[0].n, 0);
			await answering(
				() => ({
					results: [
						{ index: 1, relevance_score: 0 },
						{ index: 0, relevance_score: 1 },
					],
				}),
				async () => {
					assert.deepEqual(await rerank(query, ["算法", "运营"]), [1, 0]);
				},
			);
		});
	}
});

describe("重排输入缓存", () => {
	test("落库与缓存命中保留端点的小数精度，阈值附近不改变相关度", async () => {
		const values = [0.55, 0.78, 0.9];
		let calls = 0;
		await answering(
			() => {
				calls++;
				return {
					results: values.map((relevance_score, index) => ({
						index,
						relevance_score,
					})),
				};
			},
			async () => {
				const documents = ["精度一", "精度二", "精度三"];
				assert.deepEqual(await rerank("缓存精度", documents), values);
				assert.deepEqual(await rerank("缓存精度", documents), values);
			},
		);
		assert.equal(calls, 1);
	});

	test("去重、顺序和重复位置保持一致；再次调用读取已保存值", async () => {
		let calls = 0;
		await answering(
			({ documents }) => {
				calls++;
				assert.deepEqual(documents, ["算法", "运营"]);
				return {
					results: [
						{ index: 1, relevance_score: 0 },
						{ index: 0, relevance_score: 1 },
					],
				};
			},
			async () => {
				assert.deepEqual(
					await rerank("重复位置", ["算法", "运营", "算法"]),
					[1, 0, 1],
				);
				assert.deepEqual(await rerank("重复位置", ["运营", "算法"]), [0, 1]);
			},
		);
		assert.equal(calls, 1);
	});

	test("释义改变就是新的模型输入", async () => {
		let calls = 0;
		await answering(
			() => ({
				results: [{ index: 0, relevance_score: ++calls === 1 ? 1 : 0 }],
			}),
			async () => {
				assert.deepEqual(
					await rerank("释义身份", ["开发：编写服务端程序"]),
					[1],
				);
				assert.deepEqual(await rerank("释义身份", ["开发：拓展销售客户"]), [0]);
				assert.deepEqual(
					await rerank("释义身份", ["开发：编写服务端程序"]),
					[1],
				);
			},
		);
		assert.equal(calls, 2);
	});

	test("并发的不同回答都消费第一份成功落库的值", async () => {
		let enter = () => {},
			release = () => {};
		const entered = new Promise<void>((resolve) => {
			enter = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;
		await answering(
			async () => {
				const first = ++calls === 1;
				if (first) {
					enter();
					await held;
				}
				return { results: [{ index: 0, relevance_score: first ? 1 : 0 }] };
			},
			async () => {
				const first = rerank("并发首份", ["算法"]);
				await entered;
				try {
					assert.deepEqual(await rerank("并发首份", ["算法"]), [0]);
				} finally {
					release();
				}
				assert.deepEqual(await first, [0]);
				assert.deepEqual(await rerank("并发首份", ["算法"]), [0]);
			},
		);
		assert.equal(calls, 2);
	});
});
