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
				// 同一个标准词底下几条决定可以出自不同的判定方：谁判的只记在库里，词表不报
				judge: "agent:hr-bot",
				reviewedAt: lastWeek,
			},
			{ word: "Python", canonical: "Python", judge, reviewedAt: lastWeek },
			// 标准词已不在语料里：照样列出，人数 0
			{ word: "Hadoop", canonical: "Hadoop", judge, reviewedAt: lastWeek },
		]);
	});

	test("按标准词收拢，别名按字排，人多的在前，人数按人不按段、连同别名和下面的词", async () => {
		const table = await listSkills("", 1);
		assert.deepEqual(table.rows, [
			{
				canonical: "推荐系统",
				parent: null,
				aliases: ["个性化推荐", "推荐算法"],
				children: 1,
				people: 4,
				reviewedDaysAgo: 0,
			},
			{
				canonical: "Python",
				parent: null,
				aliases: [],
				children: 0,
				people: 1,
				reviewedDaysAgo: 7,
			},
			{
				canonical: "电商推荐系统",
				parent: "推荐系统",
				aliases: [],
				children: 0,
				people: 1,
				reviewedDaysAgo: 0,
			},
			{
				canonical: "Hadoop",
				parent: null,
				aliases: [],
				children: 0,
				people: 0,
				reviewedDaysAgo: 7,
			},
		]);
		assert.equal(table.total, 4);
		assert.equal(table.pages, 1);
	});

	test("找词认标准词、并进去的写法和它属于的那个更宽的词", async () => {
		const byCanonical = await listSkills("Python", 1);
		assert.deepEqual(
			byCanonical.rows.map((row) => row.canonical),
			["Python"],
		);
		// 「个性化推荐」是并进「推荐系统」的写法，搜它出的是标准词那一行
		const byAlias = await listSkills("个性化推荐", 1);
		assert.deepEqual(
			byAlias.rows.map((row) => row.canonical),
			["推荐系统"],
		);
		// 「电商推荐系统」属于「推荐系统」，搜父词时两行都在
		const byParent = await listSkills("推荐系统", 1);
		assert.deepEqual(
			byParent.rows.map((row) => row.canonical),
			["推荐系统", "电商推荐系统"],
		);
		const none = await listSkills("没有这个词", 1);
		assert.deepEqual(none.rows, []);
		assert.equal(none.total, 0);
		assert.equal(none.pages, 1);
	});
});
