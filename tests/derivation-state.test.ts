/** 解析完成状态与整份语料的判定标准，用真实事务和合成端点验证。 */
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

async function unanswered() {
	return (
		await db.execute<{ unanswered: boolean }>(sql`
		select unanswered from experience order by id`)
	).rows.map((r) => r.unanswered);
}

async function routes(empId: string) {
	return (
		await db.execute<{ route: string }>(sql`
		select distinct ep.route from experience_phrase ep
		join experience e on e.id = ep.experience_id
		where e.emp_id = ${empId} order by ep.route`)
	).rows.map((r) => r.route);
}

test("抽取答不出记为未能作答、按原文检索，成功的空抽取不退回原文", async () => {
	await seed([
		{ empId: "E1", name: "合成抽取", segments: [segment("答不出样例")] },
		{ empId: "E2", name: "合成抽取", segments: [segment("空抽取样例")] },
	]);
	const restore = answerChat((_system, prompt) =>
		prompt.includes("答不出样例")
			? { skills: "invalid", did: [] }
			: { skills: [], did: [] },
	);
	try {
		assert.deepEqual(await runDerive(), { done: 2, left: 0 });
	} finally {
		restore();
	}
	assert.ok((await identities()).every(Boolean));
	assert.deepEqual(await unanswered(), [true, false]);
	assert.ok((await routes("E1")).includes("description"));
	assert.ok(!(await routes("E2")).includes("description"));
});

for (const [label, invalid] of [
	["回答形状无效", { seq: 9 }],
	["序列不在树上", { seq: "推荐（技术）" }],
	["序列只有一级", { seq: "技术" }],
] as const) {
	test(`对齐${label}记为未能作答，不推断序列，抽取结果照旧写入`, async () => {
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
					segment(`${label}样例`),
				],
			},
		]);
		const restore = answerChat((system) =>
			system.includes("两类短说法")
				? { skills: ["数据分析"], did: [] }
				: invalid,
		);
		try {
			assert.deepEqual(await runDerive(), { done: 2, left: 0 });
		} finally {
			restore();
		}
		assert.ok((await identities()).every(Boolean));
		assert.deepEqual(await unanswered(), [false, true]);
		const { rows } = await db.execute<{ l1: string; l2: string }>(sql`
			select seq_inferred_l1 as l1, seq_inferred_l2 as l2
			from experience where kind = 'external'`);
		assert.deepEqual(rows, [{ l1: "", l2: "" }]);
		assert.ok((await routes("E1")).includes("skill"));
	});
}

test("答不出的段标准不变不再问，标准变了重新问", async () => {
	await seed([
		{ empId: "E1", name: "合成重问", segments: [segment("一直答不出样例")] },
	]);
	let asked = 0;
	let restore = answerChat(() => {
		asked++;
		return { bad: true };
	});
	try {
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
		assert.deepEqual(await runDerive(), { done: 0, left: 0 });
	} finally {
		restore();
	}
	assert.equal(asked, 1);
	await db.execute(
		sql`update experience set derived_identity = 'old-standard'`,
	);
	restore = answerChat(() => {
		asked++;
		return { skills: [], did: [] };
	});
	try {
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
	} finally {
		restore();
	}
	assert.equal(asked, 2);
	assert.deepEqual(await unanswered(), [false]);
});

async function staged() {
	return (
		await db.execute<{ n: number }>(
			sql`select count(*)::int as n from experience_next`,
		)
	).rows[0]?.n;
}

test("标准更新期间检索读上一版，每一段都有新结果后一次替换正式表", async () => {
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
		assert.equal(await staged(), 200);
		assert.ok((await identities()).every((v) => v === "old-standard"));
		assert.equal((await find()).total, 201);
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
	} finally {
		restore();
	}
	assert.equal(await staged(), 0);
	const versions = await identities();
	assert.ok(versions[0] && versions[0] !== "old-standard");
	assert.ok(versions.every((v) => v === versions[0]));
	assert.equal((await find()).total, 201);
});

test("暂存结果替换进去时，答不出的段带着未能作答进去，仍按原文留在检索里", async () => {
	await seed([
		{ empId: "E1", name: "合成替换", segments: [segment("替换成功样例")] },
		{ empId: "E2", name: "合成替换", segments: [segment("替换失败样例")] },
	]);
	await db.execute(
		sql`update experience set derived_identity = 'old-standard'`,
	);
	const restore = answerChat((_system, prompt) =>
		prompt.includes("替换失败样例") ? { bad: true } : { skills: [], did: [] },
	);
	try {
		assert.deepEqual(await runDerive(), { done: 2, left: 0 });
	} finally {
		restore();
	}
	const versions = await identities();
	assert.ok(versions[0] && versions[0] !== "old-standard");
	assert.ok(versions.every((v) => v === versions[0]));
	assert.deepEqual(await unanswered(), [false, true]);
	assert.ok((await routes("E2")).includes("description"));
	assert.equal((await find()).total, 2);
});

test("正式表混着两版时替换进去，已是这一版的段保留自己的边", async () => {
	await seed([
		{ empId: "E1", name: "合成混合", segments: [segment("已是新版样例")] },
		{ empId: "E2", name: "合成混合", segments: [segment("仍是旧版样例")] },
	]);
	const restore = answerChat(() => ({ skills: [], did: [] }));
	try {
		assert.deepEqual(await runDerive(), { done: 2, left: 0 });
		await db.execute(
			sql`update experience set derived_identity = 'old-standard' where emp_id = 'E2'`,
		);
		assert.deepEqual(await runDerive(), { done: 1, left: 0 });
	} finally {
		restore();
	}
	const versions = await identities();
	assert.ok(versions[0] && versions.every((v) => v === versions[0]));
	assert.equal((await find()).total, 2);
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

test("解析每轮核验现有空间的 fresh canary，漂移不写入完成状态", async () => {
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
