/**
 * 能力词对照表：读表的拒绝规则、归并、向量圈组、收窄、合并记账，以及整轮整理。
 *
 * 圈组用的是真向量（夹具那套字符袋假嵌入），所以「谁和谁算相似」在这里是可以
 * 手算的；判成不成别名仍然是模型的事，由测试装回答。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { answerChat, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const {
	apply,
	conform,
	groups,
	mapping,
	merge,
	openQuestions,
	read,
	review,
	submitAnswer,
} = await import("#/corpus/aliases");
const { pool } = await import("#/db");

const NOW = new Date("2026-09-08T00:00:00Z");
const OLD = new Date(NOW.getTime() - 30 * 86_400_000);
const JUDGE = "model:test";

async function client() {
	return pool.connect();
}

function decision(canonical: string, reviewedAt: Date) {
	return { canonical, judge: JUDGE, reviewedAt };
}

async function seedTable(rows: [string, string, Date][]) {
	const connection = await client();
	try {
		await connection.query("delete from skill_review");
		await connection.query("delete from skill_alias");
		for (const [word, canonical, reviewedAt] of rows)
			await connection.query(
				"insert into skill_alias (word, canonical, reviewed_at, judge) values ($1, $2, $3, $4)",
				[word, canonical, reviewedAt, JUDGE],
			);
	} finally {
		connection.release();
	}
}

/** 跑一轮整理，回收它说过的每一行。 */
async function runReview(): Promise<string[]> {
	const said: string[] = [];
	const connection = await client();
	try {
		await review(connection, (line) => said.push(line));
	} finally {
		connection.release();
	}
	return said;
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
			["推荐算法", decision("推荐系统", OLD)],
			["个性化推荐", decision("推荐系统", OLD)],
			["推荐系统", decision("推荐系统", OLD)],
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

	test("一组最多十二个词，多出来的留给下一轮", () => {
		// 二十个和组心几乎一样的词：圈子只收前十一个，剩下的不进这一组
		const near = Array.from({ length: 20 }, (_, i) => `写法${i}`);
		const all = ["组心", ...near];
		const vectors = all.map((_, i) => [1, i * 1e-3, 0]);
		const circles = groups(
			all,
			[10, ...near.map(() => 1)],
			vectors,
			new Set(all),
		);
		assert.equal(circles.length, 1);
		assert.equal(circles[0]?.length, 12);
		assert.equal(circles[0]?.[0], "组心");
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
	const candidates = ["推荐算法", "搜索推荐"];
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
				candidates,
			),
			["推荐算法"],
		);
	});

	test("不成形状的原话什么都不合并", () => {
		assert.deepEqual(conform({ judgments: "推荐算法" }, candidates), []);
		assert.deepEqual(
			conform({ judgments: [{ word: "推荐算法", alias: "true" }] }, candidates),
			[],
		);
		assert.deepEqual(conform("推荐系统", candidates), []);
	});
});

describe("记账", () => {
	test("组心记时间；对到别名的词一起改指组心", () => {
		const table = new Map([
			["Py", decision("Python", OLD)],
			["Python", decision("Python", OLD)],
		]);
		// 返回的是决定本身，写回表的那一步因此不必再回表里查（`write`）
		assert.deepEqual(
			merge(table, "推荐系统", ["Python"], NOW, JUDGE)
				.map(([word, decision]) => [
					word,
					decision.canonical,
					decision.reviewedAt,
				])
				.sort(),
			[
				["Py", "推荐系统", NOW],
				["Python", "推荐系统", NOW],
				["推荐系统", "推荐系统", NOW],
			],
		);
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
		assert.deepEqual(merge(table, "推荐系统", [], NOW, JUDGE), [
			["推荐系统", decision("推荐系统", NOW)],
		]);
		assert.equal(table.get("推荐系统")?.canonical, "推荐系统");
	});

	test("判它的裁判跟着决定走", () => {
		const table = new Map([["Py", decision("Python", OLD)]]);
		const changed = merge(table, "Python", ["Py"], NOW, "agent:hr-bot");
		assert.deepEqual(changed.map(([word, one]) => [word, one.judge]).sort(), [
			["Py", "agent:hr-bot"],
			["Python", "agent:hr-bot"],
		]);
	});
});

describe("整轮整理", () => {
	before(async () => {
		await seedTable([
			["Py", "Python", OLD],
			// 一天前整理过：这一轮它不做组心，即使人数够
			["Python", "Python", new Date(Date.now() - 86_400_000)],
		]);
		// 库里能力词那一路上此刻有的词。派生写边时已经按对照表换过词，所以没有「Py」
		await seed(
			[
				["团队管理"],
				["团队管理工作"],
				["团队管理", "团队管理工作", "Python"],
				["团队管理", "团队管理工作", "Python"],
				["团队管理", "团队管理工作", "Java"],
			].map((skills, index) => ({
				empId: `u${index + 1}`,
				name: `人${index + 1}`,
				segments: [{ kind: "external", months: 12, skills }],
			})),
		);
	});

	test("只问到期的组心，决定写回表，边改指标准词", async () => {
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return {
				judgments: [{ word: "团队管理工作", why: "同义", alias: true }],
			};
		});
		const said = await runReview();
		restore();

		// 到期的组心只有「团队管理」：Python 一天前刚整理过，Java 只有一个人
		assert.deepEqual(asked, ["标准词：团队管理\n团队管理工作（4 人）"]);
		assert.match(said.join("\n"), /团队管理工作 → 团队管理/);

		const later = await client();
		try {
			const table = await read(later);
			assert.equal(table.get("团队管理工作")?.canonical, "团队管理");
			assert.equal(table.get("团队管理")?.canonical, "团队管理");
			assert.equal(table.get("Py")?.canonical, "Python");
			// 自带模型判的，决定上记着是谁判的
			assert.match(table.get("团队管理")?.judge ?? "", /^model:/);
			// 队列跑空了才算完：出题、答题、结算在同一轮里连着做
			assert.deepEqual(await openQuestions(later), []);
			// 能力词那一路上再也没有别名：五个人里写了「团队管理工作」的四个都指向了标准词
			const { rows } = await later.query<{ word: string; people: string }>(
				`select p.text as word, count(distinct e.emp_id) as people
				 from experience_phrase ep
				 join phrase p on p.id = ep.phrase_id
				 join experience e on e.id = ep.experience_id
				 where ep.route = 'skill' group by p.text order by p.text`,
			);
			assert.deepEqual(
				rows.map((row) => [row.word, Number(row.people)]),
				[
					["Java", 1],
					["Python", 2],
					["团队管理", 5],
				],
			);
		} finally {
			later.release();
		}
	});
});

/**
 * 判卷交给外部：整理只出题和结算，答卷由外面交回来。
 *
 * 自带模型这一路在上面那一段已经走完，所以这里装的假聊天端点一次也不该被叫到——
 * 「没问模型」本身就是这一档要证明的事。
 */
describe("判卷交给外部", () => {
	const AGENT = "agent:hr-bot";
	let restoreEnv: () => void;

	before(async () => {
		const before = process.env.REVIEW_JUDGE;
		process.env.REVIEW_JUDGE = "external";
		restoreEnv = () => {
			if (before === undefined) delete process.env.REVIEW_JUDGE;
			else process.env.REVIEW_JUDGE = before;
		};
		// 对照表清空，语料里再添一批新词：这一轮有到期的组心可出题
		await seedTable([]);
		await seed(
			[
				["数据分析"],
				["数据分析", "数据分析工作"],
				["数据分析", "数据分析工作"],
			].map((skills, index) => ({
				empId: `d${index + 1}`,
				name: `数${index + 1}`,
				segments: [{ kind: "external", months: 12, skills }],
			})),
		);
	});

	after(() => restoreEnv());

	test("只出题，不问模型", async () => {
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return { judgments: [] };
		});
		const said = await runReview();
		restore();

		assert.deepEqual(asked, []);
		assert.match(said.join("\n"), /判卷归外部/);

		const connection = await client();
		try {
			const open = await openQuestions(connection);
			const question = open.find((one) => one.head === "数据分析");
			assert.ok(question, "「数据分析」该有一道题挂在队列里");
			assert.deepEqual(question.candidates, [
				{ word: "数据分析工作", people: 2 },
			]);
		} finally {
			connection.release();
		}
	});

	test("先到先得：第二份答卷不算，不存在的题分开说", async () => {
		const connection = await client();
		try {
			const [question] = await openQuestions(connection);
			assert.ok(question);
			const judgments = [
				{ word: "数据分析工作", why: "同一件事的不同写法", alias: true },
			];
			assert.equal(
				await submitAnswer(connection, question.id, AGENT, judgments),
				"accepted",
			);
			assert.equal(
				await submitAnswer(connection, question.id, "agent:another", judgments),
				"taken",
			);
			assert.equal(
				await submitAnswer(connection, 10_000_000, AGENT, judgments),
				"missing",
			);
			// 答过的题不再出现在拉题里
			assert.equal(
				(await openQuestions(connection)).some((one) => one.id === question.id),
				false,
			);
		} finally {
			connection.release();
		}
	});

	test("下一轮结算外部的答卷：决定记着是谁判的，边跟着改", async () => {
		const said = await runReview();
		assert.match(said.join("\n"), /结算 1 道题（agent:hr-bot 1 道）/);
		assert.match(said.join("\n"), /数据分析工作 → 数据分析/);

		const connection = await client();
		try {
			const table = await read(connection);
			assert.equal(table.get("数据分析工作")?.canonical, "数据分析");
			assert.equal(table.get("数据分析工作")?.judge, AGENT);
			const { rows } = await connection.query<{ people: string }>(
				`select count(distinct e.emp_id) as people
				 from experience_phrase ep
				 join phrase p on p.id = ep.phrase_id
				 join experience e on e.id = ep.experience_id
				 where ep.route = 'skill' and p.text = '数据分析'`,
			);
			assert.equal(Number(rows[0]?.people), 3);
			// 改指之后「数据分析工作」那条说法在边上一条都不剩
			const { rows: left } = await connection.query(
				`select 1 from experience_phrase ep
				 join phrase p on p.id = ep.phrase_id
				 where ep.route = 'skill' and p.text = '数据分析工作'`,
			);
			assert.equal(left.length, 0);
		} finally {
			connection.release();
		}
	});

	test("一周没人答的题作废，那个词下一轮重新出题", async () => {
		const connection = await client();
		try {
			await connection.query("delete from skill_review");
			await connection.query(
				`insert into skill_review (head, candidates, asked_at)
				 values ('陈年词', '[{"word":"陈年写法","people":2}]'::jsonb,
				         now() - interval '30 days')`,
			);
		} finally {
			connection.release();
		}
		const said = await runReview();
		assert.match(said.join("\n"), /1 道题过了 7 天没人答，作废/);

		const later = await client();
		try {
			assert.equal(
				(await openQuestions(later)).some((one) => one.head === "陈年词"),
				false,
			);
		} finally {
			later.release();
		}
	});
});
