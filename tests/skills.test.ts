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
		await db.insert(skillAlias).values([
			{ word: "推荐系统", canonical: "推荐系统", reviewedAt: today },
			{ word: "推荐算法", canonical: "推荐系统", reviewedAt: today },
			{ word: "个性化推荐", canonical: "推荐系统", reviewedAt: lastWeek },
			{ word: "Python", canonical: "Python", reviewedAt: lastWeek },
			// 标准词已不在语料里：照样列出，人数 0
			{ word: "Hadoop", canonical: "Hadoop", reviewedAt: lastWeek },
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
			},
			{ canonical: "Python", aliases: [], people: 1, reviewedDaysAgo: 7 },
			{ canonical: "Hadoop", aliases: [], people: 0, reviewedDaysAgo: 7 },
		]);
	});
});
