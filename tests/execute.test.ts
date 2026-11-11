/**
 * 按期记录的门槛、限定公司的经历和写了判据的条件，按手写的查询跑执行外壳：条件是固定 FROM +
 * 写好的 WHERE + 绑定参数，名单、证据、累计时长和名次都只从合格证据来。写了判据的条件，一段
 * 经历算不算听存下的结论（`server/judged.ts`），这里直接存结论，不经过模型。跑在临时 schema
 * 上的真 SQL，数据全是合成的；记录的日期按数据库的今天往回推，用例不随日子过去而失效。
 *
 * 同一期的修订只留最终一条是同步的事（`tests/pipeline.test.ts`），这里的记录已经是最终的。
 */
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import type { Query, QueryCondition } from "#/search/query";
import type { SearchOutcome } from "#/search/result";
import {
	conclude,
	judged,
	openSearch,
	seed,
	seedStream,
	setup,
} from "./fixture";

const teardown = await setup();
after(teardown);

const { execute, probe, selection } = await import("#/search/execute");
const { db, pool } = await import("#/db");
const { employeeRecord } = await import("#/db/schema");

/** 每个用例是自己的一次找人任务：结论记在它名下，也只认它名下的。 */
let task: string;
beforeEach(async () => {
	task = await openSearch();
});

const query = (...conditions: QueryCondition[]): Query => ({ conditions });
const ids = (list: { employee: { empId: string } }[]) =>
	list.map((r) => r.employee.empId);
/** 有经历主张的名单：每个人带着证据。 */
const evidence = (outcome: SearchOutcome) => {
	if (outcome.order !== "evidence") throw new Error("该是按证据排的名单");
	return outcome;
};

/** 近三年至少几次某档及以上：数记录行，档高查档位表。 */
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

/**
 * 只算在甲辰科技的那段推荐系统：做过什么和公司写在同一条里，说的是同一段。没写判据，
 * 字面对得上的都算符合。
 */
const atJiachen: QueryCondition = {
	id: "rec",
	label: "在甲辰科技做推荐系统的那段经历",
	mode: "must",
	from: "experience",
	seek: { patterns: ["推荐系统"] },
	where: "e.kind = 'external' and e.company ilike :c",
	params: { c: "%甲辰科技%" },
};

/** 这个人不能有实习的段。 */
const noIntern: QueryCondition = {
	id: "intern",
	label: "做过实习",
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
		values.map((value, i) => ({ empId, value, ...half(i + 1) }));
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
	await seedStream({
		stream: "perf",
		kind: "rating",
		label: "绩效",
		period: "半年",
		scale: ["C", "B", "B+", "A", "A+"],
		records: [
			...sixHalves("R1", ["A", "B", "A", "B", "B", "B"]),
			...sixHalves("R2", ["B", "A", "B", "B", "B", "B"]),
			{
				empId: "R2",
				value: "A",
				periodStart: iso(outside),
				periodEnd: iso(threeYearsAndADayAgo),
			},
			...sixHalves("R3", ["B", "B", "B", "B", "B", "B"]),
			...sixHalves("R4", ["A", "A"]),
			...sixHalves("R6", ["A", "A", "C"]),
		],
	});
});

describe("按期记录的门槛：三年内两次高绩效", () => {
	test("缺的期不算低也不算高；边界外的一次不算；没有记录的人不满足", async () => {
		const outcome = await execute(query(highTwice), task);
		assert.deepEqual(ids(outcome.results).sort(), ["R1", "R4", "R6"]);
		assert.equal(outcome.total, 3);
		const tried = await probe(query(highTwice), task);
		assert.deepEqual(tried.conditions, [
			{ id: "high", people: 3, problem: null },
		]);
		assert.equal(tried.total, 3);
	});

	test("连续两期：两期首尾相接", async () => {
		const outcome = await execute(query(twoInARow), task);
		assert.deepEqual(ids(outcome.results).sort(), ["R4", "R6"]);
	});

	test("从没拿过 C：没有任何记录的人不因此满足", async () => {
		const outcome = await execute(query(neverC), task);
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
			const outcome = await execute(query(atJiachen, highTwice), task);
			assert.equal(outcome.order, "evidence");
			if (outcome.order !== "evidence") return;
			assert.deepEqual(ids(outcome.results), ["E1"], "E2 没有绩效记录");
			const [e1] = outcome.results;
			assert.deepEqual(
				[...new Set(e1?.evidence.map((e) => e.company))],
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

describe("限定公司的经历", () => {
	test("名单、证据、累计时长、名次都只用甲辰那段；有实习那一段的人被排除", async () => {
		const outcome = await execute(query(atJiachen, noIntern), task);
		assert.equal(outcome.order, "evidence");
		if (outcome.order !== "evidence") return;
		assert.deepEqual(ids(outcome.results), ["E2", "E1"], "E2 在 E1 前");
		const [e2, e1] = outcome.results;
		for (const r of outcome.results)
			for (const e of r.evidence)
				assert.equal(e.company, "甲辰科技", `${r.employee.empId} 的证据`);
		assert.equal(e1?.basis[0]?.months, 12, "乙未那 96 个月不算");
		assert.equal(e2?.basis[0]?.months, 36);
		assert.equal(outcome.total, 2);
		const education = outcome.facets.education.reduce((n, f) => n + f.n, 0);
		assert.equal(education, outcome.total, "分面人数与总数一致");
	});

	test("试跑每条单独数人，谁也不改别的条件读到的：排除数的是它最多会拦下的人", async () => {
		const tried = await probe(query(atJiachen, noIntern), task);
		assert.deepEqual(tried.conditions, [
			{ id: "rec", people: 3, problem: null },
			{ id: "intern", people: 1, problem: null },
		]);
		assert.equal(tried.total, 2);
		assert.deepEqual(tried.unconfirmed, [], "没写判据的条件没有要看的段");
	});

	test("只剩排除也出名单：它和门槛一样只定去留，人才库里没有这种经历的人都在", async () => {
		for (const conditions of [
			[noIntern],
			[{ ...atJiachen, off: "user" as const }, noIntern],
		]) {
			const outcome = await execute(query(...conditions), task);
			assert.equal(outcome.order, "employee");
			const listed = ids(outcome.results);
			assert.ok(listed.includes("E1") && listed.includes("R1"));
			assert.ok(!listed.includes("E4"), "E4 有一段实习");
			assert.equal(outcome.empty, null);
			const tried = await probe(query(...conditions), task);
			assert.deepEqual(
				tried.conditions.flatMap((c) => (c.people === null ? [] : [c])),
				[{ id: "intern", people: 1, problem: null }],
			);
			assert.equal(tried.total, outcome.total);
		}
	});

	test("排除说的是人：别的段再合格，有一段这样的经历就不在名单上", async () => {
		const anyRec: QueryCondition = {
			...atJiachen,
			id: "any",
			where: "true",
			params: undefined,
		};
		const atYiwei: QueryCondition = {
			id: "yiwei",
			label: "在乙未网络待过",
			mode: "exclude",
			from: "experience",
			where: "e.company ilike :c",
			params: { c: "%乙未网络%" },
		};
		const outcome = await execute(query(anyRec, atYiwei), task);
		assert.deepEqual(
			ids(outcome.results).sort(),
			["E2", "E4"],
			"E1 在甲辰那段合格，但他也在乙未待过",
		);
	});

	test("排除不改别的条件读到的数据：写成经历条件还是人的条件，名单一样", async () => {
		const atCompany: QueryCondition = {
			id: "jiachen",
			label: "待过甲辰科技",
			mode: "must",
			from: "experience",
			where: "e.company ilike :c",
			params: { c: "%甲辰科技%" },
		};
		const viaPerson: QueryCondition = {
			id: "jiachen",
			label: "待过甲辰科技",
			mode: "must",
			from: "person",
			where:
				"exists (select 1 from experience x where x.emp_id = p.emp_id and x.company ilike :c)",
			params: { c: "%甲辰科技%" },
		};
		const asSegment = await execute(query(atCompany, noIntern), task);
		const asPerson = await execute(query(viaPerson, noIntern), task);
		assert.deepEqual(ids(asSegment.results).sort(), ["E1", "E2"]);
		assert.deepEqual(ids(asPerson.results).sort(), ["E1", "E2"]);
		const tried = await probe(query(viaPerson, noIntern), task);
		assert.deepEqual(
			tried.conditions,
			[
				{ id: "jiachen", people: 3, problem: null },
				{ id: "intern", people: 1, problem: null },
			],
			"待过甲辰的三个人都数到：E4 的实习段照样读得到",
		);
	});

	test("排除跑不了：试跑把问题记在它自己身上，不数人；执行时整份不能执行", async () => {
		const broken: QueryCondition = {
			...noIntern,
			where: "e.title ilike :t and e.months > :t::int",
		};
		const tried = await probe(query(atJiachen, broken), task);
		assert.equal(tried.conditions[0]?.people, 3);
		assert.equal(tried.conditions[1]?.people, null);
		assert.match(tried.conditions[1]?.problem ?? "", /22P02/);
		assert.equal(tried.total, null);
		await assert.rejects(execute(query(atJiachen, broken), task));
	});

	test("不写排除时实习那段是合格证据", async () => {
		const outcome = await execute(query(atJiachen), task);
		assert.deepEqual(ids(outcome.results).sort(), ["E1", "E2", "E4"]);
	});
});

describe("写了判据的条件：一段经历算不算听确认过的结论", () => {
	/**
	 * 字面都捞「风控」：T1 到 T5 每个人都有对得上的段。职级从 T1 的 P8 一档一档降到 T4 的 P5，
	 * T5 没有职级。
	 */
	const risk = (criterion: string) => judged("风控", ["风控"], criterion);
	const listed = (outcome: SearchOutcome) => ids(outcome.results).sort();
	/** 试跑列出的没确认过的段：哪条条件、谁的、哪个岗位。 */
	const named = async (
		unconfirmed: { condition: QueryCondition; experienceId: number }[],
	) => {
		const { rows } = await pool.query<{
			id: number;
			emp_id: string;
			title: string;
		}>("select id, emp_id, title from experience where id = any($1::int[])", [
			unconfirmed.map((u) => u.experienceId),
		]);
		const byId = new Map(rows.map((row) => [row.id, row]));
		return unconfirmed.map((u) => {
			const row = byId.get(u.experienceId);
			return [u.condition.id, row?.emp_id, row?.title];
		});
	};

	before(async () => {
		const one = (
			empId: string,
			curLevel: string,
			title: string,
			more = {},
		) => ({
			empId,
			name: `合成${empId}`,
			curLevel,
			segments: [{ title, months: 36, ...more }],
		});
		await seed([
			one("T1", "P8", "风控策略专家"),
			one("T2", "P7", "风控运营"),
			one("T3", "P6", "风控系统销售"),
			// 没读过的段：整段原文是一条说法
			one("T4", "P5", "产品经理", { description: "负责过风控策略的项目" }),
			{
				empId: "T5",
				name: "合成T5",
				segments: [
					{ title: "风控策略负责人", months: 24 },
					{ title: "风控系统售前", months: 12 },
				],
			},
		]);
	});

	test("没确认过的段不算数：人不上名单，名单标成不完整；最高一档也没确认完时说不出覆盖到哪一档，名单空着时成因就是它", async () => {
		const outcome = evidence(
			await execute(query(risk("本人做风控策略")), task),
		);
		assert.deepEqual(outcome.results, []);
		assert.equal(outcome.total, 0);
		assert.deepEqual(outcome.incomplete, { above: null });
		assert.deepEqual(outcome.empty, { kind: "incomplete", above: null });
		assert.equal(
			outcome.facets.education.reduce((n, f) => n + f.n, 0),
			0,
			"分面也只数名单上的人",
		);
	});

	test("确认过的段按结论：算的是证据，不算的不是命中；一个人有的段确认过、有的没有，按确认过的算；名单完整覆盖到比没确认完的人都高的最低一档，都确认完就不带这一项", async () => {
		const criterion = "本人做风控策略或风控运营；卖风控系统的不算";
		await conclude(task, criterion, true, ["T1", "T2"]);
		await conclude(task, criterion, false, ["T3"]);
		await conclude(task, criterion, true, ["T5"], "风控策略负责人");
		const outcome = evidence(await execute(query(risk(criterion)), task));
		assert.deepEqual(
			listed(outcome),
			["T1", "T2", "T5"],
			"T4 那段原文还没确认，不在名单上",
		);
		assert.equal(outcome.total, 3);
		assert.deepEqual(
			outcome.incomplete,
			{ above: "P7" },
			"没确认完的是 P5 的 T4 和没有职级的 T5，比他们高的候选人里最低是 P7 的 T2",
		);
		assert.equal(outcome.empty, null);
		const hitsOfT5 = (o: typeof outcome) =>
			o.results
				.find((r) => r.employee.empId === "T5")
				?.evidence.map((e) => e.title);
		assert.deepEqual(
			hitsOfT5(outcome),
			["风控策略负责人"],
			"没确认过的那一段不是证据",
		);
		const firstPage = await execute(query(risk(criterion)), task, {}, 1);
		assert.equal(firstPage.results.length, 1);
		assert.deepEqual(
			firstPage.incomplete,
			{ above: "P7" },
			"看的是全部候选人，不是这一页",
		);

		await conclude(task, criterion, false, ["T5"], "风控系统售前");
		await conclude(task, criterion, true, ["T4"]);
		const read = evidence(await execute(query(risk(criterion)), task));
		assert.deepEqual(listed(read), ["T1", "T2", "T4", "T5"]);
		assert.equal(read.total, 4);
		assert.equal("incomplete" in read, false, "都确认过了，不带这一项");
		assert.deepEqual(
			hitsOfT5(read),
			["风控策略负责人"],
			"判成不算的那一段不是证据",
		);
		const t5 = read.results.find((r) => r.employee.empId === "T5");
		assert.equal(t5?.basis[0]?.months, 24, "累计时长也不算它");
	});

	test("结论跟着判据的文字，不跟着条件别的写法：换了正则和 where 照用，换一条判据就按没确认过算", async () => {
		const criterion = "本人做风控策略";
		await conclude(task, criterion, true, ["T1"]);
		await conclude(task, criterion, false, ["T2", "T3", "T4", "T5"]);
		const rewritten = judged("策略", ["风控策略", "风控运营"], criterion, {
			where: "e.months >= :m",
			params: { m: 12 },
		});
		assert.deepEqual(listed(await execute(query(rewritten), task)), ["T1"]);
		const other = await execute(query(risk("本人做过风控策略")), task);
		assert.equal(other.total, 0);
		assert.deepEqual(other.incomplete, { above: null });
	});

	test("结论只在产生它的那次找人任务里算数：别的任务、不属于任何任务的查询，同一条判据按没确认过算", async () => {
		const criterion = "本人做风控策略";
		await conclude(task, criterion, true, ["T1"]);
		await conclude(task, criterion, false, ["T2", "T3", "T4", "T5"]);
		assert.deepEqual(listed(await execute(query(risk(criterion)), task)), [
			"T1",
		]);
		for (const elsewhere of [await openSearch(), null]) {
			const outcome = await execute(query(risk(criterion)), elsewhere);
			assert.equal(outcome.total, 0);
			assert.deepEqual(outcome.incomplete, { above: null });
		}
	});

	test("先存下的结论算数：同一段再交一个不同的结论不改", async () => {
		const criterion = "本人做风控策略";
		await conclude(task, criterion, true, ["T1"]);
		await conclude(task, criterion, false, ["T1"]);
		await conclude(task, criterion, false, ["T2", "T3", "T4", "T5"]);
		assert.deepEqual(listed(await execute(query(risk(criterion)), task)), [
			"T1",
		]);
	});

	test("段的内容或解析结果变了，确认过的结论对不上：按没确认过算；变回去又对得上", async () => {
		const criterion = "本人做风控策略";
		await conclude(task, criterion, true, ["T1"]);
		await conclude(task, criterion, false, ["T2", "T3", "T4", "T5"]);
		const seen = async () => {
			const outcome = await execute(query(risk(criterion)), task);
			return [listed(outcome), outcome.incomplete];
		};
		const read = [["T1"], undefined];
		const unread = [[], { above: null }];
		assert.deepEqual(await seen(), read);
		try {
			await pool.query(
				"update experience set description = '后来补的一句' where emp_id = 'T1'",
			);
			assert.deepEqual(await seen(), unread, "内容变了");
			await pool.query(
				"update experience set description = '' where emp_id = 'T1'",
			);
			assert.deepEqual(await seen(), read);
			await pool.query(
				"update experience set derived_identity = '新一版' where emp_id = 'T1'",
			);
			assert.deepEqual(await seen(), unread, "解析结果换了一版");
		} finally {
			await pool.query(
				"update experience set description = '', derived_identity = null where emp_id = 'T1'",
			);
		}
	});

	test("排除按人、按确认过的结论：有一段确认过算的人出局，还有段没确认的人是候选、不上名单，都确认过不算的人在名单上", async () => {
		const criterion = "本人做风控策略";
		const anyone: QueryCondition = {
			id: "岗位",
			label: "风控或产品岗位",
			mode: "must",
			from: "experience",
			seek: { patterns: ["风控", "产品经理"] },
			where: "true",
		};
		const noRisk = judged("做过风控策略", ["风控"], criterion, {
			mode: "exclude",
		});
		const before = await execute(query(anyone, noRisk), task);
		assert.deepEqual(listed(before), [], "该不该排除都还不知道");
		assert.deepEqual(before.incomplete, { above: null });
		assert.equal((await probe(query(anyone, noRisk), task)).candidates, 5);

		await conclude(task, criterion, true, ["T1"]);
		await conclude(task, criterion, false, ["T2", "T3"]);
		const outcome = await execute(query(anyone, noRisk), task);
		assert.deepEqual(listed(outcome), ["T2", "T3"], "T1 做过，出局");
		assert.deepEqual(
			outcome.incomplete,
			{ above: "P6" },
			"T4、T5 的段还没确认；T2、T3 确认完了",
		);
		const tried = await probe(query(anyone, noRisk), task);
		assert.equal(tried.candidates, 4, "T1 不再是候选");
		assert.deepEqual(await named(tried.unconfirmed), [
			["做过风控策略", "T4", "产品经理"],
			["做过风控策略", "T5", "风控策略负责人"],
			["做过风控策略", "T5", "风控系统售前"],
		]);

		await conclude(task, criterion, true, ["T5"], "风控策略负责人");
		await conclude(task, criterion, false, ["T4"]);
		const done = await execute(query(anyone, noRisk), task);
		assert.deepEqual(listed(done), ["T2", "T3", "T4"]);
		assert.equal(done.incomplete, undefined, "T5 出局了，他另一段不用再确认");
		assert.deepEqual(
			(await probe(query(anyone, noRisk), task)).unconfirmed,
			[],
		);
	});

	test("排除上没确认的段也能改变人的否定条件：这个人是候选，段会被读到，不会无声消失", async () => {
		// 「没有做风控策略的经历」写成排除，读了才知道；T4 那段原文只是提到
		const criterion = "本人做风控策略，只是参与项目的不算";
		const noRisk = judged("做过风控策略", ["风控"], criterion, {
			mode: "exclude",
		});
		const product: QueryCondition = {
			id: "产品",
			label: "现在是产品经理",
			mode: "must",
			from: "person",
			where:
				"exists (select 1 from experience x where x.emp_id = p.emp_id and x.title = '产品经理')",
		};
		const pending = await probe(query(product, noRisk), task);
		assert.equal(pending.total, 0);
		assert.equal(pending.candidates, 1, "T4 还在候选里");
		assert.deepEqual(await named(pending.unconfirmed), [
			["做过风控策略", "T4", "产品经理"],
		]);
		assert.deepEqual((await execute(query(product, noRisk), task)).incomplete, {
			above: null,
		});
		await conclude(task, criterion, false, ["T4"]);
		const outcome = await execute(query(product, noRisk), task);
		assert.deepEqual(ids(outcome.results), ["T4"]);
		assert.equal(outcome.incomplete, undefined);
	});

	test("只写判据、不写正则：范围里的每一段都是候选，确认过算的才是证据", async () => {
		const criterion = "这一段是带业务指标的一线岗位";
		const frontline: QueryCondition = {
			id: "一线",
			label: "带指标的一线岗位",
			mode: "must",
			from: "experience",
			seek: { patterns: [], criterion },
			where: "e.title ilike :t",
			params: { t: "%风控系统%" },
		};
		const tried = await probe(query(frontline), task);
		assert.equal(tried.conditions[0]?.people, 2, "T3 和 T5 各有一段在范围里");
		assert.deepEqual(await named(tried.unconfirmed), [
			["一线", "T3", "风控系统销售"],
			["一线", "T5", "风控系统售前"],
		]);
		await conclude(task, criterion, true, ["T3"]);
		await conclude(task, criterion, false, ["T5"], "风控系统售前");
		const outcome = evidence(await execute(query(frontline), task));
		assert.deepEqual(ids(outcome.results), ["T3"]);
		assert.deepEqual(
			outcome.results[0]?.evidence.map((h) => [h.title, h.route]),
			[["风控系统销售", "role"]],
			"证据是这一段登记的任职",
		);
		assert.equal(outcome.incomplete, undefined);
	});

	test("试跑：people 是字面对得上的人，含没确认过的，不含判成不算的；total 只数确认过的；列出候选人没确认过的段", async () => {
		const criterion = "本人做风控策略或风控运营";
		await conclude(task, criterion, true, ["T1", "T2"]);
		await conclude(task, criterion, false, ["T3"]);
		const tried = await probe(query(risk(criterion)), task);
		assert.deepEqual(tried.conditions, [
			{ id: "风控", people: 4, problem: null },
		]);
		assert.equal(tried.total, 2, "T1、T2；T4、T5 还没确认，不在名单上");
		assert.equal(
			tried.candidates,
			4,
			"没确认过的都算数的话，名单上会有这四个人",
		);
		assert.deepEqual(await named(tried.unconfirmed), [
			["风控", "T4", "产品经理"],
			["风控", "T5", "风控策略负责人"],
			["风控", "T5", "风控系统售前"],
		]);
		assert.deepEqual(tried.overflow, []);
	});

	test("试跑列出的段职级高的人在前，没有职级的在最后", async () => {
		const tried = await probe(query(risk("本人做风控策略")), task);
		assert.deepEqual(
			(await named(tried.unconfirmed)).map(([, empId]) => empId),
			["T1", "T2", "T3", "T4", "T5", "T5"],
		);
	});

	test("要看的只是条件自己选中的段：where 之外的段字面对得上也不用看", async () => {
		const tried = await probe(
			query({
				...atJiachen,
				seek: { patterns: ["推荐系统"], criterion: "本人做推荐系统" },
			}),
			task,
		);
		assert.equal(tried.conditions[0]?.people, 3);
		assert.equal(tried.total, 0, "一段都没确认过");
		assert.deepEqual(
			(await named(tried.unconfirmed)).map(([, empId]) => empId).sort(),
			["E1", "E2", "E4"],
			"E1 在乙未的那段、E3 都不在这条条件里",
		);
	});

	test("去掉一条必须的条件：只因为它被判成不算的人立刻上名单；从没确认过的人不上，名单标成不完整", async () => {
		// 字面上「风控」五个人都对得上，「策略」只有 T1、T4、T5：两条都必须时只有这三个人是候选，
		// 确认过的也只有他们
		const risky = risk("本人做风控");
		const strategy = judged("策略", ["策略"], "本人定策略");
		await conclude(task, risky.seek.criterion, true, ["T1", "T4"]);
		await conclude(task, risky.seek.criterion, true, ["T5"], "风控策略负责人");
		await conclude(task, risky.seek.criterion, false, ["T5"], "风控系统售前");
		await conclude(task, strategy.seek.criterion, true, ["T1", "T5"]);
		await conclude(task, strategy.seek.criterion, false, ["T4"]);
		const both = evidence(await execute(query(risky, strategy), task));
		assert.deepEqual(listed(both), ["T1", "T5"]);
		assert.equal(both.incomplete, undefined, "候选人的经历都确认过了");

		const one = evidence(await execute(query(risky), task));
		assert.deepEqual(
			listed(one),
			["T1", "T4", "T5"],
			"T4 的风控早就确认过、算数，只是策略那条不算",
		);
		assert.equal(one.total, 3);
		assert.deepEqual(
			one.incomplete,
			{ above: "P8" },
			"P7 的 T2、P6 的 T3 以前不是候选，没人确认过",
		);
	});

	test("先给必须和排除条件上没确认过的段，都确认完了才轮到加分条件；必须的条件判成不算的人，加分的段不用看；只剩加分的没确认完，名单不算不完整", async () => {
		const must = risk("本人做风控");
		const noPresales = judged("不要售前", ["售前"], "售前的经历不要", {
			mode: "exclude",
		});
		const boost = judged("策略优先", ["风控"], "做策略的优先", {
			mode: "boost",
		});
		const all = query(must, noPresales, boost);
		const first = await probe(all, task);
		assert.equal(first.candidates, 5, "没确认过的都算数的话，五个人都在名单上");
		assert.equal(first.total, 0);
		assert.deepEqual(
			[...new Set(first.unconfirmed.map((u) => u.condition.id))].sort(),
			["不要售前", "风控"],
		);
		assert.deepEqual(
			(await named(first.unconfirmed)).filter(([id]) => id === "不要售前"),
			[["不要售前", "T5", "风控系统售前"]],
		);

		await conclude(task, must.seek.criterion, true, ["T1", "T2", "T4", "T5"]);
		await conclude(task, must.seek.criterion, false, ["T3"]);
		await conclude(
			task,
			noPresales.seek.criterion,
			false,
			["T5"],
			"风控系统售前",
		);
		const second = await probe(all, task);
		assert.deepEqual(
			[...new Set(second.unconfirmed.map((u) => u.condition.id))],
			["策略优先"],
		);
		const owners = (await named(second.unconfirmed)).map(([, empId]) => empId);
		assert.deepEqual(
			owners,
			["T1", "T2", "T4", "T5", "T5"],
			"T3 在必须的条件上判成不算，不是候选；T5 的两段都要看",
		);
		assert.equal(second.candidates, 4);
		assert.equal(second.total, 4, "加分的条件没确认完不影响谁在名单上");
		const outcome = await execute(all, task);
		assert.equal(outcome.total, 4);
		assert.equal(outcome.incomplete, undefined);
	});

	test("正则写不对：试跑把问题记在这一条上，执行时整份不能执行", async () => {
		const broken = judged("坏正则", ["风控("], "本人做风控策略");
		const tried = await probe(query(broken), task);
		assert.equal(tried.conditions[0]?.people, null);
		assert.match(tried.conditions[0]?.problem ?? "", /正则「风控\(」写不对/);
		assert.equal(tried.total, null);
		assert.deepEqual(tried.unconfirmed, []);
		await assert.rejects(execute(query(broken), task), /坏正则.*不能执行/);
	});
});

describe("选中了什么：验收给条件认身份", () => {
	/** E1 在甲辰 12 个月、在乙未 96 个月：两条排除各自只碰到 E1，碰到的是不同的段。 */
	const excludeAt = (id: string, company: string, months: number) =>
		({
			id,
			label: `${company}那段不算`,
			mode: "exclude",
			from: "experience",
			where: "e.company ilike :c and e.months = :m",
			params: { c: `%${company}%`, m: months },
		}) satisfies QueryCondition;
	const selected = async (c: QueryCondition) => {
		const [one] = await selection(query(c));
		assert.ok(one?.selected, one?.problem ?? "没有跑");
		return one.selected;
	};
	const people = (list: string[]) =>
		[...new Set(list.map((s) => s.split(":")[0]))].sort();

	test("同一个人的两段：人一样，段不一样", async () => {
		const jia = await selected(excludeAt("jia", "甲辰科技", 12));
		const yi = await selected(excludeAt("yi", "乙未网络", 96));
		assert.deepEqual(people(jia), ["E1"]);
		assert.deepEqual(people(yi), ["E1"]);
		assert.equal(jia.length, 1);
		assert.equal(yi.length, 1);
		assert.notDeepEqual(jia, yi);
		assert.match(jia[0] ?? "", /^E1:\d+$/);
	});

	test("同一个要求的两种写法选中同样的段；人的条件列的是人", async () => {
		const loose: QueryCondition = { ...atJiachen, where: "e.company ilike :c" };
		assert.deepEqual(await selected(loose), await selected(atJiachen));
		assert.deepEqual(await selected(highTwice), ["R1", "R4", "R6"]);
	});

	test("试跑的人数就是选中的人数：同一份语句", async () => {
		const longOnes: QueryCondition = {
			id: "long",
			label: "入职前累计五年",
			mode: "must",
			from: "experience",
			where: "e.kind = 'external'",
			minMonths: 60,
		};
		const all = query(atJiachen, noIntern, longOnes, highTwice);
		const [tried, lists] = await Promise.all([
			probe(all, task),
			selection(all),
		]);
		assert.deepEqual(
			tried.conditions.map((c) => c.people),
			lists.map((l) => (l.selected ? people(l.selected).length : null)),
		);
		assert.deepEqual(people(lists[2]?.selected ?? []), ["E1", "E3"]);
		assert.equal(lists[2]?.selected?.length, 3, "累计够了的人的每一段");
	});
});
