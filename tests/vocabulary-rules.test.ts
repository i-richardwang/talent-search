import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { conform, groups, merge } from "#/corpus/vocabulary-rules";

const NOW = new Date("2026-09-08T00:00:00Z");
const OLD = new Date(NOW.getTime() - 30 * 86_400_000);
const JUDGE = "model:test";
function decision(
	canonical: string,
	reviewedAt: Date,
	parent: string | null = null,
) {
	return { canonical, judge: JUDGE, parent, reviewedAt };
}

describe("圈组", () => {
	const words = ["推荐系统", "推荐算法", "个性化推荐", "Python", "数据分析"];
	const counts = [3, 5, 1, 4, 2];
	// 推荐系统与推荐算法相近，个性化推荐只和推荐系统相近；Python、数据分析各自独立
	const vectors = [
		[1, 0, 0],
		[0.9, 0.44, 0],
		[0.9, -0.44, 0],
		[0, 0, 1],
		[0, 1, 0],
	];

	test("人最多的词先做中心词，组之间不重叠", () => {
		assert.deepEqual(groups(words, counts, vectors, new Set(words)), [
			["推荐算法", "推荐系统"],
		]);
	});

	test("刚整理过的词不做中心词，但仍可被收进别人的组", () => {
		assert.deepEqual(groups(words, counts, vectors, new Set(["推荐系统"])), [
			["推荐系统", "推荐算法", "个性化推荐"],
		]);
	});

	test("一组最多十二个词，多出来的留给下一轮", () => {
		// 二十个和中心词几乎一样的词：圈子只收前十一个，剩下的不进这一组
		const near = Array.from({ length: 20 }, (_, i) => `写法${i}`);
		const all = ["中心词", ...near];
		const vectors = all.map((_, i) => [1, i * 1e-3, 0]);
		const circles = groups(
			all,
			[10, ...near.map(() => 1)],
			vectors,
			new Set(all),
		);
		assert.equal(circles.length, 1);
		assert.equal(circles[0]?.length, 12);
		assert.equal(circles[0]?.[0], "中心词");
	});

	test("人数不够的词不做中心词", () => {
		// 只有一个人的「个性化推荐」到期了也不做中心词
		assert.deepEqual(
			groups(words, counts, vectors, new Set(["个性化推荐"])),
			[],
		);
	});
});

describe("收窄", () => {
	const words = ["运营数据分析", "销售数据分析", "数据分析报告"];
	const judged = (word: string, sameAs: string, parent: string) => ({
		word,
		why: "…",
		sameAs,
		parent,
	});

	test("只认组里的词，一个词只认第一条；sameAs 只认组里的另一个词", () => {
		assert.deepEqual(
			[
				...conform(
					{
						judgments: [
							judged(" 运营数据分析", "", "数据分析"),
							judged("销售数据分析", "运营数据分析", " 数据分析 "),
							judged("数据分析报告", "外人", ""),
							judged("外人", "运营数据分析", "数据分析"),
							judged("运营数据分析", "销售数据分析", "别的"),
						],
					},
					words,
				),
			],
			[
				["运营数据分析", { parent: "数据分析", sameAs: null }],
				["销售数据分析", { parent: "数据分析", sameAs: "运营数据分析" }],
				["数据分析报告", { parent: null, sameAs: null }],
			],
		);
	});

	test("方向反了的归属拦下：更宽的词不能是自己，也不能含着这个词", () => {
		const got = conform(
			{
				judgments: [
					judged("运营数据分析", "", "运营数据分析"),
					judged("销售数据分析", "", "电商销售数据分析"),
					judged("数据分析报告", "", "这个名字长得不像一条能力词而像半句话"),
				],
			},
			words,
		);
		assert.deepEqual(
			[...got.values()].map((one) => one.parent),
			[null, null, null],
		);
	});

	test("格式不对的原话不产出任何结果", () => {
		assert.equal(conform({ judgments: "运营数据分析" }, words).size, 0);
		assert.equal(conform("运营数据分析", words).size, 0);
		// 缺字段的那一条按空处理，词本身还是判过了
		assert.deepEqual(
			[...conform({ judgments: [{ word: "销售数据分析" }] }, words)],
			[["销售数据分析", { parent: null, sameAs: null }]],
		);
	});
});

describe("记账", () => {
	/** 按词的码点排，和库里 `order by word` 一个顺序，不受运行时的排序规则影响。 */
	const byWord = (a: [string, ...unknown[]], b: [string, ...unknown[]]) =>
		a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
	const members = (...pairs: [string, number][]) =>
		pairs.map(([word, people]) => ({ people, word }));
	const verdicts = (...triples: [string, string | null, string | null][]) =>
		new Map(
			triples.map(([word, sameAs, parent]) => [word, { parent, sameAs }]),
		);

	test("同一件事那一片里人最多的做标准写法；表里对到别名的词一起跟过去", () => {
		const table = new Map([
			["Py", decision("Python", OLD)],
			["Python", decision("Python", OLD)],
		]);
		// 「Python」两个人、「Python 语言」三个人：标准写法归人多的那个，判定方没得选
		const changed = merge(
			table,
			members(["Python", 2], ["Python 语言", 3]),
			verdicts(["Python", "Python 语言", null], ["Python 语言", null, null]),
			NOW,
			JUDGE,
		);
		assert.deepEqual(
			changed
				.map(([word, one]): [string, string, Date] => [
					word,
					one.canonical,
					one.reviewedAt,
				])
				.sort(byWord),
			[
				["Py", "Python 语言", NOW],
				["Python", "Python 语言", NOW],
				["Python 语言", "Python 语言", NOW],
			],
		);
		assert.equal(table.get("Py")?.canonical, "Python 语言");
	});

	test("这一次被判过的词按自己的判断走，不跟着旧标准词；没被判到的才跟", () => {
		const table = new Map([
			["跨部门协作", decision("跨部门协作", OLD)],
			["跨部门沟通", decision("跨部门协作", OLD)],
			["跨部门合作", decision("跨部门协作", OLD)],
		]);
		// 「跨部门协作」并进人更多的「跨部门协同」。它名下的「跨部门沟通」这次被判成
		// 另一件事，要拆开；「跨部门合作」在组里但没被判到，跟着标准词走
		merge(
			table,
			members(
				["跨部门沟通", 3],
				["跨部门协同", 20],
				["跨部门协作", 9],
				["跨部门合作", 2],
			),
			verdicts(
				["跨部门沟通", null, null],
				["跨部门协同", null, null],
				["跨部门协作", "跨部门协同", null],
			),
			NOW,
			JUDGE,
		);
		assert.equal(table.get("跨部门协作")?.canonical, "跨部门协同");
		assert.equal(table.get("跨部门沟通")?.canonical, "跨部门沟通");
		assert.equal(table.get("跨部门合作")?.canonical, "跨部门协同");
	});

	test("兄弟各自保留，共同的更宽的词落成一行", () => {
		const table = new Map();
		const changed = merge(
			table,
			members(["运营数据分析", 5], ["销售数据分析", 2]),
			verdicts(
				["运营数据分析", null, "数据分析"],
				["销售数据分析", null, "数据分析"],
			),
			NOW,
			JUDGE,
		);
		assert.deepEqual(
			changed
				.map(([word, one]): [string, string, string | null] => [
					word,
					one.canonical,
					one.parent,
				])
				.sort(byWord),
			[
				["数据分析", "数据分析", null],
				["运营数据分析", "运营数据分析", "数据分析"],
				["销售数据分析", "销售数据分析", "数据分析"],
			],
		);
	});

	test("归属指向组里另一片的词时取那一片的标准写法，指向表里别名时取它的标准词", () => {
		const table = new Map([
			["数据分析能力", decision("数据分析", OLD)],
			["数据分析", decision("数据分析", OLD)],
		]);
		merge(
			table,
			members(["产品数据分析", 4], ["用户数据分析", 3], ["用户行为分析", 5]),
			verdicts(
				["产品数据分析", null, "数据分析能力"],
				["用户数据分析", "用户行为分析", "产品数据分析"],
				["用户行为分析", null, null],
			),
			NOW,
			JUDGE,
		);
		assert.equal(table.get("产品数据分析")?.parent, "数据分析");
		// 用户数据分析和用户行为分析是同一件事，人多的做标准写法；归属按人数投出来
		assert.equal(table.get("用户数据分析")?.canonical, "用户行为分析");
		assert.equal(table.get("用户行为分析")?.parent, "产品数据分析");
		assert.equal(table.get("用户数据分析")?.parent, null);
	});

	test("归属会走回自己的丢掉，表里不成环", () => {
		const table = new Map([
			["数据分析", decision("数据分析", OLD)],
			["销售数据分析", decision("销售数据分析", OLD, "数据分析")],
		]);
		merge(
			table,
			members(["数据分析", 9]),
			verdicts(["数据分析", null, "销售数据分析"]),
			NOW,
			JUDGE,
		);
		assert.equal(table.get("数据分析")?.parent, null);
	});

	test("一个词并进别人时，归属于它的词改归属于标准写法", () => {
		const table = new Map([
			["数据分析", decision("数据分析", OLD)],
			["销售数据分析", decision("销售数据分析", OLD, "数据分析")],
		]);
		merge(
			table,
			members(["数据分析", 3], ["Data Analysis", 5]),
			verdicts(
				["数据分析", "Data Analysis", null],
				["Data Analysis", null, null],
			),
			NOW,
			JUDGE,
		);
		assert.equal(table.get("数据分析")?.canonical, "Data Analysis");
		assert.equal(table.get("销售数据分析")?.parent, "Data Analysis");
	});

	test("没判到的词不记，判过的那一方跟着决定走", () => {
		const table = new Map();
		const changed = merge(
			table,
			members(["Python", 3], ["Java", 3]),
			verdicts(["Python", null, null]),
			NOW,
			"agent:hr-bot",
		);
		assert.deepEqual(
			changed.map(([word, one]) => [word, one.judge]),
			[["Python", "agent:hr-bot"]],
		);
		assert.equal(table.has("Java"), false);
	});
});
