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

const { openQuestions, read, review, submitAnswer } = await import(
	"#/corpus/vocabulary"
);
const { pool } = await import("#/db");

const NOW = new Date("2026-09-08T00:00:00Z");
const OLD = new Date(NOW.getTime() - 30 * 86_400_000);
const JUDGE = "model:test";

async function client() {
	return pool.connect();
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

	test("裁判起的名字被判成别的写法的标准词时，边改指它而不是消失", async () => {
		const connection = await client();
		try {
			// 出一道人数上「销售数据分析」占优的题：裁判说「线上销售数据分析」和它是同一件事，
			// 那个没人写过的名字就要做标准写法
			await connection.query("delete from skill_review");
			const { rows } = await connection.query<{ id: number }>(
				`insert into skill_review (words)
				 values ('[{"word":"销售数据分析","people":5},{"word":"线上销售数据分析","people":3}]'::jsonb)
				 returning id`,
			);
			assert.equal(
				await submitAnswer(connection, rows[0]?.id as number, AGENT, [
					{ word: "销售数据分析", why: "宽", sameAs: "", parent: "" },
					{
						word: "线上销售数据分析",
						why: "同一件事",
						sameAs: "销售数据分析",
						parent: "",
					},
				]),
				"accepted",
			);
		} finally {
			connection.release();
		}
		const said = await runReview();
		assert.match(said.join("\n"), /线上销售数据分析 → 销售数据分析/);
		// 三个人身上的词换成了没人写过的那个名字：它此刻已经是一条说法
		assert.deepEqual(await peopleByWord(), [
			["Java", 1],
			["Python", 2],
			["团队管理", 5],
			["线下销售数据分析", 2],
			["销售数据分析", 3],
		]);
	});
});
