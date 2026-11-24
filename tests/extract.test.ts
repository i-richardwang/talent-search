/**
 * 抽取：校验规则，以及哪些段会去问端点。
 *
 * 校验是这一步的全部判断力所在——模型多说一个字、把公司名当能力返回、同一个
 * 词说两遍、给出三档以外的档，都只处理那一条，不丢整段。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import type { ExperienceRow } from "#/corpus/pipeline";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { conform, extract, SYSTEM } = await import("#/corpus/extract");

/** 读了但什么都没读出来。 */
const EMPTY = { items: [] };

const quiet = () => {};

function segment(row: Partial<ExperienceRow>): ExperienceRow {
	return {
		emp_id: "E1",
		kind: "external",
		unemployed: false,
		start_date: "2019-01-01",
		end_date: "2020-01-01",
		company: "云枢智能",
		department: "",
		department_path: "",
		company_meta: null,
		title: "算法工程师",
		seq_l1: "",
		seq_l2: "",
		seq_l3: "",
		level: "",
		description: "",
		months: 12,
		...row,
	};
}

describe("投入档", () => {
	test("三档都写进了提示词", () => {
		for (const depth of ["主导", "做过", "提到"])
			assert.ok(SYSTEM.includes(depth));
	});
});

/** 只写词时档是「做过」，省得每条都写。 */
const answer = (...items: (string | { text: string; depth: string })[]) => ({
	items: items.map((one) =>
		typeof one === "string" ? { text: one, depth: "做过" } : one,
	),
});
const texts = (raw: unknown, company = "") =>
	conform(raw, segment({ company })).items.map((one) => one.text);

describe("校验", () => {
	test("短说法按顺序留下，全半角折叠后去重", () => {
		assert.deepEqual(
			texts(
				answer("推荐算法", " Python ", "推荐算法", "Ｐｙｔｈｏｎ"),
				"云枢智能",
			),
			["推荐算法", "Python"],
		);
	});

	test("公司名和复述原文的长句不进入能力词", () => {
		assert.deepEqual(
			texts(
				answer(
					"云枢智能",
					"云枢智能的推荐",
					"推荐",
					"负责推荐系统召回与排序模型的迭代和上线",
				),
				"云枢智能",
			),
			["推荐"],
		);
	});

	test("档不在三档里就留词、档记空", () => {
		assert.deepEqual(
			conform(
				{
					items: [
						{ text: "推荐系统", depth: "负责建设" },
						{ text: "搜索系统", depth: "" },
						{ text: "排序模型" },
						"not an object",
					],
				},
				segment({}),
			).items,
			[
				{ text: "推荐系统", engagement: null },
				{ text: "搜索系统", engagement: null },
				{ text: "排序模型", engagement: null },
			],
		);
	});

	test("原文长名称只占剩余名额，不挤掉排在后面的短能力词", () => {
		const name = "Example Cloud Toolkit";
		const source = segment({ description: `用 ${name} 完成部署` });
		const skills = Array.from({ length: 30 }, (_, i) => `测试能力${i}`);
		for (const short of [skills, skills.slice(1)]) {
			const { items } = conform(answer(name, ...short), source);
			assert.deepEqual(
				items.map((item) => item.text),
				short.length === 30 ? short : [...short, name],
			);
		}
	});

	test("长英文名即使在原文出现，也要排除包含公司的写法", () => {
		const name = "Northwind Workflow Tools";
		assert.deepEqual(
			conform(
				answer(name),
				segment({
					company: "ＮＯＲＴＨＷＩＮＤ",
					description: `维护 ${name}。`,
				}),
			),
			EMPTY,
		);
	});

	test("名额已满时，短词和原文长名都保留重复项里最深的投入档", () => {
		for (const prefix of ["合成能力", "Synthetic Tool Name "]) {
			const names = Array.from({ length: 31 }, (_, i) => prefix + i);
			const first = `${prefix}0`;
			const { items } = conform(
				answer(...names, { text: first, depth: "主导" }),
				segment({ description: names.join("，") }),
			);
			assert.deepEqual(
				items.map(({ text }) => text),
				names.slice(0, 30),
			);
			assert.deepEqual(items[0], { text: first, engagement: "主导" });
		}
	});

	test("同一个词只留一条，档取最深的那次", () => {
		assert.deepEqual(
			conform(
				answer(
					{ text: "推荐系统", depth: "做过" },
					{ text: "搜索系统", depth: "提到" },
					{ text: "推荐系统", depth: "主导" },
					{ text: "搜索系统", depth: "无效" },
					{ text: "推荐系统", depth: "提到" },
				),
				segment({}),
			).items,
			[
				{ text: "推荐系统", engagement: "主导" },
				{ text: "搜索系统", engagement: "提到" },
			],
		);
	});

	test("格式不对的原话解析为空", () => {
		assert.deepEqual(conform("nope", segment({})), EMPTY);
		assert.deepEqual(conform({ items: "Python" }, segment({})), EMPTY);
	});
});

describe("抽取哪些段", () => {
	test("保留岗位与描述里有依据的英文长名称，排除公司名、标识符片段与原文长句", async () => {
		const row = segment({
			title: "Example Cloud Toolkit 工程师",
			company: "Northwind Test Systems",
			description:
				"用Ｓｐｒｉｎｇ Cloud Alibaba 开发服务，维护 CustomDiagnosticAdapterPro。团队口号是 we deliver all projects on time。",
		});
		const restore = answerChat(() =>
			answer(
				"Example Cloud Toolkit",
				"SpringCloudAlibaba",
				"CustomDiagnosticAdapter",
				"Northwind Test Systems",
				"Unlisted Data Tools",
				"we deliver all projects on time",
			),
		);
		try {
			assert.deepEqual(await extract([row], quiet), [
				{
					status: "done",
					value: {
						items: [
							{ text: "Example Cloud Toolkit", engagement: "做过" },
							{ text: "SpringCloudAlibaba", engagement: "做过" },
						],
					},
				},
			]);
		} finally {
			restore();
		}
	});
	test("只有入职前且写了描述的段会去问端点", async () => {
		const asked: string[] = [];
		const restore = answerChat((_system, prompt) => {
			asked.push(prompt);
			return answer({ text: "推荐系统", depth: "主导" }, "召回");
		});
		const got = await extract(
			[
				segment({
					kind: "internal",
					unemployed: false,
					company: "",
					department: "平台技术部",
					description: "",
				}),
				segment({ description: "" }),
				segment({ description: "负责推荐系统召回" }),
			],
			quiet,
		);
		restore();

		assert.deepEqual(asked, [
			"岗位：算法工程师\n公司：云枢智能\n描述：负责推荐系统召回",
		]);
		// 无需抽取的段与失败段有不同状态。
		assert.deepEqual(got.slice(0, 2), [
			{ status: "skipped" },
			{ status: "skipped" },
		]);
		assert.deepEqual(got[2], {
			status: "done",
			value: {
				items: [
					{ text: "推荐系统", engagement: "主导" },
					{ text: "召回", engagement: "做过" },
				],
			},
		});
	});

	test("第二次读缓存，而且是重新校验一遍，不是把上次的结果存下来", async () => {
		const rows = [segment({ description: "负责风控策略搭建" })];
		let asked = 0;
		const restore = answerChat(() => {
			asked++;
			// 公司名混在里面：校验每次都重新做，所以缓存里存的是模型的原话
			return answer("风控", "云枢智能");
		});
		await extract(rows, quiet);
		const second = await extract(rows, quiet);
		restore();

		assert.equal(asked, 1);
		assert.deepEqual(second[0], {
			status: "done",
			value: { items: [{ text: "风控", engagement: "做过" }] },
		});
	});
});

test("模型失败与成功的空抽取保持可区分，失败不缓存", async () => {
	const rows = [segment({ description: "抽取状态合成样例" })];
	const bad = answerChat(() => ({ items: "invalid" }));
	try {
		assert.deepEqual(await extract(rows, quiet), [{ status: "failed" }]);
	} finally {
		bad();
	}
	const empty = answerChat(() => ({ items: [] }));
	try {
		assert.deepEqual(await extract(rows, quiet), [
			{ status: "done", value: EMPTY },
		]);
	} finally {
		empty();
	}
});
