/**
 * 能力词词表：读表的拒绝规则、收集没判过的词和它的参考词、外部判定、生效、退回重判，以及整轮整理。
 *
 * 参考词用的是真向量（夹具那套字符袋假嵌入），所以一个词配哪些参考词在这里是可以
 * 手算的；判它在词表里的位置仍然是判定方的事，由测试装回答。
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { Rejudge } from "#/lib/task";
import { answerChat, askedWord, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { guideIdentity, GUIDE, read, sendBack } = await import(
	"#/corpus/vocabulary"
);
const { openWords, submitJudgment } = await import("#/corpus/judgment");
const { review } = await import("#/corpus/review");
const { pool } = await import("#/db");
const { reviewJudge } = await import("#/server/review");

/** 表里已经判过的词上记的时间。 */
const JUDGED = new Date("2026-08-09T00:00:00Z");

async function client() {
	return pool.connect();
}

/** 第五项写 true 是判成不是能力的词。 */
type SeedRow = [
	word: string,
	canonical: string,
	reviewedAt: Date,
	parent?: string,
	excluded?: boolean,
];

async function seedTable(rows: SeedRow[]) {
	const connection = await client();
	try {
		await connection.query("delete from review_word");
		await connection.query("delete from term");
		for (const [word, canonical, reviewedAt, parent, excluded] of rows)
			await connection.query(
				`insert into term (word, canonical, parent, excluded, reviewed_at)
				 values ($1, $2, $3, $4, $5)`,
				[word, canonical, parent ?? null, excluded ?? false, reviewedAt],
			);
	} finally {
		connection.release();
	}
}

async function runReview(rejudge: Rejudge | null = null): Promise<string[]> {
	const said: string[] = [];
	const connection = await client();
	try {
		const judge = reviewJudge();
		assert.notEqual(judge, "off");
		await review(
			connection,
			(line: string) => said.push(line),
			judge as "model" | "external",
			rejudge,
		);
	} finally {
		connection.release();
	}
	return said;
}

/** 队列里还等着判的词，按词取。 */
async function openWord(word: string) {
	const connection = await client();
	try {
		return (await openWords(connection, guideIdentity())).find(
			(one) => one.word === word,
		);
	} finally {
		connection.release();
	}
}

/** 队列里还等着判的词，按字排。 */
async function openList(): Promise<string[]> {
	const connection = await client();
	try {
		return (await openWords(connection, guideIdentity()))
			.map((one) => one.word)
			.sort();
	} finally {
		connection.release();
	}
}

function submitWord(id: number, judge: string, judgment: unknown) {
	return pool
		.connect()
		.then((connection) =>
			submitJudgment(connection, id, guideIdentity(), judge, judgment).finally(
				() => connection.release(),
			),
		);
}

/** 只把这一个词退回成没判过，同一项的其他写法不动。 */
async function unjudge(word: string) {
	await pool.query("update term set reviewed_at = null where word = $1", [
		word,
	]);
}

/** 词表里还没判过或被退回的词，按字排。 */
async function unjudged(): Promise<string[]> {
	const { rows } = await pool.query<{ word: string }>(
		"select word from term where reviewed_at is null order by word",
	);
	return rows.map((row) => row.word);
}

/** 库里能力词那一类上每个词的人数。 */
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
			["数据分析", "数据分析", JUDGED],
			["销售数据分析", "销售数据分析", JUDGED, "数据分析"],
			["销售数据的分析", "销售数据分析", JUDGED],
			["策略会", "策略会", JUDGED, undefined, true],
		]);
		const connection = await client();
		try {
			const table = await read(connection);
			assert.equal(table.get("策略会")?.excluded, true);
			assert.equal(table.get("数据分析")?.excluded, false);
			assert.equal(table.get("销售数据的分析")?.canonical, "销售数据分析");
			assert.equal(table.get("销售数据的分析")?.parent, null);
			assert.equal(table.get("销售数据分析")?.parent, "数据分析");
			assert.deepEqual(table.get("数据分析")?.reviewedAt, JUDGED);
		} finally {
			connection.release();
		}
	});

	test("别名的标准词又是别名时抛错", async () => {
		await seedTable([
			["个性化推荐", "推荐算法", JUDGED],
			["推荐算法", "推荐系统", JUDGED],
			["推荐系统", "推荐系统", JUDGED],
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

	test("归属指向别名时抛错", async () => {
		await seedTable([
			["数据分析", "数据分析", JUDGED],
			["数据分析能力", "数据分析", JUDGED],
			["销售数据分析", "销售数据分析", JUDGED, "数据分析能力"],
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

	test("有词归属于不是能力的词时抛错", async () => {
		await seedTable([
			["策略会", "策略会", JUDGED, undefined, true],
			["季度策略会", "季度策略会", JUDGED, "策略会"],
		]);
		const connection = await client();
		try {
			await assert.rejects(
				() => read(connection),
				/季度策略会 对到或归属于一个不是能力的词/,
			);
		} finally {
			connection.release();
		}
	});

	test("归属成环时抛错", async () => {
		// 外键要求先有行再指它，所以先落两行再把环合上
		await seedTable([
			["甲", "甲", JUDGED],
			["乙", "乙", JUDGED, "甲"],
		]);
		const connection = await client();
		try {
			await connection.query("update term set parent = '乙' where word = '甲'");
			await assert.rejects(() => read(connection), /的归属成环/);
		} finally {
			connection.release();
		}
	});
});

/** 模型的回答按要判的词给；没写到的词答一句不成判断的话。 */
function answerByWord(answers: Record<string, unknown>, asked: string[]) {
	return answerChat((system, prompt) => {
		assert.equal(system, GUIDE);
		asked.push(prompt);
		return answers[askedWord(prompt)] ?? { why: "", kind: "", target: "" };
	});
}

describe("整轮整理", () => {
	before(async () => {
		await seedTable([
			["Py", "Python", JUDGED],
			["Python", "Python", JUDGED],
		]);
		// 库里能力词那一类上此刻有的词。「Py」在表里是别名，但没有人写它
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
				segments: [{ kind: "external", months: 12, extracted: { skills } }],
			})),
		);
	});

	test("只问没判过的词，只有一个人写的也问；结论写回表，人身上的词不动", async () => {
		const asked: string[] = [];
		const restore = answerByWord(
			{
				Java: { why: "一门编程语言", kind: "自成一项", target: "" },
				团队管理: { why: "管理的一种", kind: "属于", target: "管理" },
				团队管理工作: { why: "同义", kind: "同一件事", target: "团队管理" },
			},
			asked,
		);
		const said = await runReview();
		restore();

		// Python 判过了；Py 没有人写；Java 只有一个人写，也要判
		assert.deepEqual(
			asked.map((prompt) => prompt.split("\n")[0]).sort(),
			[
				"要判的词：Java（1 人）",
				"要判的词：团队管理（4 人）",
				"要判的词：团队管理工作（4 人）",
			].sort(),
		);
		// 参考词按写法从近到远，写法毫不相干的也列上，带各自的人数；它自己不在里面
		assert.ok(
			asked.includes(
				"要判的词：团队管理工作（4 人）\n参考词：\n团队管理（4 人）\nJava（1 人）\nPython（2 人）",
			),
			asked.join("\n---\n"),
		);
		assert.match(said.join("\n"), /团队管理工作 → 团队管理/);
		assert.match(said.join("\n"), /团队管理 属于 管理/);
		assert.match(
			said.join("\n"),
			/同一件事 1 个，属于 1 个，自成一项 1 个，不是能力 0 个/,
		);

		const later = await client();
		try {
			const table = await read(later);
			assert.equal(table.get("团队管理工作")?.canonical, "团队管理");
			assert.equal(table.get("团队管理")?.canonical, "团队管理");
			// 人一样多时取被对到的那个词做标准写法；它的归属沿用，判定方起的名字自己也是一行
			assert.equal(table.get("团队管理")?.parent, "管理");
			assert.equal(table.get("管理")?.canonical, "管理");
			// 起的名字自己还没判过，下一轮判它；被判的词记下了时间
			assert.equal(table.get("管理")?.reviewedAt, null);
			assert.ok(table.get("团队管理")?.reviewedAt);
			assert.equal(table.get("Java")?.canonical, "Java");
			assert.equal(table.get("Java")?.parent, null);
			assert.equal(table.get("Py")?.canonical, "Python");
			// 队列跑空了才算完：收集、判定、生效在同一轮里连着做
			assert.deepEqual(await openWords(later, guideIdentity()), []);
		} finally {
			later.release();
		}
		// 词表只决定筛选栏怎么摆：写了「团队管理工作」的四个人身上仍是这四个字
		assert.deepEqual(await peopleByWord(), [
			["Java", 1],
			["Python", 2],
			["团队管理", 4],
			["团队管理工作", 4],
		]);
	});

	test("模型答不成判断的词留到下一轮，不记时间", async () => {
		await unjudge("Java");
		const asked: string[] = [];
		const restore = answerByWord({}, asked);
		const said = await runReview();
		restore();

		// 上一轮判定方起的「管理」这一轮也要判
		assert.deepEqual(asked.map((prompt) => prompt.split("\n")[0]).sort(), [
			"要判的词：Java（1 人）",
			"要判的词：管理（5 人）",
		]);
		assert.match(said.join("\n"), /整理回答不符合领域规则，未保存/);
		// 无效回答不进队列那一行：这两个词还等着判，表里仍是没判过
		assert.deepEqual(await openList(), ["Java", "管理"]);
		assert.deepEqual(await unjudged(), ["Java", "管理"]);
	});
});

/**
 * 判定交给外部：整理只收集和让它生效，判定由外部提交。
 *
 * 自带模型这一类在上面那一段已经走完，所以这里装的假聊天端点一次也不该被叫到——
 * 「没问模型」就是这一档要证明的事。
 */
describe("判定交给外部", () => {
	const AGENT = "agent:hr-bot";
	let restoreEnv: () => void;

	before(async () => {
		const before = process.env.REVIEW_JUDGE;
		process.env.REVIEW_JUDGE = "external";
		restoreEnv = () => {
			if (before === undefined) delete process.env.REVIEW_JUDGE;
			else process.env.REVIEW_JUDGE = before;
		};
		// 词表清空，语料里再添一批新词：这一轮语料里的每个词都没判过
		await seedTable([]);
		await seed(
			[
				["线上销售数据分析"],
				["线上销售数据分析", "线下销售数据分析"],
				["线上销售数据分析", "线下销售数据分析"],
			].map((skills, index) => ({
				empId: `d${index + 1}`,
				name: `数${index + 1}`,
				segments: [{ kind: "external", months: 12, extracted: { skills } }],
			})),
		);
	});

	after(() => restoreEnv());

	test("只收集，不问模型", async () => {
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return { why: "", kind: "自成一项", target: "" };
		});
		const said = await runReview();
		restore();

		assert.deepEqual(asked, []);
		assert.match(said.join("\n"), /判定由外部完成，队列里还有 6 个词等着判/);
		// 一个词一行，没进词表的语料词都在
		assert.deepEqual(
			await openList(),
			[
				"Java",
				"Python",
				"团队管理",
				"团队管理工作",
				"线上销售数据分析",
				"线下销售数据分析",
			].sort(),
		);
		const word = await openWord("线上销售数据分析");
		assert.ok(word, "「线上销售数据分析」该在队列里");
		assert.equal(word.people, 3);
		// 写法最近的排第一；词表里的词不到八个，其余的全列上
		assert.deepEqual(word.near[0], { word: "线下销售数据分析", people: 2 });
		assert.deepEqual(
			word.near.map((one) => one.word).sort(),
			["Java", "Python", "团队管理", "团队管理工作", "线下销售数据分析"].sort(),
		);
	});

	test("先到先得：第二份判定不算，不存在的词分开说", async () => {
		const word = await openWord("线上销售数据分析");
		assert.ok(word);
		const judgment = { why: "兄弟", kind: "属于", target: "销售数据分析" };
		assert.equal(await submitWord(word.id, AGENT, judgment), "accepted");
		assert.equal(await submitWord(word.id, "agent:another", judgment), "taken");
		assert.equal(await submitWord(10_000_000, AGENT, judgment), "missing");
		// 判过的词不再出现在待判的那一份里
		assert.equal(await openWord("线上销售数据分析"), undefined);
	});

	test("下一轮让外部的判定生效：兄弟各自留在人身上，共同的更宽的词落成一行", async () => {
		const word = await openWord("线下销售数据分析");
		assert.ok(word);
		assert.equal(
			await submitWord(word.id, AGENT, {
				why: "兄弟",
				kind: "属于",
				target: "销售数据分析",
			}),
			"accepted",
		);
		const said = await runReview();
		assert.match(said.join("\n"), /生效 2 个词的判定（agent:hr-bot 2 个）/);
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
			assert.equal(table.get("销售数据分析")?.canonical, "销售数据分析");
		} finally {
			connection.release();
		}
		// 边一条没动：细的词还在人身上，宽的词由检索沿归属聚出来
		assert.deepEqual(await peopleByWord(), [
			["Java", 1],
			["Python", 2],
			["团队管理", 4],
			["团队管理工作", 4],
			["线上销售数据分析", 3],
			["线下销售数据分析", 2],
		]);
	});

	test("不成判断的判定也删掉，那个词不记时间，下一轮重新收", async () => {
		const word = await openWord("Java");
		assert.ok(word);
		// 「同一件事」指向参考词以外的词，不成一条判断
		assert.equal(
			await submitWord(word.id, AGENT, {
				why: "…",
				kind: "同一件事",
				target: "外人",
			}),
			"accepted",
		);
		const said = await runReview();
		assert.match(said.join("\n"), /不成判断 1 个/);
		const connection = await client();
		try {
			assert.equal((await read(connection)).has("Java"), false);
		} finally {
			connection.release();
		}
		assert.ok(await openWord("Java"), "「Java」该重新进队列");
	});

	test("队列里的行等到有人判，收了多久都在", async () => {
		const connection = await client();
		try {
			await connection.query("delete from review_word");
			await connection.query(
				`insert into review_word (guide_identity, word, people, near, collected_at)
				 values ($1, '陈年词', 3, '[{"word":"陈年写法","people":2}]'::jsonb,
				         now() - interval '30 days')`,
				[guideIdentity()],
			);
		} finally {
			connection.release();
		}
		await runReview();
		assert.ok(await openWord("陈年词"), "收了一个月的词还在队列里");
		await pool.query("delete from review_word where word = '陈年词'");
	});

	test("判定方起的名字也要判一次，人数按它下面的人算", async () => {
		// 「销售数据分析」是上一轮判定方起的，没人在简历里写过，它自己还没判过

		const word = await openWord("销售数据分析");
		assert.ok(word, "「销售数据分析」该进队列");
		// 三个人写了它下面的词，它就是 3 人；参考词带着下面的细词
		assert.equal(word.people, 3);
		assert.deepEqual(
			word.near
				.filter((one) => one.word.includes("销售数据分析"))
				.map((one) => [one.word, one.people])
				.sort(),
			[
				["线上销售数据分析", 3],
				["线下销售数据分析", 2],
			].sort(),
		);
		// 细的词判过了，不再问
		assert.equal(await openWord("线上销售数据分析"), undefined);
		assert.equal(await openWord("线下销售数据分析"), undefined);
	});

	test("判定方起的名字可以做标准写法：写了别的写法的人身上的词不动", async () => {
		const connection = await client();
		try {
			// 人数上「销售数据分析」占优：判定方说「线上销售数据分析」和它是同一件事，
			// 那个没人写过的名字就要做标准写法
			await connection.query("delete from review_word");
			const { rows } = await connection.query<{ id: number }>(
				`insert into review_word (guide_identity, word, people, near)
				 values ($1, '线上销售数据分析', 3, '[{"word":"销售数据分析","people":5}]'::jsonb)
				 returning id`,
				[guideIdentity()],
			);
			assert.equal(
				await submitWord(rows[0]?.id as number, AGENT, {
					why: "同一件事",
					kind: "同一件事",
					target: "销售数据分析",
				}),
				"accepted",
			);
		} finally {
			connection.release();
		}
		const said = await runReview();
		assert.match(said.join("\n"), /线上销售数据分析 → 销售数据分析/);
		const later = await client();
		try {
			const table = await read(later);
			assert.equal(table.get("线上销售数据分析")?.canonical, "销售数据分析");
			assert.equal(table.get("线上销售数据分析")?.parent, null);
		} finally {
			later.release();
		}
		assert.deepEqual(await peopleByWord(), [
			["Java", 1],
			["Python", 2],
			["团队管理", 4],
			["团队管理工作", 4],
			["线上销售数据分析", 3],
			["线下销售数据分析", 2],
		]);
	});

	test("别名退回重判，这一次判开就拆出来", async () => {
		await pool.query("delete from review_word");
		await unjudge("线上销售数据分析");
		await runReview();

		const word = await openWord("线上销售数据分析");
		assert.ok(word, "别名「线上销售数据分析」该进队列");
		// 别名的人数是写了这个写法的人；它的标准词连同它和下面的词一起数
		assert.equal(word.people, 3);
		assert.deepEqual(
			word.near.find((one) => one.word === "销售数据分析"),
			{ word: "销售数据分析", people: 3 },
		);
		assert.equal(
			await submitWord(word.id, AGENT, {
				why: "只是线上那一种",
				kind: "属于",
				target: "销售数据分析",
			}),
			"accepted",
		);
		await runReview();

		const settled = await client();
		try {
			const table = await read(settled);
			assert.equal(
				table.get("线上销售数据分析")?.canonical,
				"线上销售数据分析",
			);
			assert.equal(table.get("线上销售数据分析")?.parent, "销售数据分析");
		} finally {
			settled.release();
		}
	});

	test("判成不是能力的词写进词表，人身上的词不动，也不作别的词的参考词", async () => {
		const word = await openWord("Java");
		assert.ok(word);
		assert.equal(
			await submitWord(word.id, AGENT, {
				why: "看不出说的是什么",
				kind: "不是能力",
				target: "",
			}),
			"accepted",
		);
		const said = await runReview();
		assert.match(said.join("\n"), /Java 不是能力/);
		const connection = await client();
		try {
			const table = await read(connection);
			assert.deepEqual(
				{ ...table.get("Java"), reviewedAt: undefined },
				{
					canonical: "Java",
					excluded: true,
					parent: null,
					reviewedAt: undefined,
				},
			);
		} finally {
			connection.release();
		}
		assert.deepEqual(
			(await peopleByWord()).find(([word]) => word === "Java"),
			["Java", 1],
		);

		// 重新收一遍（「Python」还没判过，每轮都收）：这一轮收进来的词，参考词里都没有它
		await pool.query("delete from review_word");
		await runReview();
		const python = await openWord("Python");
		assert.ok(python, "「Python」该进队列");
		assert.equal(
			python.near.some((one) => one.word === "Java"),
			false,
		);
		assert.ok(python.near.length > 0);
	});

	test("不是能力的词退回重判，可以判回来", async () => {
		const said = await runReview({
			branch: false,
			scope: "term",
			word: "Java",
		});
		assert.match(said.join("\n"), /「Java」退回重新判定，共 1 个词/);
		const word = await openWord("Java");
		assert.ok(word, "「Java」该进队列");
		assert.equal(
			await submitWord(word.id, AGENT, {
				why: "一门编程语言",
				kind: "自成一项",
				target: "",
			}),
			"accepted",
		);
		await runReview();
		const connection = await client();
		try {
			const table = await read(connection);
			assert.equal(table.get("Java")?.excluded, false);
			assert.equal(table.get("Java")?.canonical, "Java");
		} finally {
			connection.release();
		}
	});
});

describe("退回重新判定", () => {
	const said: string[] = [];
	const report = (line: string) => said.push(line);

	async function back(rejudge: Rejudge): Promise<string[]> {
		await seedTable([
			["培训", "培训", JUDGED],
			["培训工作", "培训", JUDGED],
			["销售培训", "销售培训", JUDGED, "培训"],
			["销售培训课", "销售培训", JUDGED],
			["门店销售培训", "门店销售培训", JUDGED, "销售培训"],
			["Java", "Java", JUDGED],
			["周报", "周报", JUDGED, undefined, true],
		]);
		const connection = await client();
		try {
			await sendBack(connection, report, rejudge);
		} finally {
			connection.release();
		}
		return unjudged();
	}

	test("一项连同它的其他写法；给的是别名也认到这一项", async () => {
		assert.deepEqual(
			await back({ branch: false, scope: "term", word: "培训工作" }),
			["培训", "培训工作"],
		);
		assert.match(said.at(-1) ?? "", /「培训工作」退回重新判定，共 2 个词/);
	});

	test("带细分时沿归属一层层往下，各带各的其他写法", async () => {
		assert.deepEqual(
			await back({ branch: true, scope: "term", word: "培训" }),
			["培训", "培训工作", "销售培训", "销售培训课", "门店销售培训"].sort(),
		);
		assert.match(said.at(-1) ?? "", /「培训」连同它的细分退回重新判定/);
	});

	test("判成不是能力的全部词", async () => {
		assert.deepEqual(await back({ scope: "excluded" }), ["周报"]);
	});

	test("整张词表", async () => {
		assert.equal((await back({ scope: "all" })).length, 7);
		assert.match(said.at(-1) ?? "", /整张词表退回重新判定，共 7 个词/);
	});
});
