/**
 * 管理页「能力词」的数据：词表按标准词收拢，人数连同下面的词一起数，和筛选栏同一口径。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { listSkills } = await import("#/server/skills");

describe("能力词词表", () => {
	before(async () => {
		const { db } = await import("#/db");
		const { skillTerm } = await import("#/db/schema");
		await seed([
			{
				empId: "U001",
				name: "甲",
				segments: [
					{
						kind: "external",
						months: 12,
						extracted: { skills: ["推荐系统", "Python"] },
					},
				],
			},
			{
				empId: "U003",
				name: "丙",
				segments: [
					// 只写了细的词：宽的「推荐系统」把他也数进去，细的那一行只有他
					{
						kind: "external",
						months: 12,
						extracted: { skills: ["电商推荐系统"] },
					},
				],
			},
			{
				empId: "U002",
				name: "乙",
				segments: [
					// 同一个人两段都写了推荐系统：按人数只算一次
					{ kind: "external", months: 12, extracted: { skills: ["推荐系统"] } },
					{ kind: "external", months: 6, extracted: { skills: ["推荐系统"] } },
				],
			},
			{
				empId: "U004",
				name: "丁",
				segments: [
					// 只写了别名：标准词「推荐系统」那一行把他数进去
					{
						kind: "external",
						months: 12,
						extracted: { skills: ["个性化推荐"] },
					},
				],
			},
		]);
		const today = new Date();
		const lastWeek = new Date(today.getTime() - 7 * 86_400_000);
		const judge = "model:test";
		await db.insert(skillTerm).values([
			{ word: "推荐系统", canonical: "推荐系统", judge, reviewedAt: today },
			{
				word: "电商推荐系统",
				canonical: "电商推荐系统",
				parent: "推荐系统",
				judge,
				reviewedAt: today,
			},
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

	test("按标准词收拢，别名按字排，人多的在前，人数按人不按段、连同别名和下面的词", async () => {
		const table = await listSkills();
		assert.deepEqual(table.entries, [
			{
				canonical: "推荐系统",
				parent: null,
				aliases: ["个性化推荐", "推荐算法"],
				people: 4,
				reviewedDaysAgo: 0,
				judge: "model:test",
			},
			{
				canonical: "Python",
				parent: null,
				aliases: [],
				people: 1,
				reviewedDaysAgo: 7,
				judge: "model:test",
			},
			{
				canonical: "电商推荐系统",
				parent: "推荐系统",
				aliases: [],
				people: 1,
				reviewedDaysAgo: 0,
				judge: "model:test",
			},
			{
				canonical: "Hadoop",
				parent: null,
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
		// 夹具钉的是自带模型判，外部接口也就关着
		assert.equal(table.judge, "model");
		assert.equal(table.reachable, false);
	});
});
