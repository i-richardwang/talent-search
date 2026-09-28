/**
 * 查询理解的三个工具：查词、查名称、交表。跑在临时 schema 上的真 SQL 和假模型端点，
 * 数据全是合成的。查到的和搜到的是同一个口径；交出去的只有数和至少几个人写过的
 * 库里写法，不交出人；交表有问题退回，原样再交就收下。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { TraceStep } from "#/search/trace";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { agentTools } = await import("#/server/agent-tools");
const { nameReach, search, termReach, vocabulary } = await import(
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

describe("查词", () => {
	test("人数就是只拿这个词搜出来的人数，按人算", async () => {
		const [found] = await termReach(["推荐"]);
		const { total } = await search({ conditions: parseQuery("推荐") }, {}, 1);
		assert.equal(found?.people, 9);
		assert.equal(found?.people, total);
	});

	test("命中的能力词映到标准写法；整段原文不交出去；写的人太少的不给", async () => {
		// 「推荐」命中了「推荐系统」「个性化推荐」两种写法和一段简历原文「推荐召回」：
		// 两种写法并成一个标准词、8 人；原文只计人数
		const [found] = await termReach(["推荐"]);
		assert.deepEqual(found?.terms, [{ name: "推荐系统", people: 8 }]);
		const [few] = await termReach(["个性化推荐"]);
		assert.deepEqual(few?.terms, [], "只有两个人写过，不给");
	});

	test("命中的人超过全库两成就是太宽；一个人都找不到的是 0", async () => {
		const found = await termReach(["推荐", "考古", "量子炼金"]);
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

describe("查名称", () => {
	test("公司名连部门路径一起数人；交出去的只有入职前的公司名，且写的人够多", async () => {
		const [found] = await nameReach("org", ["星河"]);
		assert.equal(found?.people, 9, "星河科技 6、星河小厂 2、星河事业部 1");
		assert.deepEqual(found?.names, [{ name: "星河科技", people: 6 }]);
	});

	test("学校名按包含匹配；匹配不到的是 0", async () => {
		const found = await nameReach("school", ["银河", "北辰大学"]);
		assert.deepEqual(found, [
			{ name: "银河", people: 40, names: [{ name: "银河学院", people: 40 }] },
			{ name: "北辰大学", people: 0, names: [] },
		]);
	});
});

describe("交表", () => {
	const toolsOn = async (base = parseQuery("")) =>
		agentTools({ vocab: await vocabulary(), base, record: async () => {} });

	test("没问题的表直接收下", async () => {
		const tools = await toolsOn();
		assert.deepEqual(await run(tools.submit, table(parseQuery("推荐"))), {
			accepted: true,
		});
	});

	test("找不到人的词、匹配不到的名字、词表外的取值退回；原样再交就收下", async () => {
		const tools = await toolsOn();
		const asked = table([
			{ about: "experience", mode: "must", what: ["量子炼金"] },
			{ about: "experience", mode: "boost", org: ["北辰"] },
			{ about: "person", mode: "must", field: "education", atLeast: "博后" },
		]);
		const first = (await run(tools.submit, asked)) as {
			accepted: boolean;
			problems: string[];
		};
		assert.equal(first.accepted, false);
		assert.equal(first.problems.length, 3);
		assert.match(first.problems.join("\n"), /博后/);
		assert.match(first.problems.join("\n"), /量子炼金/);
		assert.match(first.problems.join("\n"), /北辰/);
		assert.deepEqual(await run(tools.submit, asked), { accepted: true });
	});

	test("这一轮新写的太宽的词退回；上一轮就有的不量", async () => {
		const fresh = await toolsOn();
		const wide = (await run(fresh.submit, table(parseQuery("考古")))) as {
			accepted: boolean;
			problems: string[];
		};
		assert.equal(wide.accepted, false);
		assert.match(wide.problems.join(), /考古.*几乎不筛人/);
		const kept = await toolsOn(parseQuery("考古"));
		assert.deepEqual(await run(kept.submit, table(parseQuery("考古"))), {
			accepted: true,
		});
	});

	test("什么都没写就退回", async () => {
		const tools = await toolsOn();
		const empty = (await run(tools.submit, table([]))) as {
			accepted: boolean;
		};
		assert.equal(empty.accepted, false);
	});
});

test("查词、查名称每用一次记一步，步上只有数和库里的写法，没有人", async () => {
	const steps: TraceStep[] = [];
	const tools = agentTools({
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
