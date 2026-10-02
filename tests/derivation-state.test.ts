/** 派生完成状态与整份语料的判定标准，用真实事务和合成端点验证。 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import {
	answerChat,
	answerEmbedding,
	fakeEmbedding,
	seed,
	setup,
} from "./fixture";

const teardown = await setup();
after(teardown);
const { db, pool } = await import("#/db");
const { derive } = await import("#/corpus/derive");
const { search } = await import("#/search/search");
const { employeeDetail } = await import("#/server/data");

beforeEach(async () => {
	await db.execute(
		sql`truncate employee, phrase, phrase_gloss restart identity cascade`,
	);
});

async function runDerive(budgetMs = 10_000) {
	const client = await pool.connect();
	const session = { client, release: async () => client.release() };
	try {
		return await derive(session, () => {}, budgetMs);
	} finally {
		await session.release();
	}
}

function segment(description: string) {
	return {
		kind: "external" as const,
		title: "数据分析师",
		description,
		months: 12,
	};
}

async function identities() {
	return (
		await db.execute<{ derived_identity: string | null }>(sql`
		select derived_identity from experience order by id`)
	).rows.map((r) => r.derived_identity);
}

function find() {
	return search({
		conditions: [{ about: "experience", mode: "must", what: ["数据分析师"] }],
	});
}

test("抽取失败保留待派生与旧边，下一轮成功的空抽取才算已读", async () => {
	await seed([
		{ empId: "E1", name: "合成抽取", segments: [segment("失败恢复样例")] },
	]);
	const original = await db.execute(
		sql`select * from experience_phrase order by route, phrase_id`,
	);
	let restore = answerChat(() => ({ skills: "invalid", did: [] }));
	try {
		assert.deepEqual(await runDerive(), { done: 0, left: 1 });
	} finally {
		restore();
	}
	assert.deepEqual(await identities(), [null]);
	assert.deepEqual(
		(
			await db.execute(
				sql`select * from experience_phrase order by route, phrase_id`,
			)
		).rows,
		original.rows,
	);
	restore = answerChat(() => ({ skills: [], did: [] }));
	try {
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
	} finally {
		restore();
	}
	assert.ok((await identities())[0]);
	assert.equal(
		(
			await db.execute(
				sql`select * from experience_phrase where route = 'description'`,
			)
		).rows.length,
		0,
		"成功的空抽取不退回原文",
	);
});

test("对齐失败不记录完成版本，合法的无法对齐可以完成", async () => {
	await seed([
		{
			empId: "E1",
			name: "合成对齐",
			segments: [
				{
					kind: "internal",
					title: "工程师",
					seqL1: "技术",
					seqL2: "算法",
					months: 12,
				},
				segment("对齐失败恢复样例"),
			],
		},
	]);
	let restore = answerChat((system) =>
		system.includes("两类短说法")
			? { skills: [], did: [] }
			: { l1: 9, l2: "算法" },
	);
	try {
		assert.deepEqual(await runDerive(), { done: 1, left: 1 });
	} finally {
		restore();
	}
	assert.ok((await identities())[0]);
	assert.equal((await identities())[1], null);
	restore = answerChat(() => ({ l1: "", l2: "" }));
	try {
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
	} finally {
		restore();
	}
	assert.ok((await identities()).every(Boolean));
});

test("失败批次不阻塞本轮后面的段，失败段下一轮重试", async () => {
	await seed(
		Array.from({ length: 201 }, (_, i) => ({
			empId: `E${i}`,
			name: `合成样例${i}`,
			segments: [segment(i < 200 ? "本轮失败样例" : "本轮成功样例")],
		})),
	);
	const restore = answerChat((_system, prompt) =>
		prompt.includes("本轮失败样例") ? { bad: true } : { skills: [], did: [] },
	);
	try {
		assert.deepEqual(await runDerive(), { done: 1, left: 200 });
	} finally {
		restore();
	}
	const versions = await identities();
	assert.ok(versions.slice(0, 200).every((version) => version === null));
	assert.ok(versions[200]);
});

test("标准更新分批提交时拒绝混排名单，全部统一后恢复", async () => {
	await seed(
		Array.from({ length: 201 }, (_, i) => ({
			empId: `E${i}`,
			name: `合成标准${i}`,
			segments: [segment("统一标准样例")],
		})),
	);
	await db.execute(
		sql`update experience set derived_identity = 'old-standard'`,
	);
	const restore = answerChat(async () => {
		await new Promise((resolve) => setTimeout(resolve, 1_200));
		return { skills: [], did: [] };
	});
	try {
		assert.deepEqual(await runDerive(1_000), { done: 200, left: 1 });
		await assert.rejects(find(), /人才库正在更新判定标准/);
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
		assert.equal((await find()).total, 201);
	} finally {
		restore();
	}
});

test("当前说法的释义依据不同标准时拒绝检索，无读者的保留释义不影响检索", async () => {
	await seed([
		{
			empId: "E1",
			name: "合成释义",
			segments: [
				{ ...segment("释义标准样例"), extracted: { skills: ["数据分析"] } },
			],
		},
	]);
	await db.execute(sql`insert into phrase_gloss (text, gloss, guide_identity) values
		('数据分析师', '数据分析岗位', 'guide-a'), ('数据分析', '分析项目', 'guide-b')`);
	await assert.rejects(find(), /人才库正在更新判定标准/);
	await db.execute(
		sql`update phrase_gloss set guide_identity = 'guide-b' where text = '数据分析师'`,
	);
	await db.execute(
		sql`insert into phrase_gloss (text, gloss, guide_identity) values ('无读者的历史词', '保留释义', 'guide-a')`,
	);
	await find();
});

test("派生每轮核验现有空间的 fresh canary，漂移不写入完成状态", async () => {
	await seed([
		{
			empId: "E1",
			name: "合成漂移",
			segments: [{ title: "工程师", months: 12 }],
		},
	]);
	const restore = answerEmbedding((text) =>
		Array.from({ length: fakeEmbedding(text).length }, (_, i) =>
			i === 1023 ? 1 : 0,
		),
	);
	try {
		await assert.rejects(runDerive(), /canary 不一致/);
	} finally {
		restore();
	}
	assert.deepEqual(await identities(), [null]);
	assert.deepEqual(await runDerive(), { done: 1, left: 0 });
});

test("详情仅返回展示字段，记录身份与排序工作值留在服务端", async () => {
	await seed([
		{
			empId: "E1",
			name: "合成详情",
			curLevel: "P6",
			segments: [segment("详情边界样例")],
		},
	]);
	const detail = await employeeDetail("E1");
	assert.ok(detail);
	assert.equal(detail.employee.curLevel, "P6");
	assert.equal(detail.timeline[0]?.description, "详情边界样例");
	for (const field of ["curLevelRank", "curLevelBand", "educationRank"])
		assert.ok(!(field in detail.employee));
	for (const field of ["empId", "contentKey", "derivedIdentity", "unemployed"])
		assert.ok(!(field in (detail.timeline[0] ?? {})));
	assert.equal(await employeeDetail("missing"), null);
});
