/**
 * 查询理解交表前能用的工具：查词、试搜。跑在临时 schema 上的真 SQL 和假模型端点，
 * 数据全是合成的。工具只交出数，不交出人；每用一次记一步。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { agentTools, lookUpWords, tryConditions } = await import(
	"#/server/agent-tools"
);
const { vocabulary } = await import("#/search/search");

describe("查词", () => {
	before(async () => {
		const { db } = await import("#/db");
		const { skillTerm } = await import("#/db/schema");
		await seed([
			{
				empId: "A001",
				name: "甲",
				segments: [
					{
						kind: "external",
						months: 24,
						org: "星河科技",
						extracted: { skills: ["推荐系统"] },
					},
				],
			},
			{
				empId: "A002",
				name: "乙",
				segments: [
					{
						kind: "internal",
						months: 12,
						org: "银河事业部",
						extracted: { skills: ["个性化推荐", "后端开发"] },
					},
				],
			},
		]);
		const judge = "model:test";
		const reviewedAt = new Date();
		await db.insert(skillTerm).values([
			{ word: "推荐系统", canonical: "推荐系统", judge, reviewedAt },
			{ word: "个性化推荐", canonical: "推荐系统", judge, reviewedAt },
			{ word: "后端开发", canonical: "后端开发", judge, reviewedAt },
		]);
	});

	test("任一写法都认，交出标准词和写过它的人数；词表里没有的说没有", async () => {
		const found = await lookUpWords(["个性化推荐", "后端开发", "量子炼金", ""]);
		assert.deepEqual(
			found.map((w) => [w.word, w.canonical, w.people]),
			[
				["个性化推荐", "推荐系统", 2],
				["后端开发", "后端开发", 1],
				["量子炼金", null, 0],
			],
		);
	});

	test("试搜交出人数和成因，条件先过交表那道收窄", async () => {
		const vocab = await vocabulary();
		// 假嵌入按字面重合算相似度：写了「推荐系统」的那个人命中，「个性化推荐」不算
		const some = await tryConditions(parseQuery("推荐系统"), vocab, []);
		assert.equal(some.total, 1);
		assert.equal(some.empty, null);
		const none = await tryConditions(parseQuery("量子炼金"), vocab, []);
		assert.equal(none.total, 0);
		assert.equal(none.empty, "unmet");
		// 词表外的职级取值丢掉，条件表照样能试
		const narrowed = await tryConditions(
			[
				...parseQuery("推荐系统"),
				{ about: "person", mode: "must", field: "level", values: ["天王"] },
			],
			vocab,
			[],
		);
		assert.equal(narrowed.conditions.length, 1);
	});

	test("模型每用一次工具记一步，步上只有数没有人", async () => {
		const steps: TraceStep[] = [];
		const tools = agentTools({
			vocab: await vocabulary(),
			base: [],
			record: async (step) => {
				steps.push(step);
			},
		});
		// SDK 的工具外壳只在模型调用时才有上下文；这里直接按它的入参调 execute
		const run = (
			t: { execute?: (input: never, options: never) => unknown },
			input: unknown,
		) =>
			t.execute?.(input as never, { toolCallId: "t", messages: [] } as never);
		await run(tools.look_up_words, { words: ["推荐系统"] });
		await run(tools.try_conditions, {
			conditions: [{ about: "experience", mode: "must", what: ["推荐系统"] }],
		});
		assert.deepEqual(
			steps.map((s) => s.tool),
			["look_up_words", "try_conditions"],
		);
		assert.doesNotMatch(JSON.stringify(steps), /甲|乙|A00/);
	});
});
