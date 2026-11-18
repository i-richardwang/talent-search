/**
 * 管理页「标签」的数据：此刻有人写的词按标准词收拢，人数连同下面的词一起数，
 * 和检索顺着词表找到的同一批人。没人写的词留在词表里，不在这一页上。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { describeTerm, listTerms } = await import("#/server/terms");

describe("标签页", () => {
	before(async () => {
		const { db } = await import("#/db");
		const { term } = await import("#/db/schema");
		await seed([
			{
				empId: "U001",
				name: "甲",
				segments: [
					{
						kind: "external",
						months: 12,
						// 「周报」判成了不是能力：不是词表里的一项
						extracted: { skills: ["推荐系统", "Python", "周报"] },
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
					// 「Spark」属于判定方起名的「大数据」：没人写「大数据」，它下面有人
					{ kind: "external", months: 6, extracted: { skills: ["Spark"] } },
					// 还没进词表的词：此刻有人写，就是一项
					{ kind: "external", months: 6, extracted: { skills: ["Flink"] } },
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
		await db.insert(term).values([
			{ word: "推荐系统", canonical: "推荐系统", reviewedAt: today },
			{
				word: "电商推荐系统",
				canonical: "电商推荐系统",
				parent: "推荐系统",
				reviewedAt: today,
			},
			{
				word: "个性化推荐",
				canonical: "推荐系统",
				reviewedAt: lastWeek,
			},
			{ word: "Python", canonical: "Python", reviewedAt: lastWeek },
			// 已经没人写的词和写法：判断留在词表里，不在标签页上
			{ word: "Hadoop", canonical: "Hadoop", reviewedAt: lastWeek },
			{ word: "推荐算法", canonical: "推荐系统", reviewedAt: today },
			{ word: "推荐引擎", canonical: "推荐系统", reviewedAt: lastWeek },
			{ word: "日报", canonical: "日报", excluded: true, reviewedAt: today },
			{ word: "周报", canonical: "周报", excluded: true, reviewedAt: today },
			// 判定方起的名字，还没判过
			{ word: "大数据", canonical: "大数据" },
			{
				word: "Spark",
				canonical: "Spark",
				parent: "大数据",
				reviewedAt: today,
			},
		]);
	});

	test("按标准词收拢，别名按字排，人多的在前，人数按人不按段、连同别名和下面的词；只列此刻有人写的", async () => {
		const table = await listTerms("", 1, false);
		assert.deepEqual(table.rows, [
			{
				canonical: "推荐系统",
				parent: null,
				aliases: ["个性化推荐"],
				children: 1,
				people: 4,
				pending: false,
			},
			{
				canonical: "Flink",
				parent: null,
				aliases: [],
				children: 0,
				people: 1,
				pending: false,
			},
			{
				canonical: "Python",
				parent: null,
				aliases: [],
				children: 0,
				people: 1,
				pending: false,
			},
			{
				canonical: "Spark",
				parent: "大数据",
				aliases: [],
				children: 0,
				people: 1,
				pending: false,
			},
			{
				canonical: "大数据",
				parent: null,
				aliases: [],
				children: 1,
				people: 1,
				pending: false,
			},
			{
				canonical: "电商推荐系统",
				parent: "推荐系统",
				aliases: [],
				children: 0,
				people: 1,
				pending: false,
			},
		]);
		assert.equal(table.total, 6);
		assert.equal(table.pages, 1);
	});

	test("找词认标准词、并进去的写法和它属于的那个更宽的词", async () => {
		const byCanonical = await listTerms("Python", 1, false);
		assert.deepEqual(
			byCanonical.rows.map((row) => row.canonical),
			["Python"],
		);
		// 「个性化推荐」是并进「推荐系统」的写法，搜它出的是标准词那一行
		const byAlias = await listTerms("个性化推荐", 1, false);
		assert.deepEqual(
			byAlias.rows.map((row) => row.canonical),
			["推荐系统"],
		);
		// 「电商推荐系统」属于「推荐系统」，搜父词时两行都在
		const byParent = await listTerms("推荐系统", 1, false);
		assert.deepEqual(
			byParent.rows.map((row) => row.canonical),
			["推荐系统", "电商推荐系统"],
		);
		// 没人写的写法和词不算搜到
		assert.deepEqual((await listTerms("推荐引擎", 1, false)).rows, []);
		assert.deepEqual((await listTerms("Hadoop", 1, false)).rows, []);
		const none = await listTerms("没有这个词", 1, false);
		assert.deepEqual(none.rows, []);
		assert.equal(none.total, 0);
		assert.equal(none.pages, 1);
	});

	test("判成不是能力的词不在标签那张表里，单独一张表，详情写明它不是能力", async () => {
		const found = await listTerms("周报", 1, false);
		assert.deepEqual(found.rows, []);
		assert.equal(found.total, 0);
		// 「日报」也判成了不是能力，但没人写：不列
		const excluded = await listTerms("", 1, true);
		assert.deepEqual(
			excluded.rows.map((row) => row.canonical),
			["周报"],
		);
		assert.equal((await describeTerm("周报"))?.excluded, true);
		assert.equal((await describeTerm("推荐系统"))?.excluded, false);
		assert.equal(await describeTerm("没有这个词"), null);
	});

	test("详情从并进去的写法认回标准词，细分和更宽的词各带人数；没人写的词没有详情", async () => {
		const detail = await describeTerm("推荐算法");
		assert.equal(detail?.canonical, "推荐系统");
		// 「推荐算法」「推荐引擎」没人写，不算其他写法
		assert.deepEqual(detail?.aliases, ["个性化推荐"]);
		assert.deepEqual(detail?.children, [
			{ canonical: "电商推荐系统", people: 1 },
		]);
		assert.deepEqual((await describeTerm("Spark"))?.parent, {
			canonical: "大数据",
			people: 1,
		});
		assert.equal(await describeTerm("Hadoop"), null);
		// 地址上手写一个没人写了的写法，它那一项还有人写：给那一项
		assert.equal((await describeTerm("推荐引擎"))?.canonical, "推荐系统");
	});

	test("一项里有词在队列里等着判时是等待判定", async () => {
		const { pool } = await import("#/db");
		assert.equal((await describeTerm("推荐系统"))?.pending, false);
		await pool.query(
			`insert into review_word (guide_identity, word, people, near)
			 values ('${"0".repeat(64)}', '个性化推荐', 1, '[]'::jsonb)`,
		);
		assert.equal((await describeTerm("推荐系统"))?.pending, true);
	});
});
