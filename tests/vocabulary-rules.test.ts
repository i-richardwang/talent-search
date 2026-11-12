import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Member } from "#/corpus/judgment";
import {
	conform,
	type Decision,
	nearest,
	place,
	type Table,
	type Verdict,
	validate,
} from "#/corpus/vocabulary-rules";

const NOW = new Date("2026-01-08T00:00:00Z");
const BEFORE = new Date("2026-01-01T00:00:00Z");

/** 一张表：`[词, 标准写法, 归属]`，第四项写 true 是不是能力。 */
function tableOf(rows: [string, string, (string | null)?, boolean?][]): Table {
	return new Map(
		rows.map(([word, canonical, parent, excluded]) => [
			word,
			{
				canonical,
				excluded: excluded ?? false,
				parent: parent ?? null,
				reviewedAt: BEFORE,
			},
		]),
	);
}

const member = (word: string, people = 1): Member => ({ people, word });

/** 判一个词并让它生效，返回表里每个词现在的样子。 */
function judge(
	table: Table,
	word: Member,
	verdict: Verdict,
	near: Member[] = [],
) {
	place(table, { ...word, near }, verdict, NOW);
	validate(table);
	return Object.fromEntries(
		[...table].map(([one, decision]: [string, Decision]) => [
			one,
			decision.excluded
				? "不是能力"
				: decision.canonical !== one
					? `=${decision.canonical}`
					: (decision.parent ?? ""),
		]),
	);
}

describe("校验判定方的原话", () => {
	const near = ["数据分析", "数据统计"];

	test("四种位置各认一种写法", () => {
		assert.deepEqual(
			conform({ kind: "同一件事", target: "数据分析", why: "" }, "数分", near),
			{ as: "数据分析", kind: "same" },
		);
		assert.deepEqual(
			conform({ kind: "属于", target: "分析", why: "" }, "数分", near),
			{ kind: "under", parent: "分析" },
		);
		assert.deepEqual(
			conform({ kind: "自成一项", target: "", why: "" }, "数分", near),
			{ kind: "alone" },
		);
		assert.deepEqual(
			conform({ kind: "不是能力", target: "", why: "" }, "数分", near),
			{ kind: "excluded" },
		);
	});

	test("同一件事只能指向参考词", () => {
		assert.equal(
			conform({ kind: "同一件事", target: "分析", why: "" }, "数分", near),
			null,
		);
	});

	test("指向自己、缺目标、归属名太长、不认识的位置都不成判断", () => {
		const said = (kind: string, target: string) =>
			conform({ kind, target, why: "" }, "数分", [...near, "数分"]);
		assert.equal(said("同一件事", "数分"), null);
		assert.equal(said("属于", "数分"), null);
		assert.equal(said("属于", ""), null);
		assert.equal(said("属于", "一".repeat(17)), null);
		assert.equal(said("合并", "数据分析"), null);
		assert.equal(conform({ kind: "属于", target: "分析" }, "数分", near), null);
		assert.equal(conform("属于 分析", "数分", near), null);
	});

	test("起的名字折叠全半角，原样命中的参考词保留写法", () => {
		assert.deepEqual(
			conform({ kind: "属于", target: " ＢＩ ", why: "" }, "数分", near),
			{ kind: "under", parent: "BI" },
		);
		assert.deepEqual(
			conform({ kind: "属于", target: "ＢＩ", why: "" }, "数分", ["ＢＩ"]),
			{ kind: "under", parent: "ＢＩ" },
		);
	});
});

describe("找参考词", () => {
	test("按相似度从近到远，不含它自己", () => {
		const pool = ["东", "东北", "北", "西"];
		const vectors = [
			[1, 0],
			[1, 1],
			[0, 1],
			[-1, 0],
		];
		assert.deepEqual(nearest(pool, vectors)("东", [1, 0]), [
			"东北",
			"北",
			"西",
		]);
	});

	test("候选再多也只取最近的几个", () => {
		const pool = Array.from({ length: 20 }, (_, index) => `词${index}`);
		const vectors = pool.map((_, index) => [1, index]);
		assert.deepEqual(nearest(pool, vectors)("新词", [1, 0]), pool.slice(0, 8));
	});
});

describe("同一件事", () => {
	test("并进人多的那个词，时间只记在被判的词上", () => {
		const table: Table = new Map();
		assert.deepEqual(
			judge(table, member("数分", 2), { as: "数据分析", kind: "same" }, [
				member("数据分析", 40),
			]),
			{ 数分: "=数据分析", 数据分析: "" },
		);
		assert.deepEqual(table.get("数分")?.reviewedAt, NOW);
	});

	test("被判的词人更多时它做标准写法，那一项的写法、细词和归属都跟过来", () => {
		const table = tableOf([
			["分析", "分析"],
			["数分", "数分", "分析"],
			["数据分析能力", "数分"],
			["销售数分", "销售数分", "数分"],
		]);
		assert.deepEqual(
			judge(table, member("数据分析", 40), { as: "数分", kind: "same" }, [
				member("数分", 9),
			]),
			{
				分析: "",
				数分: "=数据分析",
				数据分析: "分析",
				数据分析能力: "=数据分析",
				销售数分: "数据分析",
			},
		);
		assert.deepEqual(table.get("数分")?.reviewedAt, BEFORE);
	});

	test("标准词并进别的词，它名下的写法和细词一起过去", () => {
		const table = tableOf([
			["数分", "数分"],
			["数据分析能力", "数分"],
			["销售数分", "销售数分", "数分"],
			["数据分析", "数据分析"],
		]);
		assert.deepEqual(
			judge(table, member("数分", 3), { as: "数据分析", kind: "same" }, [
				member("数据分析", 40),
			]),
			{
				数分: "=数据分析",
				数据分析: "",
				数据分析能力: "=数据分析",
				销售数分: "数据分析",
			},
		);
	});

	test("并进自己下面的细词时不留下归属环", () => {
		const table = tableOf([
			["分析", "分析"],
			["数据分析", "数据分析", "分析"],
		]);
		assert.deepEqual(
			judge(table, member("分析", 3), { as: "数据分析", kind: "same" }, [
				member("数据分析", 40),
			]),
			{ 分析: "=数据分析", 数据分析: "" },
		);
	});

	test("参考词后来成了别名，就并到它的标准词上", () => {
		const table = tableOf([
			["数据分析", "数据分析"],
			["数分", "数据分析"],
		]);
		assert.partialDeepStrictEqual(
			judge(table, member("数据分析能力"), { as: "数分", kind: "same" }, [
				member("数分", 5),
			]),
			{ 数据分析能力: "=数据分析" },
		);
	});

	test("已经是同一项的再判一次只记时间，归属不动", () => {
		const table = tableOf([
			["分析", "分析"],
			["数据分析", "数据分析", "分析"],
			["数分", "数据分析"],
		]);
		assert.deepEqual(
			judge(table, member("数据分析", 40), { as: "数分", kind: "same" }),
			{ 分析: "", 数分: "=数据分析", 数据分析: "分析" },
		);
		assert.deepEqual(table.get("数据分析")?.reviewedAt, NOW);
	});

	test("指向不是能力的词不成立，这个词不记", () => {
		const table = tableOf([["策略会", "策略会", null, true]]);
		assert.deepEqual(
			place(
				table,
				{ ...member("周会"), near: [] },
				{ as: "策略会", kind: "same" },
				NOW,
			),
			[],
		);
		assert.equal(table.has("周会"), false);
	});
});

describe("属于", () => {
	test("起的名字表里没有就落成一行", () => {
		assert.deepEqual(
			judge(new Map(), member("销售数据分析"), {
				kind: "under",
				parent: "数据分析",
			}),
			{ 数据分析: "", 销售数据分析: "数据分析" },
		);
	});

	test("起的名字自己还没判过，被判的词记下时间", () => {
		const table: Table = new Map();
		judge(table, member("销售数据分析"), { kind: "under", parent: "数据分析" });
		assert.equal(table.get("数据分析")?.reviewedAt, null);
		assert.deepEqual(table.get("销售数据分析")?.reviewedAt, NOW);
	});

	test("归属写的是别名时取它的标准词", () => {
		const table = tableOf([
			["数据分析", "数据分析"],
			["数分", "数据分析"],
		]);
		assert.partialDeepStrictEqual(
			judge(table, member("销售数分"), { kind: "under", parent: "数分" }),
			{ 销售数分: "数据分析" },
		);
	});

	test("别名判成属于就拆出来，可以属于原来的标准词", () => {
		const table = tableOf([
			["数据分析", "数据分析"],
			["销售数据分析", "数据分析"],
		]);
		assert.deepEqual(
			judge(table, member("销售数据分析"), {
				kind: "under",
				parent: "数据分析",
			}),
			{ 数据分析: "", 销售数据分析: "数据分析" },
		);
	});

	test("会成环的归属丢掉", () => {
		const table = tableOf([
			["分析", "分析"],
			["数据分析", "数据分析", "分析"],
			["数分", "数据分析"],
		]);
		assert.partialDeepStrictEqual(
			judge(table, member("分析"), { kind: "under", parent: "数据分析" }),
			{ 分析: "" },
		);
		assert.partialDeepStrictEqual(
			judge(table, member("数据分析"), { kind: "under", parent: "数分" }),
			{ 数据分析: "" },
		);
	});

	test("归属于不是能力的词时丢掉归属", () => {
		const table = tableOf([["策略会", "策略会", null, true]]);
		assert.deepEqual(
			judge(table, member("周会"), { kind: "under", parent: "策略会" }),
			{ 周会: "", 策略会: "不是能力" },
		);
	});
});

describe("自成一项", () => {
	test("别名拆出来，原来的归属清掉，名下的写法留着", () => {
		const table = tableOf([
			["分析", "分析"],
			["数据分析", "数据分析", "分析"],
			["数分", "数据分析"],
			["数据统计", "数据分析"],
		]);
		assert.partialDeepStrictEqual(
			judge(table, member("数据统计"), { kind: "alone" }),
			{
				数据统计: "",
			},
		);
		assert.deepEqual(judge(table, member("数据分析"), { kind: "alone" }), {
			分析: "",
			数分: "=数据分析",
			数据分析: "",
			数据统计: "",
		});
	});
});

describe("不是能力", () => {
	test("它名下的写法和属于它的词各自放开，退回成没判过", () => {
		const table = tableOf([
			["会议", "会议"],
			["开会", "会议"],
			["策略会", "策略会", "会议"],
		]);
		assert.deepEqual(judge(table, member("会议"), { kind: "excluded" }), {
			会议: "不是能力",
			开会: "",
			策略会: "",
		});
		assert.equal(table.get("开会")?.reviewedAt, null);
		assert.equal(table.get("策略会")?.reviewedAt, null);
		assert.deepEqual(table.get("会议")?.reviewedAt, NOW);
	});

	test("重判成能力就回到词表", () => {
		const table = tableOf([["定价", "定价", null, true]]);
		assert.deepEqual(judge(table, member("定价"), { kind: "alone" }), {
			定价: "",
		});
	});
});

describe("读表时的检查", () => {
	test("别名链、归属于别名、归属环、指向不是能力的词都拒绝", () => {
		assert.throws(
			() =>
				validate(
					tableOf([
						["甲", "乙"],
						["乙", "丙"],
						["丙", "丙"],
					]),
				),
			/自己又是别名/,
		);
		assert.throws(
			() =>
				validate(
					tableOf([
						["甲", "甲", "乙"],
						["乙", "丙"],
						["丙", "丙"],
					]),
				),
			/归属于一个别名/,
		);
		assert.throws(
			() =>
				validate(
					tableOf([
						["甲", "甲", "乙"],
						["乙", "乙", "甲"],
					]),
				),
			/成环/,
		);
		assert.throws(
			() =>
				validate(
					tableOf([
						["甲", "乙"],
						["乙", "乙", null, true],
					]),
				),
			/不是能力的词/,
		);
	});
});
