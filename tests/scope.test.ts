/**
 * 数据范围：一个账号看得到的人，是此刻所在部门落在它某个组织下的人。名单、试跑、人数、候选词、
 * 标签、详情、数据页、导出、查询理解的工具和读经历，每一处都只有范围里的人；范围外的人和不存在
 * 的人一样。没有声明替谁读的读取一个人都读不到。人和账号都是合成的。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Query, QueryCondition } from "#/search/query";
import { account, ORG, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { execute, probe } = await import("#/search/execute");
const { findPhrases, suggest } = await import("#/search/search");
const { discover } = await import("#/server/discover");
const { listTerms } = await import("#/server/terms");
const { allVisible, employeeData, employeeDetail, listEmployees } =
	await import("#/server/data");
const { segmentTexts } = await import("#/server/judged");
const { createTurn } = await import("#/server/turn");
const { emptySpec } = await import("#/search/spec");
const { catalogSchema } = await import("#/db/catalog-schema");
const { db } = await import("#/db");
const { sql } = await import("drizzle-orm");

const RIDE = `${ORG}>出行事业部`;
let ride: string;
let none: string;
/** 出行那个账号的一次找人任务 */
let chain: string;

before(async () => {
	await seed([
		{
			personId: "R1",
			name: "合成出行甲",
			org: `${RIDE}>运营部`,
			segments: [
				{
					months: 24,
					title: "调度运营",
					seqL1: "运营",
					seqL2: "调度",
					extracted: { skills: ["运力调度"] },
				},
			],
		},
		{
			personId: "F1",
			name: "合成金融乙",
			org: `${ORG}>金融事业部`,
			segments: [
				{
					months: 36,
					title: "风控建模",
					seqL1: "技术",
					seqL2: "算法",
					extracted: { skills: ["运力调度", "风控模型"] },
				},
			],
		},
		{ personId: "N1", name: "合成无部门丙", org: "", segments: [] },
	]);
	const { deriveStandard } = await import("#/corpus/derive-standard");
	const { pool } = await import("#/db");
	const { version } = await deriveStandard(pool);
	await pool.query("update experience set derived_identity=$1", [version]);
	ride = await account("hr.ride", [RIDE]);
	none = await account("hr.none", []);
	chain = (await createTurn(ride, { kind: "spec", spec: emptySpec() })).turnId;
});

const query = (...conditions: QueryCondition[]): Query => ({ conditions });
const dispatch: QueryCondition = {
	id: "w",
	label: "运力调度",
	mode: "must",
	from: "experience",
	seek: { patterns: ["运力调度"] },
	where: "true",
};
const everyone: QueryCondition = {
	id: "p",
	label: "任何人",
	mode: "must",
	from: "person",
	where: "true",
};
const ids = (list: { employee: { personId: string } }[]) =>
	list.map((r) => r.employee.personId).sort();

describe("名单和试跑只有范围里的人", () => {
	test("同一份条件，替出行的任务找只有出行的人；不属于任何任务的读全部", async () => {
		assert.deepEqual(ids((await execute(query(dispatch), chain)).results), [
			"R1",
		]);
		assert.deepEqual(ids((await execute(query(dispatch), null)).results), [
			"F1",
			"R1",
		]);
	});

	test("人的条件、试跑的人数都只数范围里的人；没有部门的人不在任何账号的范围里", async () => {
		assert.equal((await execute(query(everyone), chain)).total, 1);
		assert.equal((await execute(query(everyone), null)).total, 3);
		assert.equal(
			(await probe(query(dispatch), chain)).conditions[0]?.people,
			1,
		);
	});

	test("找人任务不存在时一个人都没有", async () => {
		assert.equal((await execute(query(everyone), "no-such-turn")).total, 0);
	});
});

describe("详情、数据页和导出", () => {
	test("范围外的人的详情和不存在的人一样是 null", async () => {
		const scope = { account: ride };
		assert.equal((await employeeDetail(scope, "R1"))?.employee.personId, "R1");
		assert.equal(await employeeDetail(scope, "F1"), null);
		assert.equal((await employeeData(scope, "R1"))?.employee.personId, "R1");
		assert.equal(await employeeData(scope, "F1"), null);
	});

	test("数据页只列范围里的人；没有数据范围的账号一个人都看不到", async () => {
		const rows = async (id: string) =>
			(await listEmployees({ account: id }, "", 1)).rows.map((r) => r.personId);
		assert.deepEqual(await rows(ride), ["R1"]);
		assert.deepEqual(await rows(none), []);
	});

	test("其他部门有不同的序列时，账号看到的解析进度仍按全库标准计算", async () => {
		const scope = { account: ride };
		const list = await listEmployees(scope, "", 1);
		assert.deepEqual(
			list.rows.map((r) => [r.personId, r.pending]),
			[["R1", 0]],
		);
		assert.equal((await employeeData(scope, "R1"))?.segments[0]?.derived, true);
	});

	test("导出的名单里有范围外的工号就不收", async () => {
		assert.equal(await allVisible({ account: ride }, ["R1"]), true);
		assert.equal(await allVisible({ account: ride }, ["R1", "F1"]), false);
	});
});

describe("人数、候选词和标签", () => {
	test("关键词候选只给范围里有人写的说法", async () => {
		assert.deepEqual(await suggest({ account: ride }, "what", "风控"), []);
		assert.deepEqual(
			(await suggest("all", "what", "风控")).map((s) => s.value),
			["风控模型"],
		);
	});

	test("标签页只列范围里有人写的词，人数只数范围里的人", async () => {
		const terms = (await listTerms({ account: ride }, "", 1, false)).rows;
		assert.equal(terms.find((t) => t.canonical === "运力调度")?.people, 1);
		assert.equal(
			terms.some((t) => t.canonical === "风控模型"),
			false,
		);
	});
});

describe("查询理解的工具和读经历", () => {
	test("捞说法、看目录按发起任务的账号数人", async () => {
		const [found] = await findPhrases({ chain }, ["运力调度"]);
		assert.equal(found && "people" in found ? found.people : null, 1);
		const overview = await discover({ chain }, {});
		assert.equal(overview.kind, "overview");
		if (overview.kind !== "overview") return;
		assert.equal(overview.relations.find((r) => r.name === "person")?.rows, 1);
	});

	test("读经历拿不到范围外的段", async () => {
		const { rows } = await db.execute<{ id: number; person_id: string }>(
			sql`select id, person_id from experience`,
		);
		const texts = await segmentTexts(
			chain,
			rows.map((r) => r.id),
		);
		assert.deepEqual(
			[...texts.keys()],
			rows.filter((r) => r.person_id === "R1").map((r) => r.id),
		);
	});
});

describe("没有声明替谁读", () => {
	test("数据目录一个人都读不到", async () => {
		const { rows } = await db.execute<{ n: number }>(
			sql`select count(*)::int as n from ${sql.identifier(catalogSchema())}.person`,
		);
		assert.equal(rows[0]?.n, 0);
	});
});

describe("范围跟着人现在在哪", () => {
	test("调进出行的人，下一次读取就在出行的范围里", async () => {
		await db.execute(
			sql`update employment set cur_dept_path = ${`${RIDE}>风控部`} where person_id = 'F1'`,
		);
		assert.deepEqual(ids((await execute(query(dispatch), chain)).results), [
			"F1",
			"R1",
		]);
	});
});
