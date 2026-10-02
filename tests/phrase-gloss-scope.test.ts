/** 释义适用范围在收集、计数、版本核验与召回之间一致，保留释义随当前边决定是否使用。 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { holdNextRerank, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { db, pool } = await import("#/db");
const { collectGlosses, glossCounts, glossIdentity, applyGlosses } =
	await import("#/corpus/gloss");
const { openGroups, submitJudgment } = await import("#/corpus/judgment");
const { search } = await import("#/search/search");
const word = "数据分析";
const find = () =>
	search({ conditions: [{ about: "experience", mode: "must", what: [word] }] });
beforeEach(async () => {
	await db.execute(
		sql`truncate employee, phrase, phrase_gloss, review_group restart identity cascade`,
	);
});

test("仅在原文和部门中出现的文本不用保留释义，不参与释义版本核验或收集", async () => {
	await seed([
		{
			empId: "G1",
			name: "合成原文",
			segments: [
				{ kind: "external", description: word, title: "工程师", months: 12 },
			],
		},
		{
			empId: "G2",
			name: "合成部门",
			segments: [{ org: word, title: "工程师", months: 12 }],
		},
	]);
	await db.execute(sql`insert into phrase_gloss (text, gloss, guide_identity) values
		(${word}, ${"厨房烹饪".repeat(10)}, 'old-guide'), ('工程师', '编写程序', ${glossIdentity()})`);
	const client = await pool.connect();
	try {
		await collectGlosses(client, () => {});
		assert.deepEqual(await glossCounts(client), { glossable: 1, glossed: 1 });
		assert.deepEqual(await openGroups(client, "gloss", glossIdentity()), []);
	} finally {
		client.release();
	}
	const result = await find();
	assert.deepEqual(result.results.map((row) => row.employee.empId).sort(), [
		"G1",
		"G2",
	]);
	assert.equal(
		(await db.execute(sql`select count(*)::int as n from phrase_gloss`)).rows[0]
			?.n,
		2,
	);
});

test("保留文本重新成为短说法时，旧标准被收集，生效后恢复统一标准的检索", async () => {
	await seed([
		{
			empId: "G1",
			name: "合成短说法",
			segments: [
				{ title: "工程师", months: 12 },
				{ title: word, months: 12 },
			],
		},
	]);
	await db.execute(sql`insert into phrase_gloss (text, gloss, guide_identity) values
		(${word}, '处理数据', 'old-guide'), ('工程师', '编写程序', ${glossIdentity()})`);
	await assert.rejects(find(), /人才库正在更新判定标准/);
	const client = await pool.connect();
	try {
		await collectGlosses(client, () => {});
		assert.deepEqual(await glossCounts(client), { glossable: 2, glossed: 1 });
		const group = (await openGroups(client, "gloss", glossIdentity()))[0];
		assert.ok(group);
		assert.deepEqual(
			group.words.map((row) => row.word),
			[word],
		);
		assert.equal(
			await submitJudgment(
				client,
				group.id,
				"gloss",
				glossIdentity(),
				"agent:synthetic",
				[{ word, gloss: "处理数据" }],
			),
			"accepted",
		);
		await applyGlosses(client, () => {});
		assert.deepEqual(await glossCounts(client), { glossable: 2, glossed: 2 });
	} finally {
		client.release();
	}
	assert.equal((await find()).total, 1);
});

test("模型调用期间说法失去短说法边时，重新按原文判定，不复用带释义的分数", async () => {
	await seed([
		{
			empId: "G1",
			name: "合成边变化",
			segments: [{ title: word, months: 12 }],
		},
	]);
	await db.execute(
		sql`insert into phrase_gloss (text, gloss, guide_identity) values (${word}, ${"厨房烹饪".repeat(10)}, ${glossIdentity()})`,
	);
	const gate = holdNextRerank();
	const pending = find();
	await gate.entered;
	try {
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`update experience set title = '', description = ${word}`,
			);
			await tx.execute(sql`update experience_phrase set route = 'description'`);
		});
	} finally {
		gate.release();
	}
	assert.equal((await pending).total, 1);
});
