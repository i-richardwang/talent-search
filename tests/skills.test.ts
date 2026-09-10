/**
 * 管理页「能力词」的数据：对照表按标准词收拢，人数和筛选栏同一口径。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { listSkills } = await import("#/server/skills");

describe("能力词对照表", () => {
	before(async () => {
		const { db } = await import("#/db");
		const { skillAlias } = await import("#/db/schema");
		await seed([
			{
				empId: "U001",
				name: "甲",
				segments: [
					{ kind: "external", months: 12, skills: ["推荐系统", "Python"] },
				],
			},
			{
				empId: "U002",
				name: "乙",
				segments: [
					// 同一个人两段都写了推荐系统：按人数只算一次
					{ kind: "external", months: 12, skills: ["推荐系统"] },
					{ kind: "external", months: 6, skills: ["推荐系统"] },
				],
			},
		]);
		const today = new Date();
		const lastWeek = new Date(today.getTime() - 7 * 86_400_000);
		const judge = "model:test";
		await db.insert(skillAlias).values([
			{ word: "推荐系统", canonical: "推荐系统", judge, reviewedAt: today },
			{ word: "推荐算法", canonical: "推荐系统", judge, reviewedAt: today },
			{
				word: "个性化推荐",
				canonical: "推荐系统",
				// 同一个标准词底下几条决定可以出自不同的裁判：这一格报最近那一条
				judge: "agent:hr-bot",
				reviewedAt: lastWeek,
			},
			{ word: "Python", canonical: "Python", judge, reviewedAt: lastWeek },
			// 标准词已不在语料里：照样列出，人数 0
			{ word: "Hadoop", canonical: "Hadoop", judge, reviewedAt: lastWeek },
		]);
	});

	test("按标准词收拢，别名按字排，人多的在前，人数按人不按段", async () => {
		const table = await listSkills();
		assert.deepEqual(table.entries, [
			{
				canonical: "推荐系统",
				aliases: ["个性化推荐", "推荐算法"],
				people: 2,
				reviewedDaysAgo: 0,
				judge: "model:test",
			},
			{
				canonical: "Python",
				aliases: [],
				people: 1,
				reviewedDaysAgo: 7,
				judge: "model:test",
			},
			{
				canonical: "Hadoop",
				aliases: [],
				people: 0,
				reviewedDaysAgo: 7,
				judge: "model:test",
			},
		]);
	});

	test("队列空着时没有等着判的题", async () => {
		const table = await listSkills();
		assert.equal(table.waiting, 0);
		// 夹具不设 REVIEW_JUDGE，所以是自带模型判，外部接口也就关着
		assert.equal(table.judge, "model");
		assert.equal(table.reachable, false);
	});
});
