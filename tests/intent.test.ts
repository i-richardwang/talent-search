/**
 * 查询理解的收窄。**不连数据库，也不调模型**——这正是把形状和调用拆开换到的
 * 东西：模型输出的每一种走样都能在这里测出来，而 `src/server/llm.ts` 里剩下的
 * 只有「发出去、拿回来」。
 *
 * 这里的每个用例都该读成一句「模型对着这句话这么写的时候，查询应该变成什么」。
 * 模型写的和库里存的是同一个形状（`Condition[]`），所以这一层只剩词表检查和收窄。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Condition, Mode } from "#/search/condition";
import {
	allDropped,
	intentSchema,
	toSpec,
	type Vocabulary,
} from "#/search/intent";
import { claim as build } from "./conditions";

const VOCAB: Vocabulary = {
	companyTag: ["头部互联网T1", "知名公司", "外包公司"],
	level: ["P5", "P6", "P7", "P8"],
	recruitment: ["校招", "社招"],
	education: ["本科", "硕士", "博士"],
};
const of = (...conditions: unknown[]) =>
	toSpec({ conditions }, VOCAB).conditions;
/** 模型写一条经历主张的最简写法。 */
const claim = (parts: Record<string, unknown>, mode: unknown = "must") => ({
	about: "experience",
	mode,
	...parts,
});
/** 模型写一条人的条件的最简写法。 */
const person = (field: string, values: string[], mode: unknown = "must") => ({
	about: "person",
	mode,
	field,
	values,
});
const exp = (mode: Mode, ...what: [string, ...string[]]): Condition =>
	build(what, { mode });

describe("模型写出的查询就是查询", () => {
	test("算法和后端都做过的，比较资深的，最好是字节来的", () => {
		assert.deepEqual(
			of(
				claim({ what: ["算法", "推荐算法", "机器学习"] }),
				claim({ what: ["后端", "后端开发", "服务端"] }),
				person("level", ["P7", "P8"], "boost"),
				claim({ org: ["字节"] }, "boost"),
			),
			[
				exp("must", "算法", "推荐算法", "机器学习"),
				exp("must", "后端", "后端开发", "服务端"),
				{
					about: "person",
					mode: "boost",
					field: "level",
					values: ["P7", "P8"],
				},
				{ about: "experience", mode: "boost", org: ["字节"] },
			],
		);
	});

	test("入职前在大厂做过三年以上增长，不要实习：修饰语挂在同一条主张上", () => {
		assert.deepEqual(
			of(
				claim({
					what: ["增长", "用户增长"],
					kind: "external",
					companyTag: ["头部互联网T1"],
					minMonths: 36,
				}),
				claim({ what: ["实习"] }, "exclude"),
			),
			[
				{
					about: "experience",
					mode: "must",
					what: ["增长", "用户增长"],
					companyTag: ["头部互联网T1"],
					kind: "external",
					minMonths: 36,
				},
				exp("exclude", "实习"),
			],
		);
	});

	test("三档语气都翻译得出来；认不出的强度按必须算，不是丢掉这个词", () => {
		assert.deepEqual(
			of(
				claim({ what: ["渠道运营"] }),
				claim({ what: ["带团队"] }, "boost"),
				claim({ what: ["实习"] }, "exclude"),
				claim({ what: ["产品"] }, "很重要"),
			),
			[
				exp("must", "渠道运营"),
				exp("boost", "带团队"),
				exp("exclude", "实习"),
				exp("must", "产品"),
			],
		);
	});

	test("搜索词是模型的表达，不要求是用户原话：只做边界，不改字", () => {
		assert.deepEqual(of(claim({ what: [" 推荐算法 ", "机器 学习"] })), [
			exp("must", "推荐算法", "机器 学习"),
		]);
	});
});

/**
 * 词表维的取值必须在词表里。模型是唯一会写出词表外取值的来源：「资深」对不上
 * 任何一档职级。对不上的丢掉，一项不剩的整项消失——不解释。
 */
describe("词表维只认库里真有的取值", () => {
	test("公司档、职级、招聘渠道、学历必须来自语料，凭常识造的词一律不认", () => {
		assert.deepEqual(
			of(
				person("level", ["资深", "P7"]),
				claim({ what: ["增长"], companyTag: ["一线大厂"] }),
				claim({ companyTag: ["一线大厂"] }),
				person("recruitment", ["社招"]),
				person("education", ["研究生"]),
			),
			[
				{ about: "person", mode: "must", field: "level", values: ["P7"] },
				// 公司档没对上，主张剩下经历词照常；只有公司档的主张整条消失
				exp("must", "增长"),
				{
					about: "person",
					mode: "must",
					field: "recruitment",
					values: ["社招"],
				},
			],
		);
	});

	test("人的条件上的排除没有表示，整条丢掉", () => {
		assert.deepEqual(of(person("recruitment", ["校招"], "exclude")), []);
	});

	test("库里没有的维度整条丢掉：搜索产品对说不清的条件不解释", () => {
		assert.deepEqual(
			of(
				person("city", ["北京"]),
				{ about: "location", values: ["北京"] },
				claim({ what: ["算法"] }),
			),
			[exp("must", "算法")],
		);
	});
});

describe("模型给了条件、收窄后一个不剩", () => {
	test("收窄后一条不剩算这次理解失败", () => {
		for (const raw of [
			{ conditions: [person("level", ["资深"]), person("city", ["北京"])] },
			{ conditions: [claim({ minMonths: "三年" })] },
		])
			assert.equal(allDropped(raw, toSpec(raw, VOCAB)), true);
		assert.equal(
			allDropped({ conditions: [] }, toSpec({ conditions: [] }, VOCAB)),
			false,
		);
	});

	test("只识别出没有经历词的主张或人的偏好不算失败：各自是一份完整的查询", () => {
		for (const raw of [
			{ conditions: [claim({ kind: "external" })] },
			{ conditions: [claim({ org: ["字节"] }, "boost")] },
			{ conditions: [person("education", ["硕士"], "boost")] },
		])
			assert.equal(allDropped(raw, toSpec(raw, VOCAB)), false);
	});
});

describe("模型是不可信输入", () => {
	test("任何形状的输入都不抛错", () => {
		for (const raw of [
			null,
			undefined,
			0,
			"",
			{},
			"一句话",
			[42],
			{ conditions: 1 },
		])
			assert.deepEqual(toSpec(raw, VOCAB).conditions, [], JSON.stringify(raw));
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		assert.ok(
			intentSchema.safeParse({
				conditions: [
					claim({ what: ["渠道运营", "渠道拓展"], minMonths: 12 }),
					claim({ org: ["字节"] }, "boost"),
					person("level", ["P7"], "boost"),
				],
			}).success,
		);
	});

	test("词表不进 schema：取值合不合法由收窄查，不让整句作废", () => {
		assert.ok(
			intentSchema.safeParse({
				conditions: [claim({ companyTag: ["一线大厂"] })],
			}).success,
		);
	});

	test("词数与词长上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 conditionsOf / termOf，toSpec 会走它们收窄。写成 schema
		// 约束就是第二份契约：模型多给一条，整条响应作废、整句理解失败。
		assert.ok(
			intentSchema.safeParse({
				conditions: Array.from({ length: 20 }, (_, i) =>
					claim({ what: [`条件${i}`] }),
				),
			}).success,
		);
		const long = "供应链金融风控建模";
		assert.ok(
			intentSchema.safeParse({ conditions: [claim({ what: [long] })] }).success,
		);
		assert.deepEqual(of(claim({ what: ["算".repeat(25)] })), []);
		assert.deepEqual(of(claim({ what: [long] })), [exp("must", long)]);
	});
});
