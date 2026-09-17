/**
 * 释义组。收窄规则是纯函数；收集、生效走真库——收谁、绕开谁、
 * 落表时清不清分数缓存，都是 SQL 里的事。判定方由测试装回答。
 */

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { answerChat, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { BATCH, conformGlosses, GLOSS_GUIDE, GLOSS_MAX, glossIdentity } =
	await import("#/corpus/gloss");
const { openGroups, submitJudgment } = await import("#/corpus/judgment");
const { review } = await import("#/corpus/review");
const { pool } = await import("#/db");

async function client() {
	return pool.connect();
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

async function glosses(): Promise<[string, string][]> {
	const connection = await client();
	try {
		const { rows } = await connection.query<{ text: string; gloss: string }>(
			"select text, gloss from phrase_gloss order by text",
		);
		return rows.map((row) => [row.text, row.gloss]);
	} finally {
		connection.release();
	}
}

describe("收窄判定结果", () => {
	const words = ["客户开发", "服务端开发"];

	test("只收组里的词，一句话，去掉抄在前面的词本身和句号", () => {
		const got = conformGlosses(
			{
				judgments: [
					{ word: "客户开发", gloss: "客户开发：销售拓展新客户、促成签约。" },
					{ word: "服务端开发", gloss: " 编写运行在服务器上的程序与接口 " },
					{ word: "服务端开发", gloss: "第二次答的不算" },
					{ word: "外人", gloss: "不在组里" },
				],
			},
			words,
		);
		assert.deepEqual(
			[...got],
			[
				["客户开发", "销售拓展新客户、促成签约"],
				["服务端开发", "编写运行在服务器上的程序与接口"],
			],
		);
	});

	test("空的、和词一样的、太长的、带换行的都不算；形状不对整份不算", () => {
		const got = conformGlosses(
			{
				judgments: [
					{ word: "客户开发", gloss: "" },
					{ word: "服务端开发", gloss: "服务端开发" },
				],
			},
			words,
		);
		assert.equal(got.size, 0);
		assert.equal(
			conformGlosses(
				{
					judgments: [{ word: "客户开发", gloss: "长".repeat(GLOSS_MAX + 1) }],
				},
				words,
			).size,
			0,
		);
		assert.equal(
			conformGlosses(
				{ judgments: [{ word: "客户开发", gloss: "长".repeat(GLOSS_MAX) }] },
				words,
			).size,
			1,
		);
		assert.equal(conformGlosses({ judgments: "都好" }, words).size, 0);
		assert.equal(conformGlosses(null, words).size, 0);
	});
});

describe("收集与生效", () => {
	const AGENT = "agent:hr-bot";
	let restoreEnv: () => void;

	before(async () => {
		const previous = process.env.REVIEW_JUDGE;
		process.env.REVIEW_JUDGE = "external";
		restoreEnv = () => {
			if (previous === undefined) delete process.env.REVIEW_JUDGE;
			else process.env.REVIEW_JUDGE = previous;
		};
		// 四类短说法各来一条，外加一段没读过的整段原文和一条部门路径：后两样不写释义
		await seed([
			{
				empId: "g1",
				name: "甲",
				segments: [
					{
						kind: "internal",
						months: 12,
						seqL1: "技术",
						seqL2: "后端研发",
						title: "高级后端开发工程师",
						orgPath: "技术部>基础平台",
					},
					{
						kind: "external",
						months: 12,
						org: "某公司",
						extracted: {
							skills: ["服务端开发", "客户开发"],
							did: [{ involvement: "负责", domain: "订单系统" }],
						},
					},
					{
						kind: "external",
						months: 6,
						description: "负责公司官网前端页面开发与维护，这一段没读过",
					},
				],
			},
			{
				empId: "g2",
				name: "乙",
				segments: [
					{
						kind: "external",
						months: 12,
						extracted: { skills: ["服务端开发"] },
					},
				],
			},
		]);
	});

	after(() => restoreEnv());

	test("技能、做过的事、岗位名、序列名进组，带人数；原文和部门路径不进", async () => {
		const said = await runReview();
		assert.match(said.join("\n"), /条短说法还没有这一版的释义/);
		assert.match(said.join("\n"), /收了 1 组释义/);

		const connection = await client();
		try {
			const open = (await openGroups(connection)).filter(
				(one) => one.kind === "gloss",
			);
			assert.equal(open.length, 1);
			const words = open[0]?.words ?? [];
			assert.ok(words.length <= BATCH);
			assert.deepEqual(
				[...words].sort((a, b) => a.word.localeCompare(b.word)),
				[
					{ people: 1, word: "技术 · 后端研发" },
					{ people: 1, word: "订单系统" },
					{ people: 2, word: "服务端开发" },
					{ people: 1, word: "客户开发" },
					{ people: 1, word: "高级后端开发工程师" },
				].sort((a, b) => a.word.localeCompare(b.word)),
			);
		} finally {
			connection.release();
		}
	});

	test("队列里挂着的说法不再收", async () => {
		const said = await runReview();
		assert.doesNotMatch(said.join("\n"), /收了 \d+ 组释义/);
	});

	test("生效：释义落表、这些说法的分数缓存清掉、没判的下一轮重收", async () => {
		const connection = await client();
		let id = 0;
		try {
			const group = (await openGroups(connection)).find(
				(one) => one.kind === "gloss",
			);
			assert.ok(group);
			id = group.id;
			// 先给两条说法各留一个假分数：生效之后它们必须不在了
			await connection.query(
				`insert into phrase_relevance (space, query, phrase_id, relevance)
				 select 'fake-rerank', '服务端开发', p.id, 0.9 from phrase p
				 where p.text in ('服务端开发', '客户开发', '订单系统')`,
			);
			assert.equal(
				await submitJudgment(connection, id, AGENT, [
					{ word: "服务端开发", gloss: "编写运行在服务器上的程序与接口" },
					{ word: "客户开发", gloss: "客户开发：销售拓展新客户、促成签约" },
					{ word: "高级后端开发工程师", gloss: "" },
				]),
				"accepted",
			);
		} finally {
			connection.release();
		}

		const said = await runReview();
		assert.match(
			said.join("\n"),
			/生效 1 组释义（agent:hr-bot 1 组），写下 2 条释义，3 个说法没判或判得不合规矩，下一轮重收/,
		);
		assert.deepEqual(await glosses(), [
			["客户开发", "销售拓展新客户、促成签约"],
			["服务端开发", "编写运行在服务器上的程序与接口"],
		]);

		const later = await client();
		try {
			const { rows } = await later.query<{ text: string }>(
				`select p.text from phrase_relevance r join phrase p on p.id = r.phrase_id
				 order by p.text`,
			);
			// 写了释义的两条清掉了；没写的「订单系统」的分数还在
			assert.deepEqual(
				rows.map((row) => row.text),
				["订单系统"],
			);
			// 同一轮里没判的三个又收成了一组
			const open = (await openGroups(later)).filter(
				(one) => one.kind === "gloss",
			);
			assert.deepEqual(
				open.flatMap((one) => one.words.map((member) => member.word)).sort(),
				["技术 · 后端研发", "订单系统", "高级后端开发工程师"],
			);
			assert.ok(!open.some((one) => one.id === id));
		} finally {
			later.release();
		}
	});

	test("标准改了，旧版本的释义重收一遍", async () => {
		const connection = await client();
		try {
			// 改 GLOSS_GUIDE 在库里就是这一下：这些释义算的是别的版本了
			await connection.query(
				"update phrase_gloss set guide_identity = 'older-standard'",
			);
			const said = await runReview();
			assert.match(said.join("\n"), /收了 1 组释义/);
			// 上一场留在队列里的那三个没被动，重收的只有写过释义的这两个
			const back = (await openGroups(connection)).find((one) =>
				one.words.some((member) => member.word === "客户开发"),
			);
			assert.ok(back);
			assert.deepEqual(
				back.words.map((member) => member.word).sort(),
				["客户开发", "服务端开发"].sort(),
			);
			// 重写之后又是这一版的，不再重收
			assert.equal(
				await submitJudgment(connection, back.id, AGENT, [
					{ word: "客户开发", gloss: "销售拓展新客户、促成签约" },
					{ word: "服务端开发", gloss: "编写运行在服务器上的程序与接口" },
				]),
				"accepted",
			);
			await runReview();
			const { rows } = await connection.query<{ n: string }>(
				"select count(*) as n from phrase_gloss where guide_identity = $1",
				[glossIdentity()],
			);
			assert.equal(Number(rows[0]?.n), 2);
		} finally {
			connection.release();
		}
	});

	test("自带模型判定时，释义组也问模型，用的是释义那份标准", async () => {
		process.env.REVIEW_JUDGE = "model";
		const systems: string[] = [];
		const restore = answerChat((system, prompt) => {
			systems.push(system);
			return {
				judgments: prompt
					.split("\n")
					.map((line) => line.replace(/（\d+ 人）$/, ""))
					.map((word) => ({ word, gloss: `${word}这个岗位或活的说明` })),
			};
		});
		try {
			const said = await runReview();
			assert.match(said.join("\n"), /写 1 组释义/);
			assert.match(said.join("\n"), /写下 3 条释义/);
		} finally {
			restore();
			process.env.REVIEW_JUDGE = "external";
		}
		assert.ok(systems.includes(GLOSS_GUIDE));
		assert.equal((await glosses()).length, 5);
	});
});
