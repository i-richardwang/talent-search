/**
 * 抽取：收窄规则，以及哪些段会去问端点。
 *
 * 收窄是这一步的全部判断力所在——模型多说一个字、把公司名当领域吐回来、同一个
 * 领域说两遍，都只丢那一条，不丢整段。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import type { ExperienceRow } from "#/corpus/pipeline";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { conform, extract, SYSTEM } = await import("#/corpus/extract");

/** 读了但什么都没读出来。 */
const EMPTY = { skills: [], did: [] };

const quiet = () => {};

function segment(row: Partial<ExperienceRow>): ExperienceRow {
	return {
		emp_id: "E1",
		kind: "external",
		start_date: "2019-01-01",
		end_date: "2020-01-01",
		org: "云枢智能",
		org_path: "",
		org_meta: null,
		title: "算法工程师",
		seq_l1: "",
		seq_l2: "",
		seq_l3: "",
		seq_inferred_l1: "",
		seq_inferred_l2: "",
		level: "",
		description: "",
		months: 12,
		...row,
	};
}

describe("参与方式", () => {
	test("每一种取值都写进了提示词", () => {
		for (const involvement of [
			"从零搭建",
			"负责建设",
			"优化改进",
			"参与执行",
			"带队管理",
		])
			assert.ok(SYSTEM.includes(involvement));
	});
});

describe("收窄", () => {
	test("短说法按顺序留下，全半角折叠后去重", () => {
		assert.deepEqual(
			conform(
				{
					skills: ["推荐算法", " Python ", "推荐算法", "Ｐｙｔｈｏｎ"],
					did: [],
				},
				"云枢智能",
			).skills,
			["推荐算法", "Python"],
		);
	});

	test("公司名和过长的说法一律丢掉", () => {
		const got = conform(
			{
				skills: [
					"云枢智能",
					"云枢智能的推荐",
					"推荐",
					"负责推荐系统召回与排序模型的迭代和上线",
				],
				did: [{ involvement: "负责建设", domain: "云枢智能" }],
			},
			"云枢智能",
		);
		assert.deepEqual(got.skills, ["推荐"]);
		assert.deepEqual(got.did, []);
	});

	test("参与方式不在那五种里就留领域、参与方式记空", () => {
		assert.deepEqual(
			conform(
				{
					skills: [],
					did: [
						{ involvement: "主导", domain: "推荐系统" },
						{ involvement: "", domain: "搜索系统" },
						{ involvement: "从零搭建", domain: "推荐系统" },
						"not an object",
					],
				},
				"",
			).did,
			[
				{ involvement: null, domain: "推荐系统" },
				{ involvement: null, domain: "搜索系统" },
			],
		);
	});

	test("同一个领域只留第一条：领域就是说法，边的主键容不下第二条", () => {
		assert.deepEqual(
			conform(
				{
					skills: [],
					did: [
						{ involvement: "从零搭建", domain: "推荐系统" },
						{ involvement: "优化改进", domain: "推荐系统" },
						{ involvement: "优化改进", domain: "搜索系统" },
					],
				},
				"",
			).did,
			[
				{ involvement: "从零搭建", domain: "推荐系统" },
				{ involvement: "优化改进", domain: "搜索系统" },
			],
		);
	});

	test("条数有上限", () => {
		const many = Array.from({ length: 30 }, (_, i) => `技能${i}`);
		assert.equal(conform({ skills: many, did: [] }, "").skills.length, 12);
	});

	test("格式不对的原话解析为空", () => {
		assert.deepEqual(conform("nope", ""), EMPTY);
		assert.deepEqual(conform({ skills: "Python" }, ""), EMPTY);
	});
});

describe("抽取哪些段", () => {
	test("只有入职前且写了描述的段会去问端点", async () => {
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return {
				skills: ["召回"],
				did: [{ involvement: "负责建设", domain: "推荐系统" }],
			};
		});
		const got = await extract(
			[
				segment({ kind: "internal", org: "平台技术部", description: "" }),
				segment({ description: "" }),
				segment({ description: "负责推荐系统召回" }),
			],
			quiet,
		);
		restore();

		assert.deepEqual(asked, [
			"岗位：算法工程师\n公司：云枢智能\n描述：负责推荐系统召回",
		]);
		// 没问的段是「没读过」，和模型没作答一样是 null，不是一份空抽取
		assert.deepEqual(got.slice(0, 2), [null, null]);
		assert.deepEqual(got[2], {
			skills: ["召回"],
			did: [{ involvement: "负责建设", domain: "推荐系统" }],
		});
	});

	test("第二次读缓存，而且是重新收窄一遍，不是把上次的结果存下来", async () => {
		const rows = [segment({ description: "负责风控策略搭建" })];
		let asked = 0;
		const restore = answerChat(() => {
			asked++;
			// 公司名混在里面：收窄每次都重新做，所以缓存里存的是模型的原话
			return { skills: ["风控", "云枢智能"], did: [] };
		});
		await extract(rows, quiet);
		const second = await extract(rows, quiet);
		restore();

		assert.equal(asked, 1);
		assert.deepEqual(second[0]?.skills, ["风控"]);
	});
});

test("模型失败与成功的空抽取保持可区分，失败不缓存", async () => {
	const rows = [segment({ description: "抽取状态合成样例" })];
	const bad = answerChat(() => ({ skills: "invalid", did: [] }));
	try {
		assert.deepEqual(await extract(rows, quiet), [null]);
	} finally {
		bad();
	}
	const empty = answerChat(() => ({ skills: [], did: [] }));
	try {
		assert.deepEqual(await extract(rows, quiet), [EMPTY]);
	} finally {
		empty();
	}
});
