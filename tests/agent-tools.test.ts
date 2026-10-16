/**
 * 查询理解的三个工具：查经历、查属性、提交搜索条件。跑在临时 schema 上的
 * 真 SQL 和假模型端点，数据全是合成的。查到的人数和搜出来的人数一致；发给模型的只有
 * 人数和至少几个人写过的写法，没有人；提交的条件有问题就不通过，原样再提交就通过。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { agentTools } = await import("#/server/agent-tools");
const { lookupExperience, lookupNames, search, vocabulary } = await import(
	"#/search/search"
);

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

describe("查属性", () => {
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

	test("有限取值的属性给出全部取值和人数，和提示词里预先给的是同一份", async () => {
		const vocab = await vocabulary();
		const { tools } = agentTools({ vocab, base: [], record: async () => {} });
		assert.deepEqual(
			await run(tools.lookup_attribute, {
				field: "school",
				queries: ["银河"],
			}),
			[
				{
					query: "银河",
					people: 40,
					values: [{ name: "银河学院", people: 40 }],
				},
			],
		);
		assert.deepEqual(
			await run(tools.lookup_attribute, { field: "companyTag" }),
			vocab.companyTag,
		);
	});
});

describe("提交搜索条件", () => {
	const agentOn = async (base = parseQuery("")) =>
		agentTools({ vocab: await vocabulary(), base, record: async () => {} });
	type Checked = { passed: boolean; problems?: string[] };

	test("没有问题的条件直接通过，这一轮到此结束", async () => {
		const agent = await agentOn();
		const submitted = table(parseQuery("推荐"));
		assert.equal(agent.passed(), false);
		assert.deepEqual(await run(agent.tools.submit, submitted), {
			passed: true,
		});
		assert.equal(agent.passed(), true);
		assert.deepEqual(agent.lastSubmitted(), submitted);
	});

	test("找不到人的词、匹配不到的名字、词表外的取值不通过；原样再提交就通过", async () => {
		const agent = await agentOn();
		const submitted = table([
			{ about: "experience", mode: "must", what: ["量子炼金"] },
			{ about: "experience", mode: "boost", company: ["北辰"] },
			{ about: "person", mode: "must", field: "education", atLeast: "博后" },
		]);
		const first = (await run(agent.tools.submit, submitted)) as Checked;
		assert.equal(first.passed, false);
		assert.equal(first.problems?.length, 3);
		const problems = first.problems?.join("\n") ?? "";
		assert.match(problems, /博后/);
		assert.match(problems, /量子炼金/);
		assert.match(problems, /北辰/);
		assert.equal(agent.passed(), false);
		assert.deepEqual(agent.lastSubmitted(), submitted, "没通过的也记着");
		assert.deepEqual(await run(agent.tools.submit, submitted), {
			passed: true,
		});
	});

	test("人多的词照样通过：名单多长由 HR 决定", async () => {
		const agent = await agentOn();
		assert.deepEqual(await run(agent.tools.submit, table(parseQuery("考古"))), {
			passed: true,
		});
	});

	test("这一轮新写的找不到人的词不通过；上一轮就有的不检查", async () => {
		const fresh = await agentOn();
		const none = (await run(
			fresh.tools.submit,
			table(parseQuery("量子炼金")),
		)) as Checked;
		assert.equal(none.passed, false);
		assert.match(none.problems?.join() ?? "", /量子炼金.*一个人都找不到/);
		const kept = await agentOn(parseQuery("量子炼金"));
		assert.deepEqual(
			await run(kept.tools.submit, table(parseQuery("量子炼金"))),
			{ passed: true },
		);
	});

	test("选项的表一样检查；写了选项没写现在是哪种理解，告诉模型去补", async () => {
		const agent = await agentOn();
		const option = (conditions: unknown[]) => ({
			label: "加上",
			detail: "",
			conditions,
		});
		const unfound = (await run(agent.tools.submit, {
			conditions: parseQuery("推荐"),
			note: {
				says: "要不要加上？",
				current: "不加",
				options: [option(parseQuery("推荐, 量子炼金"))],
			},
		})) as Checked;
		assert.match(unfound.problems?.join() ?? "", /量子炼金.*一个人都找不到/);
		const unlabeled = (await run(agent.tools.submit, {
			conditions: parseQuery("推荐"),
			note: {
				says: "要不要加上？",
				current: null,
				options: [option(parseQuery("推荐, 考古"))],
			},
		})) as Checked;
		assert.match(unlabeled.problems?.join() ?? "", /current/);
	});

	test("什么都没写不通过", async () => {
		const agent = await agentOn();
		const empty = (await run(agent.tools.submit, table([]))) as Checked;
		assert.equal(empty.passed, false);
	});
});

test("每查一次记一步，步里只有人数和人才库里的写法，没有人", async () => {
	const steps: TraceStep[] = [];
	const { tools } = agentTools({
		vocab: await vocabulary(),
		base: [],
		record: async (step) => {
			steps.push(step);
		},
	});
	await run(tools.lookup_experience, { texts: ["推荐"] });
	await run(tools.lookup_attribute, { field: "company", queries: ["星河"] });
	await run(tools.lookup_attribute, {
		field: "department",
		queries: ["星河"],
	});
	await run(tools.submit, table(parseQuery("推荐")));
	assert.deepEqual(
		steps.map((s) => s.tool),
		["lookup_experience", "lookup_attribute", "lookup_attribute"],
	);
	assert.doesNotMatch(JSON.stringify(steps), /甲|乙|丙|A0|推荐召回|星河事业部/);
});

test("同一次理解里查同样几个词只记一步，同时问两次也一样，答案相同", async () => {
	const steps: TraceStep[] = [];
	const { tools } = agentTools({
		vocab: await vocabulary(),
		base: [],
		record: async (step) => {
			steps.push(step);
		},
	});
	const [first, second] = await Promise.all([
		run(tools.lookup_experience, { texts: ["推荐", "考古"] }),
		run(tools.lookup_experience, { texts: ["考古", " 推荐"] }),
	]);
	await run(tools.lookup_attribute, { field: "company", queries: ["星河"] });
	await run(tools.lookup_attribute, { field: "school", queries: ["星河"] });
	await run(tools.lookup_attribute, { field: "company", queries: ["星河"] });
	assert.deepEqual(second, first);
	assert.deepEqual(
		steps.map((s) => s.tool),
		["lookup_experience", "lookup_attribute", "lookup_attribute"],
		"公司和学校查同一个名字是两件事",
	);
});
