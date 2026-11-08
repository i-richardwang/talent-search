/**
 * 查询理解的四个工具：看目录、查经历词、试跑、提交。跑在临时 schema 上的真 SQL 和假模型端点，
 * 数据全是合成的。查到的人数和搜出来的人数一致；发给模型的只有人数和至少几个人写过的写法，
 * 没有人；提交的条件有问题就不通过，原样再提交就通过。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { compileConditions } from "#/search/compile";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import { drafted, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { agentTools } = await import("#/server/agent-tools");
const { lookupExperience, lookupNames, search, vocabulary } = await import(
	"#/search/search"
);
const { discover } = await import("#/server/discover");

before(async () => {
	const { db } = await import("#/db");
	const { term } = await import("#/db/schema");
	const external = (company: string, skills: string[]) => ({
		kind: "external" as const,
		months: 24,
		company,
		extracted: { skills },
	});
	await seed([
		...Array.from({ length: 6 }, (_, i) => ({
			empId: `A${i}`,
			name: `甲${i}`,
			segments: [external("星河科技", ["推荐系统"])],
		})),
		...Array.from({ length: 2 }, (_, i) => ({
			empId: `B${i}`,
			name: `乙${i}`,
			segments: [external("星河小厂", ["个性化推荐"])],
		})),
		{
			empId: "C0",
			name: "丙",
			segments: [
				{
					months: 12,
					department: "推荐中台",
					departmentPath: "星河事业部/推荐中台",
					description: "推荐召回",
				},
			],
		},
		...Array.from({ length: 2 }, (_, i) => ({
			empId: `E${i}`,
			name: `戊${i}`,
			segments: [external("星图工作室", ["星图测绘"])],
		})),
		...Array.from({ length: 40 }, (_, i) => ({
			empId: `D${i}`,
			name: `丁${i}`,
			school: "银河学院",
			segments: [external("考古研究所", ["考古"])],
		})),
		...Array.from({ length: 5 }, (_, i) => ({
			empId: `F${i}`,
			name: `己${i}`,
			segments: [external("测年实验室", ["碳十四测年"])],
		})),
	]);
	const reviewedAt = new Date();
	await db.insert(term).values([
		{ word: "推荐系统", canonical: "推荐系统", reviewedAt },
		{ word: "个性化推荐", canonical: "推荐系统", reviewedAt },
		{ word: "文物", canonical: "文物", reviewedAt },
		{ word: "考古", canonical: "考古", parent: "文物", reviewedAt },
		{ word: "碳十四测年", canonical: "碳十四测年", parent: "考古", reviewedAt },
	]);
});

/** SDK 的工具外壳只在模型调用时才有上下文；这里直接按它的入参调 execute。 */
function run(
	t: { execute?: (input: never, options: never) => unknown },
	input: unknown,
) {
	return t.execute?.(
		input as never,
		{ toolCallId: "t", messages: [] } as never,
	);
}

function table(conditions: unknown[]) {
	return { conditions, note: null };
}

describe("查经历", () => {
	test("人数就是只拿这个词搜出来的人数，按人算", async () => {
		const [found] = await lookupExperience(["推荐"]);
		const { total } = await search({ conditions: parseQuery("推荐") }, {}, 1);
		assert.equal(found?.people, 9);
		assert.equal(found?.people, total);
	});

	test("命中的能力词换成标准写法；整段简历原文不发给模型；写的人太少的不给", async () => {
		// 「推荐」命中了「推荐系统」「个性化推荐」两种写法和一段简历原文「推荐召回」：
		// 两种写法并成一个标准词、8 人；原文只计人数
		const [found] = await lookupExperience(["推荐"]);
		const recommend = {
			name: "推荐系统",
			people: 8,
			broader: null,
			narrower: [],
		};
		assert.deepEqual(found?.terms, [recommend]);
		const [same] = await lookupExperience(["个性化推荐"]);
		assert.deepEqual(
			same?.terms,
			[recommend],
			"同一件事的写法顺着词表一起找到",
		);
		const [few] = await lookupExperience(["星图测绘"]);
		assert.equal(few?.people, 2);
		assert.deepEqual(few?.terms, [], "只有两个人写过，不给");
	});

	test("人数按人数，一个人都找不到的是 0", async () => {
		const found = await lookupExperience(["推荐", "考古", "量子炼金"]);
		assert.deepEqual(
			found.map((t) => [t.text, t.people]),
			[
				["推荐", 9],
				["考古", 45],
				["量子炼金", 0],
			],
			"写了细词「碳十四测年」的五个人也符合「考古」",
		);
	});

	test("每个能力词带上词表里更宽和更细的词", async () => {
		const [found] = await lookupExperience(["考古"]);
		assert.deepEqual(found?.terms, [
			{ name: "考古", people: 40, broader: "文物", narrower: ["碳十四测年"] },
			{ name: "碳十四测年", people: 5, broader: "考古", narrower: [] },
		]);
	});
});

describe("看目录", () => {
	test("公司只匹配入职前的公司名，部门只匹配公司内的部门，公司的人数和部门的人数各算各的", async () => {
		const [company] = await lookupNames("company", ["星河"]);
		assert.deepEqual(company, {
			query: "星河",
			people: 8,
			values: [{ name: "星河科技", people: 6 }],
		});
		const [department] = await lookupNames("department", ["星河"]);
		assert.deepEqual(
			department,
			{ query: "星河", people: 1, values: [] },
			"部门路径里的「星河事业部」只算人数，部门名不发给模型",
		);
	});

	test("学校名按包含匹配；匹配不到的是 0", async () => {
		const found = await lookupNames("school", ["银河", "北辰大学"]);
		assert.deepEqual(found, [
			{
				query: "银河",
				people: 40,
				values: [{ name: "银河学院", people: 40 }],
			},
			{ query: "北辰大学", people: 0, values: [] },
		]);
	});

	test("名字列按包含匹配，和查名字是同一份；有限取值的列和提示词里预先给的是同一份", async () => {
		assert.deepEqual(
			await discover({ relation: "person", column: "school", match: ["银河"] }),
			{
				kind: "names",
				subject: "学校",
				found: await lookupNames("school", ["银河"]),
			},
		);
		const vocab = await vocabulary();
		const values = await discover({
			relation: "experience",
			column: "company_tag",
		});
		assert.deepEqual(values, {
			kind: "values",
			subject: "公司档",
			values: vocab.companyTag,
		});
	});

	test("总览给出各关系的行数，不给人", async () => {
		const overview = await discover({});
		assert.equal(overview.kind, "overview");
		if (overview.kind !== "overview") return;
		assert.deepEqual(
			overview.relations.map((r) => r.name),
			["person", "experience", "rating", "status", "scale"],
		);
		assert.doesNotMatch(JSON.stringify(overview), /甲|乙|A0|星河科技/);
		// 一条语句里数出的每一列，和逐个视图单独数的一样，没有错位
		const { db } = await import("#/db");
		const { catalogSchema } = await import("#/server/sandbox");
		const { sql } = await import("drizzle-orm");
		for (const r of overview.relations) {
			const { rows } = await db.execute<{ n: number }>(
				sql`select count(*)::int as n from ${sql.identifier(catalogSchema())}.${sql.identifier(r.name)}`,
			);
			assert.equal(r.rows, rows[0]?.n, r.name);
		}
		const rows = Object.fromEntries(
			overview.relations.map((r) => [r.name, r.rows]),
		);
		assert.ok(
			(rows.person ?? 0) > 0 && (rows.scale ?? 0) > 0,
			JSON.stringify(rows),
		);
	});

	test("问不了的给一句原因：岗位名不列取值，评级的档要说是哪条流", async () => {
		assert.equal(
			(await discover({ relation: "experience", column: "title" })).kind,
			"problem",
		);
		assert.equal(
			(await discover({ relation: "rating", column: "value" })).kind,
			"problem",
		);
		assert.equal((await discover({ relation: "employee" })).kind, "problem");
	});

	test("记录流的档按档高排，标题写流的名字；没有这条流给一句原因", async () => {
		const { db, pool } = await import("#/db");
		const { recordStream, scale, employeeRecord } = await import("#/db/schema");
		await db.insert(recordStream).values({
			stream: "perf",
			kind: "rating",
			label: "绩效",
			period: "半年",
		});
		await db
			.insert(scale)
			.values(
				["B", "A"].map((value, rank) => ({ stream: "perf", value, rank })),
			);
		await db.insert(employeeRecord).values(
			["A0", "A1", "A2"].map((empId, i) => ({
				empId,
				stream: "perf",
				periodStart: "2025-01-01",
				periodEnd: "2025-06-30",
				value: i === 0 ? "B" : "A",
			})),
		);
		try {
			assert.deepEqual(
				await discover({ relation: "rating", column: "value", stream: "perf" }),
				{
					kind: "values",
					subject: "绩效的档",
					values: [
						{ name: "B", people: 1 },
						{ name: "A", people: 2 },
					],
				},
			);
			assert.equal(
				(await discover({ relation: "rating", column: "value", stream: "x" }))
					.kind,
				"problem",
			);
		} finally {
			await pool.query("delete from record_stream");
		}
	});
	test("状态流的取值和评级流走同一条路：按人数列出每个取值，总览里也带上", async () => {
		const { db, pool } = await import("#/db");
		const { recordStream, employeeRecord } = await import("#/db/schema");
		await db.insert(recordStream).values({
			stream: "hipo",
			kind: "status",
			label: "高潜",
		});
		await db.insert(employeeRecord).values(
			["A0", "A1", "A2"].map((empId, i) => ({
				empId,
				stream: "hipo",
				periodStart: "2025-01-01",
				value: i === 0 ? "观察" : "高潜",
			})),
		);
		try {
			assert.deepEqual(
				await discover({ relation: "status", column: "value", stream: "hipo" }),
				{
					kind: "values",
					subject: "高潜的状态",
					values: [
						{ name: "高潜", people: 2 },
						{ name: "观察", people: 1 },
					],
				},
			);
			assert.equal(
				(await discover({ relation: "status", column: "value" })).kind,
				"problem",
				"不写是哪条流，问不了",
			);
			const overview = await discover({});
			assert.equal(overview.kind, "overview");
			if (overview.kind !== "overview") return;
			assert.deepEqual(
				overview.streams.map((s) => [s.stream, s.values]),
				[["hipo", ["高潜", "观察"]]],
			);
		} finally {
			await pool.query("delete from record_stream");
		}
	});
});

describe("试跑", () => {
	test("每条单独数人，整份数人；加分的不缩小名单", async () => {
		const { tools } = agentTools({ base: [], record: async () => {} });
		const result = (await run(tools.probe, {
			conditions: drafted("推荐, +company:星河"),
		})) as { conditions: { people: number | null }[]; total: number | null };
		assert.deepEqual(
			result.conditions.map((c) => c.people),
			[9, 8],
		);
		assert.equal(result.total, 9);
	});

	test("写错的那一条给出原因，别的照数；整份不数", async () => {
		const { tools } = agentTools({ base: [], record: async () => {} });
		const result = (await run(tools.probe, {
			conditions: [
				...drafted("推荐"),
				{
					label: "按工号找",
					mode: "must",
					from: "person",
					where: "p.emp_id = 'A0'",
				},
			],
		})) as {
			conditions: { people: number | null; problem: string | null }[];
			total: number | null;
		};
		assert.equal(result.conditions[0]?.people, 9);
		assert.match(result.conditions[1]?.problem ?? "", /emp_id/);
		assert.equal(result.total, null);
	});

	test("数据异常不把取值带回给模型", async () => {
		const { tools } = agentTools({ base: [], record: async () => {} });
		const result = (await run(tools.probe, {
			conditions: [
				{
					label: "公司名当数字",
					mode: "must",
					from: "experience",
					where: "e.company::int > 0",
				},
			],
		})) as { conditions: { problem: string | null }[] };
		const problem = result.conditions[0]?.problem ?? "";
		assert.match(problem, /22P02/);
		assert.doesNotMatch(problem, /星河|考古|测年/);
	});
});

describe("提交搜索条件", () => {
	const agentOn = (base = compileConditions(parseQuery("")).conditions) =>
		agentTools({ base, record: async () => {} });
	type Checked = { passed: boolean; problems?: string[] };

	test("没有问题的条件直接通过，这一轮到此结束", async () => {
		const agent = agentOn();
		const submitted = table(drafted("推荐"));
		assert.equal(agent.passed(), false);
		assert.deepEqual(await run(agent.tools.submit, submitted), {
			passed: true,
		});
		assert.equal(agent.passed(), true);
		assert.deepEqual(agent.answer()?.submitted, submitted);
		assert.deepEqual(
			agent.answer()?.admitted.query.conditions.map((c) => c.label),
			drafted("推荐").map((c) => c.label),
			"跑得通的全部录取",
		);
	});

	test("找不到人的词、匹配不到的名字不通过；原样再提交就通过：没有这样的人也是一个结果", async () => {
		const agent = agentOn();
		const submitted = table(drafted("量子炼金, +company:北辰"));
		const first = (await run(agent.tools.submit, submitted)) as Checked;
		assert.equal(first.passed, false);
		assert.equal(first.problems?.length, 2, first.problems?.join("\n") ?? "");
		const problems = first.problems?.join("\n") ?? "";
		assert.match(problems, /量子炼金/);
		assert.match(problems, /北辰/);
		assert.equal(agent.passed(), false);
		assert.deepEqual(agent.answer()?.submitted, submitted, "没通过的也记着");
		assert.deepEqual(await run(agent.tools.submit, submitted), {
			passed: true,
		});
	});

	test("写不对、跑不了的 SQL 原样再提交也不通过；同一份里找不到人的那条不再提", async () => {
		const steps: TraceStep[] = [];
		const agent = agentTools({
			base: [],
			record: async (step) => {
				steps.push(step);
			},
		});
		const [unfound] = drafted("量子炼金");
		const submitted = table([
			unfound,
			{
				label: "学历很高",
				mode: "must",
				from: "person",
				where: "p.education_rank >= (select max(x.rank) from scale)",
			},
			{
				label: "睡一会儿",
				mode: "must",
				from: "person",
				where: "pg_sleep(1) is not null",
			},
		]);
		const first = (await run(agent.tools.submit, submitted)) as Checked;
		assert.equal(first.problems?.length, 3, first.problems?.join("\n") ?? "");
		for (const _ of [1, 2]) {
			const again = (await run(agent.tools.submit, submitted)) as Checked;
			assert.equal(again.passed, false);
			const problems = again.problems?.join("\n") ?? "";
			assert.match(problems, /学历很高.*原样再提交也不收/);
			assert.match(problems, /睡一会儿.*pg_sleep/);
			assert.doesNotMatch(problems, /量子炼金/);
			assert.equal(agent.passed(), false);
		}
		assert.deepEqual(
			agent.answer()?.admitted.query.conditions.map((c) => c.label),
			[unfound?.label],
			"录取的只有跑得通的那条，找不到人不妨碍录取",
		);
		assert.equal(steps.length, 3, "没通过的提交每次记一步");
		assert.deepEqual(steps[0], {
			at: steps[0]?.at,
			tool: "submit",
			issues: [
				{ kind: "unrunnable", subject: "学历很高" },
				{ kind: "unrunnable", subject: "睡一会儿" },
				{ kind: "unfound", subject: "量子炼金" },
			],
		});
		assert.doesNotMatch(JSON.stringify(steps), /pg_sleep|where|label/);
	});

	test("编得过、执行才报错的条件不录取，选项里的同样不录取", async () => {
		const agent = agentOn();
		const lately = {
			label: "最近有过绩效",
			mode: "must",
			from: "person",
			where:
				"exists (select 1 from rating r where r.emp_id = p.emp_id and r.period_end >= current_date - :days)",
			params: { days: "九十" },
		};
		const { compileWhere } = await import("#/server/sandbox");
		assert.ok(
			(await compileWhere(lately.where, lately.params, { from: "person" })).ok,
			"白名单放行：只有真跑才知道跑不了",
		);
		const result = (await run(agent.tools.submit, {
			conditions: [...drafted("推荐"), lately],
			note: {
				says: "要不要再加上考古？",
				current: "不加",
				options: [
					{
						label: "加上",
						detail: "",
						conditions: [...drafted("推荐, 考古"), lately],
					},
				],
			},
		})) as Checked;
		assert.match(
			result.problems?.join() ?? "",
			/最近有过绩效.*原样再提交也不收/,
		);
		const admitted = agent.answer()?.admitted;
		assert.deepEqual(
			admitted?.query.conditions.map((c) => c.label),
			drafted("推荐").map((c) => c.label),
		);
		assert.deepEqual(
			admitted?.notes?.choices?.others.map((o) =>
				o.conditions.map((c) => c.label),
			),
			[drafted("推荐, 考古").map((c) => c.label)],
		);
	});

	test("形状不对被丢、标签里有内部用词：原样再提交也不通过", async () => {
		const agent = agentOn();
		const [one] = drafted("推荐");
		const submitted = table([
			{ ...one, label: "词表里的推荐" },
			{ label: "资深", mode: "exclude", from: "person", where: "true" },
		]);
		for (const _ of [1, 2]) {
			const result = (await run(agent.tools.submit, submitted)) as Checked;
			assert.equal(result.passed, false);
			assert.match(result.problems?.join() ?? "", /词表/);
			assert.match(result.problems?.join() ?? "", /形状不对/);
		}
	});

	test("人多的词照样通过：名单多长由 HR 决定", async () => {
		const agent = agentOn();
		assert.deepEqual(await run(agent.tools.submit, table(drafted("考古"))), {
			passed: true,
		});
	});

	test("这一轮新写的找不到人的词不通过；上一轮就有的不检查", async () => {
		const fresh = agentOn();
		const none = (await run(
			fresh.tools.submit,
			table(drafted("量子炼金")),
		)) as Checked;
		assert.equal(none.passed, false);
		assert.match(none.problems?.join() ?? "", /量子炼金.*一个人都找不到/);
		const base = compileConditions(parseQuery("量子炼金")).conditions;
		const kept = agentOn(base);
		assert.deepEqual(await run(kept.tools.submit, table(base)), {
			passed: true,
		});
	});

	test("标签原样显示给 HR：里面有内部用词不通过；记进步骤的不带那条标签", async () => {
		const steps: TraceStep[] = [];
		const agent = agentTools({
			base: [],
			record: async (step) => {
				steps.push(step);
			},
		});
		const [one] = drafted("推荐");
		const result = (await run(
			agent.tools.submit,
			table([{ ...one, label: "词表里的推荐" }]),
		)) as Checked;
		assert.match(result.problems?.join() ?? "", /词表/);
		assert.deepEqual(
			steps.map((step) => step.tool === "submit" && step.issues),
			[[{ kind: "wording", subject: null }]],
		);
		assert.doesNotMatch(JSON.stringify(steps), /词表/);
	});

	test("选项的条件一样检查；写了选项没写现在是哪种理解，告诉模型去补", async () => {
		const agent = agentOn();
		const option = (conditions: unknown[]) => ({
			label: "加上",
			detail: "",
			conditions,
		});
		const unfound = (await run(agent.tools.submit, {
			conditions: drafted("推荐"),
			note: {
				says: "要不要加上？",
				current: "不加",
				options: [option(drafted("推荐, 量子炼金"))],
			},
		})) as Checked;
		assert.match(unfound.problems?.join() ?? "", /量子炼金.*一个人都找不到/);
		const unlabeled = (await run(agent.tools.submit, {
			conditions: drafted("推荐"),
			note: {
				says: "要不要加上？",
				current: null,
				options: [option(drafted("推荐, 考古"))],
			},
		})) as Checked;
		assert.match(unlabeled.problems?.join() ?? "", /current/);
	});

	test("什么都没写不通过", async () => {
		const agent = agentOn();
		const empty = (await run(agent.tools.submit, table([]))) as Checked;
		assert.equal(empty.passed, false);
	});
});

test("每查一次记一步，步里只有人数和人才库里的写法，没有人", async () => {
	const steps: TraceStep[] = [];
	const { tools } = agentTools({
		base: [],
		record: async (step) => {
			steps.push(step);
		},
	});
	await run(tools.lookup_experience, { texts: ["推荐"] });
	await run(tools.discover, {
		relation: "experience",
		column: "company",
		match: ["星河"],
	});
	await run(tools.discover, {
		relation: "experience",
		column: "department",
		match: ["星河"],
	});
	await run(tools.probe, { conditions: drafted("推荐") });
	await run(tools.submit, table(drafted("推荐")));
	assert.deepEqual(
		steps.map((s) => s.tool),
		["lookup_experience", "discover", "discover", "probe"],
	);
	assert.doesNotMatch(JSON.stringify(steps), /甲|乙|丙|A0|推荐召回|星河事业部/);
});

test("同一次理解里同样的问题只记一步，同时问两次也一样，答案相同", async () => {
	const steps: TraceStep[] = [];
	const { tools } = agentTools({
		base: [],
		record: async (step) => {
			steps.push(step);
		},
	});
	const [first, second] = await Promise.all([
		run(tools.lookup_experience, { texts: ["推荐", "考古"] }),
		run(tools.lookup_experience, { texts: ["考古", " 推荐"] }),
	]);
	const company = {
		relation: "experience",
		column: "company",
		match: ["星河"],
	};
	await run(tools.discover, company);
	await run(tools.discover, {
		relation: "person",
		column: "school",
		match: ["星河"],
	});
	await run(tools.discover, company);
	await run(tools.probe, { conditions: drafted("推荐") });
	await run(tools.probe, { conditions: drafted("推荐") });
	assert.deepEqual(second, first);
	assert.deepEqual(
		steps.map((s) => s.tool),
		["lookup_experience", "discover", "discover", "probe"],
		"公司和学校查同一个名字是两件事",
	);
});
