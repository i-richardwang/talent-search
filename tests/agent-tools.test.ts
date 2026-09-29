/**
 * 查询理解的三个工具：查经历词、查公司名和学校名、提交搜索条件。跑在临时 schema 上的
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
const { findNames, findTerms, search, vocabulary } = await import(
	"#/search/search"
);

before(async () => {
	const { db } = await import("#/db");
	const { skillTerm } = await import("#/db/schema");
	const external = (org: string, skills: string[]) => ({
		kind: "external" as const,
		months: 24,
		org,
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
					org: "推荐中台",
					orgPath: "星河事业部/推荐中台",
					description: "推荐召回",
				},
			],
		},
		...Array.from({ length: 40 }, (_, i) => ({
			empId: `D${i}`,
			name: `丁${i}`,
			school: "银河学院",
			segments: [external("考古研究所", ["考古"])],
		})),
	]);
	const judge = "model:test";
	const reviewedAt = new Date();
	await db.insert(skillTerm).values([
		{ word: "推荐系统", canonical: "推荐系统", judge, reviewedAt },
		{ word: "个性化推荐", canonical: "推荐系统", judge, reviewedAt },
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
	return { conditions, assumed: [], declined: [] };
}

describe("查经历词", () => {
	test("人数就是只拿这个词搜出来的人数，按人算", async () => {
		const [found] = await findTerms(["推荐"]);
		const { total } = await search({ conditions: parseQuery("推荐") }, {}, 1);
		assert.equal(found?.people, 9);
		assert.equal(found?.people, total);
	});

	test("命中的能力词换成标准写法；整段简历原文不发给模型；写的人太少的不给", async () => {
		// 「推荐」命中了「推荐系统」「个性化推荐」两种写法和一段简历原文「推荐召回」：
		// 两种写法并成一个标准词、8 人；原文只计人数
		const [found] = await findTerms(["推荐"]);
		assert.deepEqual(found?.terms, [{ name: "推荐系统", people: 8 }]);
		const [few] = await findTerms(["个性化推荐"]);
		assert.deepEqual(few?.terms, [], "只有两个人写过，不给");
	});

	test("命中的人超过全库两成就是太宽；一个人都找不到的是 0", async () => {
		const found = await findTerms(["推荐", "考古", "量子炼金"]);
		assert.deepEqual(
			found.map((t) => [t.text, t.people, t.wide]),
			[
				["推荐", 9, false],
				["考古", 40, true],
				["量子炼金", 0, false],
			],
		);
	});
});

describe("查公司名和学校名", () => {
	test("公司名连部门路径一起数人；发给模型的只有入职前的公司名，且写的人够多", async () => {
		const [found] = await findNames("org", ["星河"]);
		assert.equal(found?.people, 9, "星河科技 6、星河小厂 2、星河事业部 1");
		assert.deepEqual(found?.names, [{ name: "星河科技", people: 6 }]);
	});

	test("学校名按包含匹配；匹配不到的是 0", async () => {
		const found = await findNames("school", ["银河", "北辰大学"]);
		assert.deepEqual(found, [
			{ name: "银河", people: 40, names: [{ name: "银河学院", people: 40 }] },
			{ name: "北辰大学", people: 0, names: [] },
		]);
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
			{ about: "experience", mode: "boost", org: ["北辰"] },
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

	test("这一轮新写的太宽的词不通过；上一轮就有的不检查", async () => {
		const fresh = await agentOn();
		const wide = (await run(
			fresh.tools.submit,
			table(parseQuery("考古")),
		)) as Checked;
		assert.equal(wide.passed, false);
		assert.match(wide.problems?.join() ?? "", /考古.*几乎不筛人/);
		const kept = await agentOn(parseQuery("考古"));
		assert.deepEqual(await run(kept.tools.submit, table(parseQuery("考古"))), {
			passed: true,
		});
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
	await run(tools.find_terms, { texts: ["推荐"] });
	await run(tools.find_names, { field: "org", names: ["星河"] });
	await run(tools.submit, table(parseQuery("推荐")));
	assert.deepEqual(
		steps.map((s) => s.tool),
		["find_terms", "find_names"],
	);
	assert.doesNotMatch(JSON.stringify(steps), /甲|乙|丙|A0|推荐召回|星河事业部/);
});
