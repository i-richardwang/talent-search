/**
 * 能力词词表：读表的拒绝规则、归并、向量圈组、收窄、记账，以及整轮整理。
 *
 * 圈组用的是真向量（夹具那套字符袋假嵌入），所以「谁和谁算相似」在这里是可以
 * 手算的；判成同一件事、判归属仍然是裁判的事，由测试装回答。
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
} = await import("#/corpus/vocabulary");
const { pool } = await import("#/db");

const NOW = new Date("2026-09-08T00:00:00Z");
const OLD = new Date(NOW.getTime() - 30 * 86_400_000);
const JUDGE = "model:test";

async function client() {
	return pool.connect();
}

function decision(
	canonical: string,
	reviewedAt: Date,
	parent: string | null = null,
) {
	return { canonical, judge: JUDGE, parent, reviewedAt };
}

type SeedRow = [
	word: string,
	canonical: string,
	reviewedAt: Date,
	parent?: string,
];

async function seedTable(rows: SeedRow[]) {
	const connection = await client();
	try {
		await connection.query("delete from skill_review");
		await connection.query("delete from skill_term");
		for (const [word, canonical, reviewedAt, parent] of rows)
			await connection.query(
				"insert into skill_term (word, canonical, parent, reviewed_at, judge) values ($1, $2, $3, $4, $5)",
				[word, canonical, parent ?? null, reviewedAt, JUDGE],
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
		await review(connection, (line: string) => said.push(line));
	} finally {
		connection.release();
	}
	return said;
}

/** 库里能力词那一路上每个词的人数。 */
async function peopleByWord(): Promise<[string, number][]> {
	const connection = await client();
	try {
		const { rows } = await connection.query<{ word: string; people: string }>(
			`select p.text as word, count(distinct e.emp_id) as people
			 from experience_phrase ep
			 join phrase p on p.id = ep.phrase_id
			 join experience e on e.id = ep.experience_id
			 where ep.route = 'skill' group by p.text order by p.text`,
		);
		return rows.map((row) => [row.word, Number(row.people)]);
	} finally {
		connection.release();
	}
}

describe("读表", () => {
	test("行变成决定，归属跟着标准词", async () => {
		await seedTable([
			["数据分析", "数据分析", OLD],
			["销售数据分析", "销售数据分析", OLD, "数据分析"],
			["销售数据的分析", "销售数据分析", OLD],
		]);
		const connection = await client();
		try {
			const table = await read(connection);
			assert.equal(table.get("销售数据的分析")?.canonical, "销售数据分析");
			assert.equal(table.get("销售数据的分析")?.parent, null);
			assert.equal(table.get("销售数据分析")?.parent, "数据分析");
			assert.deepEqual(table.get("数据分析")?.reviewedAt, OLD);
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

	test("归属于一个别名，出声拒绝", async () => {
		await seedTable([
			["数据分析", "数据分析", OLD],
			["数据分析能力", "数据分析", OLD],
			["销售数据分析", "销售数据分析", OLD, "数据分析能力"],
		]);
		const connection = await client();
		try {
			await assert.rejects(
				() => read(connection),
				/销售数据分析 归属于一个别名/,
			);
		} finally {
			connection.release();
		}
	});

	test("归属成环，出声拒绝", async () => {
		// 外键要求先有行再指它，所以先落两行再把环合上
		await seedTable([
			["甲", "甲", OLD],
			["乙", "乙", OLD, "甲"],
		]);
		const connection = await client();
		try {
			await connection.query(
				"update skill_term set parent = '乙' where word = '甲'",
			);
			await assert.rejects(() => read(connection), /的归属成环/);
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
	const words = ["运营数据分析", "销售数据分析", "数据分析报告"];
	const judged = (word: string, sameAs: string, parent: string) => ({
		word,
		why: "…",
		sameAs,
		parent,
	});

	test("只认题里的词，一个词只认第一条；sameAs 只认题里的另一个词", () => {
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

	test("不成形状的原话什么都不认", () => {
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

	test("同一件事那一片里人最多的做标准写法；对到别名的词一起改指它", () => {
		const table = new Map([
			["Py", decision("Python", OLD)],
			["Python", decision("Python", OLD)],
		]);
		// 「Python」两个人、「Python 语言」三个人：标准写法归人多的那个，裁判没得选
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

	test("归属指向题里另一片的词时取那一片的标准写法，指向表里别名时取它的标准词", () => {
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

	test("没判到的词不记，判过的裁判跟着决定走", () => {
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

describe("整轮整理", () => {
	before(async () => {
		await seedTable([
			["Py", "Python", OLD],
			// 一天前整理过：这一轮它不做组心，即使人数够
			["Python", "Python", new Date(Date.now() - 86_400_000)],
		]);
		// 库里能力词那一路上此刻有的词。派生写边时已经按词表换过词，所以没有「Py」
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
				judgments: [
					{ word: "团队管理", why: "同义", sameAs: "团队管理工作", parent: "" },
					{ word: "团队管理工作", why: "同义", sameAs: "", parent: "管理" },
				],
			};
		});
		const said = await runReview();
		restore();

		// 到期的组心只有「团队管理」：Python 一天前刚整理过，Java 只有一个人
		assert.deepEqual(asked, ["团队管理（4 人）\n团队管理工作（4 人）"]);
		assert.match(said.join("\n"), /团队管理工作 → 团队管理/);
		assert.match(said.join("\n"), /团队管理 属于 管理/);

		const later = await client();
		try {
			const table = await read(later);
			assert.equal(table.get("团队管理工作")?.canonical, "团队管理");
			assert.equal(table.get("团队管理")?.canonical, "团队管理");
			// 人一样多时按字序取标准写法；归属由片里的答卷投出来，裁判起的名字自己也是一行
			assert.equal(table.get("团队管理")?.parent, "管理");
			assert.equal(table.get("管理")?.canonical, "管理");
			assert.equal(table.get("Py")?.canonical, "Python");
			// 自带模型判的，决定上记着是谁判的
			assert.match(table.get("团队管理")?.judge ?? "", /^model:/);
			// 队列跑空了才算完：出题、答题、结算在同一轮里连着做
			assert.deepEqual(await openQuestions(later), []);
		} finally {
			later.release();
		}
		// 能力词那一路上再也没有别名：五个人里写了「团队管理工作」的四个都指向了标准词
		assert.deepEqual(await peopleByWord(), [
			["Java", 1],
			["Python", 2],
			["团队管理", 5],
		]);
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
		// 词表清空，语料里再添一批新词：这一轮有到期的组心可出题
		await seedTable([]);
		await seed(
			[
				["线上销售数据分析"],
				["线上销售数据分析", "线下销售数据分析"],
				["线上销售数据分析", "线下销售数据分析"],
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
			const question = open.find((one) =>
				one.words.some((member) => member.word === "线上销售数据分析"),
			);
			assert.ok(question, "「线上销售数据分析」该有一道题挂在队列里");
			assert.deepEqual(question.words, [
				{ word: "线上销售数据分析", people: 3 },
				{ word: "线下销售数据分析", people: 2 },
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
				{
					word: "线上销售数据分析",
					why: "兄弟",
					sameAs: "",
					parent: "销售数据分析",
				},
				{
					word: "线下销售数据分析",
					why: "兄弟",
					sameAs: "",
					parent: "销售数据分析",
				},
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

	test("下一轮结算外部的答卷：兄弟各自留在人身上，共同的更宽的词落成一行", async () => {
		const said = await runReview();
		assert.match(said.join("\n"), /结算 1 道题（agent:hr-bot 1 道）/);
		assert.match(said.join("\n"), /线下销售数据分析 属于 销售数据分析/);

		const connection = await client();
		try {
			const table = await read(connection);
			assert.equal(
				table.get("线下销售数据分析")?.canonical,
				"线下销售数据分析",
			);
			assert.equal(table.get("线下销售数据分析")?.parent, "销售数据分析");
			assert.equal(table.get("线上销售数据分析")?.parent, "销售数据分析");
			assert.equal(table.get("线下销售数据分析")?.judge, AGENT);
			assert.equal(table.get("销售数据分析")?.judge, AGENT);
		} finally {
			connection.release();
		}
		// 边一条没动：细的词还在人身上，宽的词由检索沿归属聚出来
		assert.deepEqual(await peopleByWord(), [
			["Java", 1],
			["Python", 2],
			["团队管理", 5],
			["线上销售数据分析", 3],
			["线下销售数据分析", 2],
		]);
	});

	test("一周没人答的题作废，那个词下一轮重新出题", async () => {
		const connection = await client();
		try {
			await connection.query("delete from skill_review");
			await connection.query(
				`insert into skill_review (words, asked_at)
				 values ('[{"word":"陈年词","people":3},{"word":"陈年写法","people":2}]'::jsonb,
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
				(await openQuestions(later)).some((one) =>
					one.words.some((member) => member.word === "陈年词"),
				),
				false,
			);
		} finally {
			later.release();
		}
	});

	test("裁判起的名字到期后也出题，人数按它下面的人算", async () => {
		const connection = await client();
		try {
			// 「销售数据分析」是上一轮裁判起的，没人在简历里写过；让它到期
			await connection.query(
				"update skill_term set reviewed_at = $1 where word = '销售数据分析'",
				[OLD],
			);
		} finally {
			connection.release();
		}
		await runReview();

		const later = await client();
		try {
			const question = (await openQuestions(later)).find(
				(one) => one.words[0]?.word === "销售数据分析",
			);
			assert.ok(question, "「销售数据分析」该做组心出一道题");
			// 三个人写了它下面的词，它就是 3 人；细的词刚判过，仍能被收进它的组
			assert.deepEqual(question.words, [
				{ word: "销售数据分析", people: 3 },
				{ word: "线上销售数据分析", people: 3 },
				{ word: "线下销售数据分析", people: 2 },
			]);
		} finally {
			later.release();
		}
	});
});
