/**
 * 关键词模式下拉的候选：三个框各查各的一维，以这几个字开头的排前面，再按人数。
 * 跑在临时 schema 上的真 SQL，数据全是合成的。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { suggest } = await import("#/server/suggest");

describe("关键词候选", () => {
	before(async () => {
		const { db } = await import("#/db");
		const { skillTerm } = await import("#/db/schema");
		await seed([
			{
				empId: "S001",
				name: "甲",
				school: "东海大学",
				segments: [
					{
						kind: "external",
						months: 12,
						org: "星河科技",
						extracted: { skills: ["推荐系统"] },
					},
				],
			},
			{
				empId: "S002",
				name: "乙",
				school: "东海大学",
				segments: [
					{ kind: "external", months: 12, org: "星河科技" },
					{ kind: "internal", months: 6, org: "银河星河事业部" },
				],
			},
			{
				empId: "S003",
				name: "丙",
				school: "南山理工学院",
				segments: [
					{
						kind: "external",
						months: 12,
						org: "银河星河事业部",
						extracted: { skills: ["个性化推荐"] },
					},
				],
			},
		]);
		const judge = "model:test";
		const reviewedAt = new Date();
		await db.insert(skillTerm).values([
			{ word: "推荐系统", canonical: "推荐系统", judge, reviewedAt },
			{ word: "个性化推荐", canonical: "推荐系统", judge, reviewedAt },
			// 词表里有、语料里没人写过的词不给
			{ word: "推荐广告", canonical: "推荐广告", judge, reviewedAt },
		]);
	});

	test("做过什么给标准词，写法也认，不带人数；没人写过的不给", async () => {
		assert.deepEqual(await suggest("what", "个性化"), [
			{ value: "推荐系统", people: null },
		]);
		assert.deepEqual(await suggest("what", "推荐"), [
			{ value: "推荐系统", people: null },
		]);
	});

	test("公司或部门：开头是这几个字的排前面，人数按人不按段", async () => {
		assert.deepEqual(await suggest("org", "星河"), [
			{ value: "星河科技", people: 2 },
			{ value: "银河星河事业部", people: 2 },
		]);
	});

	test("学校按人员表数人", async () => {
		assert.deepEqual(await suggest("school", "大学"), [
			{ value: "东海大学", people: 2 },
		]);
		assert.deepEqual(await suggest("school", "  "), []);
	});

	test("通配符按字面匹配", async () => {
		assert.deepEqual(await suggest("org", "%"), []);
	});
});
