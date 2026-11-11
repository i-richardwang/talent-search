/**
 * 查询理解的工具里看目录、捞说法、试跑、提交这四个；读经历、下结论和提交前要看完的检查在
 * `tests/agent-read.test.ts`。跑在临时 schema 上的真 SQL，数据全是合成的。工具给的是人数和
 * 人才库里的写法，和搜索用同一套匹配；提交的条件有问题就不通过，只是找不到人的原样再提交就通过。
 *
 * `drafted` 写的经历条件带判据「符合：词」。「推荐」和「考古」这两条判据下的经历开头就存好了
 * 结论，用它们的用例看的是候选人的经历都看过之后的样子。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { compileConditions } from "#/search/compile";
import { withIds } from "#/search/query";
import { parseQuery } from "#/search/query-syntax";
import { lately, sleeper } from "./conditions";
import {
	agentOn,
	type Checked,
	conclude,
	drafted,
	openSearch,
	seed,
	seedCompanies,
	seedStream,
	setup,
	type Tried,
	table,
} from "./fixture";

const teardown = await setup();
after(teardown);

/** 本文件的查询都在同一次找人任务里：结论记在它名下，也只认它名下的。 */
const SEARCH = await openSearch();
const { findPhrases, lookupNames, vocabulary } = await import(
	"#/search/search"
);
const { companyFacts, discover } = await import("#/server/discover");

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
	// 星河科技主营外卖、也做物流；星河小厂主营即时配送；别的公司没有收录
	await seedCompanies(
		{ "消费/零售": null, 外卖: "消费/零售", 物流: null, 即时配送: "物流" },
		[
			{
				name: "星河科技",
				group: "星河集团",
				industries: ["外卖", "消费/零售", "物流"],
				mainIndustries: ["外卖", "消费/零售"],
				circles: ["某组合"],
			},
			{
				name: "星河小厂",
				group: "星河集团",
				industries: ["即时配送", "物流"],
				mainIndustries: ["即时配送", "物流"],
			},
		],
	);
	const reviewedAt = new Date();
	await db.insert(term).values([
		{ word: "推荐系统", canonical: "推荐系统", reviewedAt },
		{ word: "个性化推荐", canonical: "推荐系统", reviewedAt },
	]);
	const numbered = (prefix: string, n: number) =>
		Array.from({ length: n }, (_, i) => `${prefix}${i}`);
	// 丙那段只有没读过的原文「推荐召回」，看下来不算
	await conclude(SEARCH, "符合：推荐", true, [
		...numbered("A", 6),
		...numbered("B", 2),
	]);
	await conclude(SEARCH, "符合：推荐", false, ["C0"]);
	await conclude(SEARCH, "符合：考古", true, numbered("D", 40));
});

describe("捞说法", () => {
	test("每条正则捞到多少种说法、多少人，写的人多的在前；不带词表里的其他写法，没读过的原文不列也不数", async () => {
		// 「推荐」按字面捞到两种写法；丙那段没读过的原文「推荐召回」不算
		assert.deepEqual(await findPhrases(["推荐", "个性化", "量子炼金"]), [
			{
				pattern: "推荐",
				phrases: 2,
				people: 8,
				top: [
					{ name: "推荐系统", people: 6 },
					{ name: "个性化推荐", people: 2 },
				],
				problem: null,
			},
			{
				pattern: "个性化",
				phrases: 1,
				people: 2,
				top: [{ name: "个性化推荐", people: 2 }],
				problem: null,
			},
			{ pattern: "量子炼金", phrases: 0, people: 0, top: [], problem: null },
		]);
	});

	test("正则写不对的给出原因，别的照捞", async () => {
		const [broken, fine] = await findPhrases(["推荐(", "考古"]);
		assert.match(broken?.problem ?? "", /^正则写不对/);
		assert.equal(broken?.people, 0);
		assert.equal(fine?.people, 40);
	});
});

describe("看目录", () => {
	test("公司只匹配入职前的公司名，部门只匹配公司内的部门名和路径，各给匹配到的写法和人数", async () => {
		const [company] = await lookupNames("company", ["星河"]);
		assert.deepEqual(company, {
			query: "星河",
			people: 8,
			values: [
				{ name: "星河科技", people: 6 },
				{ name: "星河小厂", people: 2 },
			],
		});
		const [department] = await lookupNames("department", ["星河"]);
		assert.deepEqual(
			department,
			{ query: "星河", people: 1, values: [{ name: "推荐中台", people: 1 }] },
			"路径里含「星河事业部」的那段，给的是末级部门名",
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

	test("行业是数组列：每个取值各数各的人，上级行业数进它下面的每个细分", async () => {
		const byName = async (column: string) => {
			const found = await discover({ relation: "experience", column });
			if (found.kind !== "values") throw new Error("该是一列取值");
			return Object.fromEntries(found.values.map((v) => [v.name, v.people]));
		};
		assert.deepEqual(await byName("main_industries"), {
			"消费/零售": 6,
			外卖: 6,
			物流: 2,
			即时配送: 2,
		});
		// 涉足的也算：星河科技的六个人数进物流
		assert.deepEqual(await byName("industries"), {
			"消费/零售": 6,
			外卖: 6,
			物流: 8,
			即时配送: 2,
		});
		assert.deepEqual(await byName("company_circles"), { 某组合: 6 });
	});

	test("提示词里预先给的公司概况：行业按树排，带两种人数和认出公司的段数", async () => {
		const facts = await companyFacts();
		assert.deepEqual(facts.industries, [
			{ name: "物流", parent: null, main: 2, any: 8 },
			{ name: "即时配送", parent: "物流", main: 2, any: 2 },
			{ name: "消费/零售", parent: null, main: 6, any: 6 },
			{ name: "外卖", parent: "消费/零售", main: 6, any: 6 },
		]);
		assert.deepEqual(facts.circles, [{ name: "某组合", people: 6 }]);
		assert.deepEqual(
			[facts.segments, facts.recognized, facts.labelled],
			[55, 8, 8],
		);
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
		const { catalogSchema } = await import("#/search/catalog");
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
		const { pool } = await import("#/db");
		await seedStream({
			stream: "perf",
			kind: "rating",
			label: "绩效",
			period: "半年",
			scale: ["B", "A"],
			records: ["A0", "A1", "A2"].map((empId, i) => ({
				empId,
				periodStart: "2025-01-01",
				periodEnd: "2025-06-30",
				value: i === 0 ? "B" : "A",
			})),
		});
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
		const { pool } = await import("#/db");
		await seedStream({
			stream: "hipo",
			kind: "status",
			label: "高潜",
			records: ["A0", "A1", "A2"].map((empId, i) => ({
				empId,
				periodStart: "2025-01-01",
				value: i === 0 ? "观察" : "高潜",
			})),
		});
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
	test("没写判据的条件字面对得上就算；每条单独数人，整份数人，加分的不缩小名单", async () => {
		const { call } = await agentOn(SEARCH);
		const result = await call<Tried>("probe", {
			conditions: compileConditions(parseQuery("推荐, +company:星河"))
				.conditions,
		});
		// 丙那段没读过的原文「推荐召回」也是字面对得上的；公司只认入职前的公司名
		assert.deepEqual(
			result.conditions.map((c) => c.people),
			[9, 8],
		);
		assert.equal(result.total, 9);
		assert.equal(result.unread, 0);
		assert.match(result.todo, /都看过了，可以提交/);
	});

	test("写了判据的条件：看过的经历听结论，判成不算的人不在 people 里，也不在名单上", async () => {
		const { call } = await agentOn(SEARCH);
		const result = await call<Tried>("probe", {
			conditions: drafted("推荐, +company:星河"),
		});
		assert.deepEqual(
			result.conditions.map((c) => c.people),
			[8, 8],
			"丙判成了不算",
		);
		assert.equal(result.total, 8);
		assert.equal(result.candidates, 8);
		assert.equal(result.unread, 0);
	});

	test("还没看过的经历：people 照数字面对得上的人，名单上一个人都没有，告诉模型去读", async () => {
		const { call } = await agentOn(SEARCH);
		const [fresh] = drafted("推荐");
		const result = await call<Tried>("probe", {
			conditions: [
				{
					...fresh,
					seek: { ...fresh?.seek, criterion: "本人做过推荐，还没人看过" },
				},
			],
		});
		assert.deepEqual(
			result.conditions.map((c) => c.people),
			[9],
		);
		assert.equal(result.total, 0);
		assert.equal(result.candidates, 9, "都算数的话名单上会有的人");
		assert.equal(result.unread, 9);
		assert.match(
			result.todo,
			/候选人还有经历没看过，没看过的不上名单：用 read 取来看/,
		);
	});

	test("按行业、按集团找：主营和涉足人数不同；「不要某行业来的」是排除的经历", async () => {
		const { call } = await agentOn(SEARCH);
		const inIndustry = (label: string, column: string, value: string) => ({
			label,
			mode: "boost",
			from: "experience",
			where: `:v = any(e.${column})`,
			params: { v: value },
		});
		const result = await call<Tried>("probe", {
			conditions: [
				inIndustry("主营物流", "main_industries", "物流"),
				inIndustry("做物流", "industries", "物流"),
				inIndustry("主营消费零售", "main_industries", "消费/零售"),
				{
					label: "星河集团旗下",
					mode: "boost",
					from: "experience",
					where: "e.company_group = :g",
					params: { g: "星河集团" },
				},
				{
					label: "在主营外卖的公司待过",
					mode: "exclude",
					from: "experience",
					where: ":v = any(e.main_industries)",
					params: { v: "外卖" },
				},
			],
		});
		// 排除数的是它最多会拦下的人：星河科技的六个人；名单从员工表出，拦下他们剩五十人
		assert.deepEqual(
			result.conditions.map((c) => c.problem ?? c.people),
			[2, 8, 6, 8, 6],
		);
		assert.equal(result.total, 50);
	});

	test("写错的那一条给出原因，别的照数；整份不数", async () => {
		const { call } = await agentOn(SEARCH);
		const result = await call<Tried>("probe", {
			conditions: [
				...drafted("推荐"),
				{
					label: "按工号找",
					mode: "must",
					from: "person",
					where: "p.emp_id = 'A0'",
				},
			],
		});
		assert.equal(result.conditions[0]?.people, 8);
		assert.match(result.conditions[1]?.problem ?? "", /emp_id/);
		assert.equal(result.total, null);
		assert.equal(result.unread, 0, "整份没跑，没有要读的");
	});

	test("数据异常不把取值带回给模型", async () => {
		const { call } = await agentOn(SEARCH);
		const result = await call<Tried>("probe", {
			conditions: [
				{
					label: "公司名当数字",
					mode: "must",
					from: "experience",
					where: "e.company::int > 0",
				},
			],
		});
		const problem = result.conditions[0]?.problem ?? "";
		assert.match(problem, /22P02/);
		assert.doesNotMatch(problem, /星河|考古|测年/);
	});
});

describe("提交搜索条件", () => {
	test("没有问题的条件直接通过，这一轮到此结束", async () => {
		const agent = await agentOn(SEARCH);
		assert.equal(agent.passed(), false);
		assert.deepEqual(await agent.call("submit", table(drafted("推荐"))), {
			passed: true,
		});
		assert.equal(agent.passed(), true);
		assert.deepEqual(
			agent.answer()?.admitted.query.conditions.map((c) => c.label),
			drafted("推荐").map((c) => c.label),
			"跑得通的全部录取",
		);
		assert.equal(agent.answer()?.unanswered, null);
	});

	test("找不到人的经历、匹配不到的名字不通过；原样再提交就通过：没有这样的人也是一个结果", async () => {
		const agent = await agentOn(SEARCH);
		const submitted = table(drafted("量子炼金, +company:北辰"));
		const first = await agent.call<Checked>("submit", submitted);
		assert.equal(first.passed, false);
		assert.equal(first.problems?.length, 2, first.problems?.join("\n") ?? "");
		const problems = first.problems?.join("\n") ?? "";
		assert.match(problems, /量子炼金/);
		assert.match(problems, /北辰/);
		assert.equal(agent.passed(), false);
		assert.equal(
			agent.answer()?.admitted.query.conditions.length,
			2,
			"没通过的也记着录取的那份",
		);
		assert.deepEqual(await agent.call("submit", submitted), { passed: true });
	});

	test("写不对、跑不了的 SQL 原样再提交也不通过；同一份里找不到人的那条不再提", async () => {
		const agent = await agentOn(SEARCH);
		const [unfound] = drafted("量子炼金");
		const submitted = table([
			unfound,
			{
				label: "学历很高",
				mode: "must",
				from: "person",
				where: "p.education_rank >= (select max(x.rank) from scale)",
			},
			sleeper,
		]);
		const first = await agent.call<Checked>("submit", submitted);
		assert.equal(first.problems?.length, 3, first.problems?.join("\n") ?? "");
		for (const _ of [1, 2]) {
			const again = await agent.call<Checked>("submit", submitted);
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
		const { steps } = agent;
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

	test("编得过、执行才报错的条件不录取；说明里的回答照留", async () => {
		const agent = await agentOn(SEARCH);
		const { compileWhere } = await import("#/server/sandbox");
		assert.ok(
			(await compileWhere(lately.where, lately.params, { from: "person" })).ok,
			"白名单放行：只有真跑才知道跑不了",
		);
		const result = await agent.call<Checked>("submit", {
			conditions: [...drafted("推荐"), lately],
			note: {
				says: "要不要再加上考古？",
				current: "不加",
				options: [{ label: "加上做过考古的", detail: "做过考古的有四十位" }],
			},
		});
		assert.match(
			result.problems?.join() ?? "",
			/最近有过绩效.*原样再提交也不收/,
		);
		const admitted = agent.answer()?.admitted;
		assert.deepEqual(
			admitted?.query.conditions.map((c) => c.label),
			drafted("推荐").map((c) => c.label),
		);
		assert.deepEqual(admitted?.notes?.choices, {
			current: "不加",
			others: [{ label: "加上做过考古的", detail: "做过考古的有四十位" }],
		});
	});

	test("写了做过什么却没写判据：原样再提交也不通过", async () => {
		const agent = await agentOn(SEARCH);
		// 关键词链编出来的条件只有正则，没有判据
		const bare = compileConditions(parseQuery("推荐")).conditions.map(
			({ id: _id, ...rest }) => rest,
		);
		for (const _ of [1, 2]) {
			const result = await agent.call<Checked>("submit", table(bare));
			assert.equal(result.passed, false);
			assert.match(result.problems?.join() ?? "", /推荐.*没写 criterion/);
		}
		const [first] = agent.steps;
		assert.deepEqual(first?.tool === "submit" && first.issues, [
			{ kind: "form", subject: "推荐" },
		]);
	});

	test("上一轮带过来、原样沿用的条件没写判据也收", async () => {
		const base = compileConditions(parseQuery("推荐")).conditions;
		const kept = await agentOn(SEARCH, base);
		assert.deepEqual(await kept.call("submit", table(base)), { passed: true });
	});

	test("显式写了空 seek 的经历条件不录取，不能变成人人满足的背景条件", async () => {
		const agent = await agentOn(SEARCH);
		const submitted = table([
			{
				label: "做过设备巡检",
				from: "experience",
				mode: "must",
				where: "true",
				seek: { patterns: [], criterion: "" },
			},
		]);
		for (const _ of [1, 2]) {
			const checked = await agent.call<Checked>("submit", submitted);
			assert.equal(checked.passed, false);
			assert.deepEqual(agent.answer()?.admitted.query.conditions, []);
		}
	});

	test("形状不对被丢、标签里有内部用词：原样再提交也不通过", async () => {
		const agent = await agentOn(SEARCH);
		const [one] = drafted("推荐");
		const submitted = table([
			{ ...one, label: "词表里的推荐" },
			{ label: "资深", mode: "exclude", from: "person", where: "true" },
		]);
		for (const _ of [1, 2]) {
			const result = await agent.call<Checked>("submit", submitted);
			assert.equal(result.passed, false);
			assert.match(result.problems?.join() ?? "", /词表/);
			assert.match(result.problems?.join() ?? "", /形状不对/);
		}
	});

	test("人多的条件照样通过：名单多长由 HR 决定", async () => {
		const agent = await agentOn(SEARCH);
		assert.deepEqual(await agent.call("submit", table(drafted("考古"))), {
			passed: true,
		});
	});

	test("这一轮新写的找不到人的条件不通过；上一轮就有的不检查", async () => {
		const fresh = await agentOn(SEARCH);
		const none = await fresh.call<Checked>(
			"submit",
			table(drafted("量子炼金")),
		);
		assert.equal(none.passed, false);
		assert.match(none.problems?.join() ?? "", /量子炼金.*一个人都找不到/);
		const base = withIds(drafted("量子炼金"));
		const kept = await agentOn(SEARCH, base);
		assert.deepEqual(await kept.call("submit", table(base)), { passed: true });
	});

	test("标签原样显示给 HR：里面有内部用词不通过；记进步骤的不带那条标签", async () => {
		const agent = await agentOn(SEARCH);
		const [one] = drafted("推荐");
		const result = await agent.call<Checked>(
			"submit",
			table([{ ...one, label: "词表里的推荐" }]),
		);
		assert.match(result.problems?.join() ?? "", /词表/);
		assert.deepEqual(
			agent.steps.map((step) => step.tool === "submit" && step.issues),
			[[{ kind: "wording", subject: null }]],
		);
		assert.doesNotMatch(JSON.stringify(agent.steps), /词表/);
	});

	test("写了回答选项没写现在是按哪种理解找的：告诉模型去补，原样再交也不收；补上就通过", async () => {
		const agent = await agentOn(SEARCH);
		const asking = (current: string | null) => ({
			conditions: drafted("推荐"),
			note: {
				says: "要不要把做过考古的也带上？",
				current,
				options: [{ label: "带上做过考古的", detail: "" }],
			},
		});
		for (const _ of [1, 2]) {
			const unlabeled = await agent.call<Checked>("submit", asking(null));
			assert.equal(unlabeled.passed, false);
			assert.match(unlabeled.problems?.join() ?? "", /current/);
		}
		assert.deepEqual(
			agent.steps.map((step) => step.tool === "submit" && step.issues),
			[[{ kind: "form", subject: null }], [{ kind: "form", subject: null }]],
		);
		assert.deepEqual(await agent.call("submit", asking("只看推荐")), {
			passed: true,
		});
		assert.deepEqual(agent.answer()?.admitted.notes?.choices, {
			current: "只看推荐",
			others: [{ label: "带上做过考古的" }],
		});
	});

	test("什么都没写不通过：录取的那份不算作答", async () => {
		const agent = await agentOn(SEARCH);
		const empty = await agent.call<Checked>("submit", table([]));
		assert.equal(empty.passed, false);
		assert.match(agent.answer()?.unanswered ?? "", /也没有说明/);
	});
});

test("每查一次记一步，步里只有线程画得出的：说法、写法和人数，没有正则、姓名、工号和没读过的简历原文", async () => {
	const { call, steps } = await agentOn(SEARCH);
	await call("find", { patterns: ["推荐"] });
	await call("discover", {
		relation: "experience",
		column: "company",
		match: ["星河"],
	});
	await call("discover", {
		relation: "experience",
		column: "department",
		match: ["星河"],
	});
	await call("probe", { conditions: drafted("推荐") });
	await call("submit", table(drafted("推荐")));
	assert.deepEqual(
		steps.map(({ at: _at, ...step }) => step),
		[
			{
				tool: "find",
				found: [{ phrases: 2, top: ["推荐系统", "个性化推荐"] }],
			},
			{
				tool: "discover",
				discovery: {
					kind: "names",
					subject: "公司",
					found: [{ query: "星河", values: ["星河科技", "星河小厂"] }],
				},
			},
			{
				tool: "discover",
				discovery: {
					kind: "names",
					subject: "部门",
					found: [{ query: "星河", values: ["推荐中台"] }],
				},
			},
			{
				tool: "probe",
				probe: {
					conditions: [{ label: "推荐", mode: "must", people: 8 }],
					total: 8,
					candidates: 8,
					unread: 0,
				},
			},
		],
	);
	assert.doesNotMatch(JSON.stringify(steps), /甲|乙|丙|A0|推荐召回/);
});

test("同一次理解里同样的问题答案相同，同时问两次也一样；每问一次记一步", async () => {
	const { call, steps } = await agentOn(SEARCH);
	const [first, second] = await Promise.all([
		call("find", { patterns: ["推荐", "考古"] }),
		call("find", { patterns: ["考古", " 推荐"] }),
	]);
	const company = {
		relation: "experience",
		column: "company",
		match: ["星河"],
	};
	await call("discover", company);
	await call("discover", {
		relation: "person",
		column: "school",
		match: ["星河"],
	});
	await call("discover", company);
	await call("probe", { conditions: drafted("推荐") });
	await call("probe", { conditions: drafted("推荐") });
	assert.deepEqual(second, first);
	assert.deepEqual(
		steps.map((s) => s.tool),
		["find", "find", "discover", "discover", "discover", "probe", "probe"],
		"步骤也是这一次处理还在的凭据：问了就记，答案是不是现成的都一样",
	);
});

test("同一份条件只改了标签再试跑：回的是新的标签", async () => {
	const { call } = await agentOn(SEARCH);
	const [one] = drafted("推荐");
	await call("probe", { conditions: [one] });
	const renamed = await call<{ conditions: { label: string }[] }>("probe", {
		conditions: [{ ...one, label: "做过推荐" }],
	});
	assert.deepEqual(
		renamed.conditions.map((c) => c.label),
		["做过推荐"],
	);
});
