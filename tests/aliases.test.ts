/**
 * 能力词对照表：读表的拒绝规则、归并、向量圈组、收窄、合并记账，以及整轮整理。
 *
 * 圈组用的是真向量（夹具那套字符袋假嵌入），所以「谁和谁算相似」在这里是可以
 * 手算的；判成不成别名仍然是模型的事，由测试装回答。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Extraction } from "#/corpus/extract";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { apply, conform, groups, mapping, merge, read, review } = await import(
	"#/corpus/aliases"
);
const { pool } = await import("#/db");

const NOW = new Date("2026-09-08T00:00:00Z");
const OLD = new Date(NOW.getTime() - 30 * 86_400_000);

async function client() {
	return pool.connect();
}

async function seedTable(rows: [string, string, Date][]) {
	const connection = await client();
	try {
		await connection.query("delete from skill_alias");
		for (const [word, canonical, reviewedAt] of rows)
			await connection.query(
				"insert into skill_alias (word, canonical, reviewed_at) values ($1, $2, $3)",
				[word, canonical, reviewedAt],
			);
	} finally {
		connection.release();
	}
}

describe("读表", () => {
	test("行变成决定", async () => {
		await seedTable([
			["推荐算法", "推荐系统", OLD],
			["推荐系统", "推荐系统", OLD],
		]);
		const connection = await client();
		try {
			const table = await read(connection);
			assert.equal(table.get("推荐算法")?.canonical, "推荐系统");
			assert.deepEqual(table.get("推荐系统")?.reviewedAt, OLD);
		} finally {
			connection.release();
		}
	});

	test("别名的标准词自己又是别名，出声拒绝", async () => {
		await seedTable([
			["个性化推荐", "推荐算法", OLD],
			["推荐算法", "推荐系统", OLD],
			["推荐系统", "推荐系统", OLD],
		]);
		const connection = await client();
		try {
			await assert.rejects(
				() => read(connection),
				/个性化推荐 的标准词自己又是别名/,
			);
		} finally {
			connection.release();
		}
	});
});

describe("归并", () => {
	test("能力词换成标准词并去重，做过的事不动", () => {
		const table = new Map([
			["推荐算法", { canonical: "推荐系统", reviewedAt: OLD }],
			["个性化推荐", { canonical: "推荐系统", reviewedAt: OLD }],
			["推荐系统", { canonical: "推荐系统", reviewedAt: OLD }],
		]);
		assert.deepEqual(
			[...mapping(table)],
			[
				["推荐算法", "推荐系统"],
				["个性化推荐", "推荐系统"],
			],
		);
		const got = apply(mapping(table), {
			skills: ["推荐算法", "Python", "个性化推荐"],
			did: [{ involvement: "负责建设", domain: "推荐算法" }],
		});
		assert.deepEqual(got, {
			skills: ["推荐系统", "Python"],
			did: [{ involvement: "负责建设", domain: "推荐算法" }],
		});
	});
});

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

	test("人最多的词先做组心，组和组不串", () => {
		assert.deepEqual(groups(words, counts, vectors, new Set(words)), [
			["推荐算法", "推荐系统"],
		]);
	});

	test("刚整理过的词不做组心，但还能被别人收进去", () => {
		assert.deepEqual(groups(words, counts, vectors, new Set(["推荐系统"])), [
			["推荐系统", "推荐算法", "个性化推荐"],
		]);
	});

	test("人不够的词不做组心", () => {
		// 只有一个人的「个性化推荐」到期了也不做组心
		assert.deepEqual(
			groups(words, counts, vectors, new Set(["个性化推荐"])),
			[],
		);
	});
});

describe("收窄", () => {
	const group = ["推荐系统", "推荐算法", "搜索推荐"];
	const judged = (word: string, alias: boolean) => ({ word, why: "…", alias });

	test("只认组里的候选词里判成 true 的，组心和外人都不算", () => {
		assert.deepEqual(
			conform(
				{
					judgments: [
						judged(" 推荐算法", true),
						judged("搜索推荐", false),
						judged("推荐系统", true),
						judged("别的词", true),
						judged("推荐算法", true),
					],
				},
				group,
			),
			["推荐算法"],
		);
	});

	test("不成形状的原话什么都不合并", () => {
		assert.deepEqual(conform({ judgments: "推荐算法" }, group), []);
		assert.deepEqual(
			conform({ judgments: [{ word: "推荐算法", alias: "true" }] }, group),
			[],
		);
		assert.deepEqual(conform("推荐系统", group), []);
	});
});

describe("记账", () => {
	test("组心记时间；对到别名的词一起改指组心", () => {
		const table = new Map([
			["Py", { canonical: "Python", reviewedAt: OLD }],
			["Python", { canonical: "Python", reviewedAt: OLD }],
		]);
		assert.deepEqual(merge(table, "推荐系统", ["Python"], NOW).sort(), [
			"Py",
			"Python",
			"推荐系统",
		]);
		assert.deepEqual(
			[...table].map(([word, d]) => [word, d.canonical]),
			[
				["Py", "推荐系统"],
				["Python", "推荐系统"],
				["推荐系统", "推荐系统"],
			],
		);
	});

	test("一个都没合并，组心照样记上时间", () => {
		const table = new Map();
		assert.deepEqual(merge(table, "推荐系统", [], NOW), ["推荐系统"]);
		assert.equal(table.get("推荐系统")?.canonical, "推荐系统");
	});
});

describe("整轮整理", () => {
	before(() =>
		seedTable([
			["Py", "Python", OLD],
			// 一天前整理过：这一轮它不做组心，即使人数够
			["Python", "Python", new Date(Date.now() - 86_400_000)],
		]),
	);

	test("先套旧决定，只问到期的组心，结果写回表", async () => {
		const extractions: Extraction[] = [
			{ skills: ["团队管理", "Py"], did: [] },
			{ skills: ["团队管理工作"], did: [] },
			{ skills: ["团队管理", "团队管理工作", "Python"], did: [] },
			{ skills: ["团队管理", "团队管理工作", "Py"], did: [] },
			{ skills: ["团队管理", "团队管理工作", "Java"], did: [] },
		];
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return {
				judgments: [{ word: "团队管理工作", why: "同义", alias: true }],
			};
		});
		const said: string[] = [];
		const connection = await client();
		let got: Extraction[];
		try {
			got = await review(
				connection,
				extractions,
				["u1", "u2", "u3", "u4", "u5"],
				(line) => said.push(line),
			);
		} finally {
			connection.release();
		}
		restore();

		// 到期的组心只有「团队管理」：Python 一天前刚整理过，Java 只有一个人
		assert.deepEqual(asked, ["标准词：团队管理\n团队管理工作（4 人）"]);
		// 旧决定（Py → Python）和新决定都套到了这一轮的能力词上
		assert.deepEqual(got[0]?.skills, ["团队管理", "Python"]);
		assert.deepEqual(got[1]?.skills, ["团队管理"]);
		assert.match(said.join("\n"), /团队管理工作 → 团队管理/);

		const later = await client();
		try {
			const table = await read(later);
			assert.equal(table.get("团队管理工作")?.canonical, "团队管理");
			assert.equal(table.get("团队管理")?.canonical, "团队管理");
			assert.equal(table.get("Py")?.canonical, "Python");
		} finally {
			later.release();
		}
	});
});
