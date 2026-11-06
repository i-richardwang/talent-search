/**
 * 两条原型（设计稿 §10）按手写的查询跑执行外壳：条件是固定 FROM + 写好的 WHERE + 绑定参数，
 * 名单、证据、累计时长和名次都只从合格证据来。跑在临时 schema 上的真 SQL，数据全是合成的；
 * 记录的日期按数据库的今天往回推，用例不随日子过去而失效。
 *
 * 同一期的修订只留最终一条是同步的事（`tests/pipeline.test.ts`），这里的记录已经是最终的。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Query, QueryCondition } from "#/search/query";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { execute, probe } = await import("#/search/execute");
const { conditionCounts } = await import("#/search/search");
const { db, pool } = await import("#/db");
const { recordStream, scale, employeeRecord } = await import("#/db/schema");

const query = (...conditions: QueryCondition[]): Query => ({ conditions });
const ids = (list: { employee: { empId: string } }[]) =>
	list.map((r) => r.employee.empId);

/** 例四的写法：近三年至少几次某档及以上。 */
const highTwice: QueryCondition = {
	id: "high",
	label: "近三年绩效至少两次 A 及以上",
	mode: "must",
	from: "person",
	where:
		"(select count(*) from rating r where r.emp_id = p.emp_id and r.stream = 'perf' and r.period_end >= current_date - interval '3 years' and r.value_rank >= (select s.rank from scale s where s.stream = 'perf' and s.value = :band)) >= :times",
	params: { band: "A", times: 2 },
};

const twoInARow: QueryCondition = {
	id: "row",
	label: "连续两期绩效 A 及以上",
	mode: "must",
	from: "person",
	where:
		"exists (select 1 from rating a join rating b on b.emp_id = a.emp_id and b.stream = a.stream and b.period_start = a.period_end + 1 where a.emp_id = p.emp_id and a.stream = 'perf' and a.value_rank >= (select s.rank from scale s where s.stream = 'perf' and s.value = :band) and b.value_rank >= (select s.rank from scale s where s.stream = 'perf' and s.value = :band))",
	params: { band: "A" },
};

const neverC: QueryCondition = {
	id: "never",
	label: "有绩效记录，从没拿过 C",
	mode: "must",
	from: "person",
	where:
		"exists (select 1 from rating r where r.emp_id = p.emp_id and r.stream = 'perf') and not exists (select 1 from rating r where r.emp_id = p.emp_id and r.stream = 'perf' and r.value = :low)",
	params: { low: "C" },
};

/** 例三的写法：只算在甲辰科技的那段推荐系统。 */
const atJiachen: QueryCondition = {
	id: "rec",
	label: "在甲辰科技做推荐系统的那段经历",
	mode: "must",
	from: "experience",
	terms: { rec: ["推荐系统"] },
	where: "e.kind = 'external' and e.company ilike :c",
	params: { c: "%甲辰科技%" },
};

const noIntern: QueryCondition = {
	id: "intern",
	label: "实习经历不算",
	mode: "exclude",
	from: "experience",
	where: "e.title ilike :t",
	params: { t: "%实习%" },
};

before(async () => {
	const { rows } = await pool.query<{ today: string }>(
		"select current_date::text as today",
	);
	const today = new Date(`${rows[0]?.today}T00:00:00Z`);
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	/** 往前第 k 个已经结束的半年（k = 1 是最近的一个）。 */
	const half = (k: number) => {
		const at =
			today.getUTCFullYear() * 2 + (today.getUTCMonth() < 6 ? 0 : 1) - k;
		const year = Math.floor(at / 2);
		return at % 2 === 0
			? { periodStart: `${year}-01-01`, periodEnd: `${year}-06-30` }
			: { periodStart: `${year}-07-01`, periodEnd: `${year}-12-31` };
	};
	/** 近三年六期，按 k = 1..6 给档。 */
	const sixHalves = (empId: string, values: string[]) =>
		values.map((value, i) => ({
			empId,
			stream: "perf",
			value,
			...half(i + 1),
		}));
	const threeYearsAndADayAgo = new Date(today);
	threeYearsAndADayAgo.setUTCFullYear(today.getUTCFullYear() - 3);
	threeYearsAndADayAgo.setUTCDate(threeYearsAndADayAgo.getUTCDate() - 1);
	const outside = new Date(threeYearsAndADayAgo);
	outside.setUTCMonth(outside.getUTCMonth() - 6);

	const external = (company: string, months: number, more = {}) => ({
		kind: "external" as const,
		months,
		company,
		title: "算法工程师",
		extracted: { skills: ["推荐系统"] },
		...more,
	});
	await seed([
		...["R1", "R2", "R3", "R4", "R5", "R6"].map((empId) => ({
			empId,
			name: `合成${empId}`,
			segments: [],
		})),
		{
			empId: "E1",
			name: "合成E1",
			education: "硕士",
			segments: [
				external("甲辰科技", 12, { endDate: "2022-12-31" }),
				external("乙未网络", 96),
			],
		},
		{
			empId: "E2",
			name: "合成E2",
			education: "硕士",
			segments: [external("甲辰科技", 36)],
		},
		{
			empId: "E3",
			name: "合成E3",
			education: "硕士",
			segments: [external("乙未网络", 60)],
		},
		{
			empId: "E4",
			name: "合成E4",
			education: "硕士",
			segments: [external("甲辰科技", 6, { title: "推荐系统实习生" })],
		},
	]);
	await db
		.insert(recordStream)
		.values({ stream: "perf", kind: "rating", label: "绩效", period: "半年" });
	await db.insert(scale).values(
		["C", "B", "B+", "A", "A+"].map((value, rank) => ({
			stream: "perf",
			value,
			rank,
		})),
	);
	await db.insert(employeeRecord).values([
		...sixHalves("R1", ["A", "B", "A", "B", "B", "B"]),
		...sixHalves("R2", ["B", "A", "B", "B", "B", "B"]),
		{
			empId: "R2",
			stream: "perf",
			value: "A",
			periodStart: iso(outside),
			periodEnd: iso(threeYearsAndADayAgo),
		},
		...sixHalves("R3", ["B", "B", "B", "B", "B", "B"]),
		...sixHalves("R4", ["A", "A"]),
		...sixHalves("R6", ["A", "A", "C"]),
	]);
});

describe("原型一：三年内两次高绩效", () => {
	test("缺的期不算低也不算高；边界外的一次不算；没有记录的人不满足", async () => {
		const outcome = await execute(query(highTwice));
		assert.deepEqual(ids(outcome.results).sort(), ["R1", "R4", "R6"]);
		assert.equal(outcome.total, 3);
		const tried = await probe(query(highTwice));
		assert.deepEqual(tried.conditions, [
			{ id: "high", people: 3, problem: null },
		]);
		assert.equal(tried.total, 3);
	});

	test("连续两期：两期首尾相接", async () => {
		const outcome = await execute(query(twoInARow));
		assert.deepEqual(ids(outcome.results).sort(), ["R4", "R6"]);
	});

	test("从没拿过 C：没有任何记录的人不因此满足", async () => {
		const outcome = await execute(query(neverC));
		assert.deepEqual(ids(outcome.results).sort(), ["R1", "R2", "R3", "R4"]);
	});

	test("记录只是门槛：和经历主张一起时只定去留，证据和累计时长仍只来自那段经历", async () => {
		const records = ["2025-01-01", "2025-07-01"].map((periodStart) => ({
			empId: "E1",
			stream: "perf",
			value: "A+",
			periodStart,
			periodEnd: periodStart
				.replace(/01-01$/, "06-30")
				.replace(/07-01$/, "12-31"),
		}));
		await db.insert(employeeRecord).values(records);
		try {
			const outcome = await execute(query(atJiachen, highTwice));
			assert.equal(outcome.order, "evidence");
			if (outcome.order !== "evidence") return;
			assert.deepEqual(ids(outcome.results), ["E1"], "E2 没有绩效记录");
			const [e1] = outcome.results;
			assert.deepEqual(
				[...new Set(e1?.hits.map((h) => h.company))],
				["甲辰科技"],
				"记录不产出证据行",
			);
			assert.equal(e1?.basis[0]?.months, 12);
			assert.equal(e1?.basis.length, 1, "只有经历主张有依据");
		} finally {
			await pool.query("delete from employee_record where emp_id = 'E1'");
		}
	});
});

describe("原型二：限定公司内的语义经历", () => {
	test("名单、证据、累计时长、名次都只用甲辰那段；唯一证据被排除否决的人不在", async () => {
		const outcome = await execute(query(atJiachen, noIntern));
		assert.equal(outcome.order, "evidence");
		if (outcome.order !== "evidence") return;
		assert.deepEqual(ids(outcome.results), ["E2", "E1"], "E2 在 E1 前");
		const [e2, e1] = outcome.results;
		for (const r of outcome.results)
			for (const hit of r.hits)
				assert.equal(hit.company, "甲辰科技", `${r.employee.empId} 的证据`);
		assert.equal(e1?.basis[0]?.months, 12, "乙未那 96 个月不算");
		assert.equal(e2?.basis[0]?.months, 36);
		assert.equal(outcome.total, 2);
		const education = outcome.facets.education.reduce((n, f) => n + f.n, 0);
		assert.equal(education, outcome.total, "分面人数与总数一致");
	});

	test("试跑的人数和执行一致：排除数的是它否决了多少人的段", async () => {
		const tried = await probe(query(atJiachen, noIntern));
		assert.deepEqual(tried.conditions, [
			{ id: "rec", people: 2, problem: null },
			{ id: "intern", people: 1, problem: null },
		]);
		assert.equal(tried.total, 2);
	});

	test("chip 上的人数就是试跑的每条人数，按条件 id；停用的没有", async () => {
		assert.deepEqual(
			await conditionCounts({
				query: {
					conditions: [atJiachen, noIntern, { ...highTwice, off: "user" }],
				},
			}),
			{ rec: 2, intern: 1 },
		);
	});

	test("不写排除时实习那段是合格证据", async () => {
		const outcome = await execute(query(atJiachen));
		assert.deepEqual(ids(outcome.results).sort(), ["E1", "E2", "E4"]);
	});
});
