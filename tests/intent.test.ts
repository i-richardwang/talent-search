/**
 * 查询理解的收窄。**不连数据库，也不调模型**——这正是把形状和调用拆开换到的
 * 东西：模型输出的每一种走样都能在这里测出来，而 `src/server/llm.ts` 里剩下的
 * 只有「发出去、拿回来」。
 *
 * 这里的每个用例都该读成一句「模型对着这句话这么写的时候，查询应该变成什么」。
 * 模型写的和库里存的是同一个形状（`Term[]`），所以这一层只剩词表检查和收窄。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	allDropped,
	intentSchema,
	toSpec,
	type Vocabulary,
} from "#/search/intent";
import type { Term } from "#/search/term";

const VOCAB: Vocabulary = {
	companyTag: ["头部互联网T1", "知名公司", "外包公司"],
	level: ["P5", "P6", "P7", "P8"],
	recruitment: ["校招", "社招"],
	education: ["本科", "硕士", "博士"],
};
const of = (...terms: unknown[]) => toSpec({ terms }, VOCAB).terms;
/** 模型写一条条件的最简写法。 */
const t = (field: string, values: string[], mode: unknown = "must") => ({
	field,
	mode,
	values,
});
const exp = (mode: Term["mode"], ...values: [string, ...string[]]): Term => ({
	field: "experience",
	mode,
	values,
});

describe("模型写出的查询就是查询", () => {
	test("算法和后端都做过的，比较资深的，最好是字节来的", () => {
		assert.deepEqual(
			of(
				t("experience", ["算法", "推荐算法", "机器学习"]),
				t("experience", ["后端", "后端开发", "服务端"]),
				t("level", ["P7", "P8"], "boost"),
				t("org", ["字节"], "boost"),
			),
			[
				exp("must", "算法", "推荐算法", "机器学习"),
				exp("must", "后端", "后端开发", "服务端"),
				{ field: "level", mode: "boost", values: ["P7", "P8"] },
				{ field: "org", mode: "boost", values: ["字节"] },
			],
		);
	});

	test("三档语气都翻译得出来；认不出的强度按必须算，不是丢掉这个词", () => {
		assert.deepEqual(
			of(
				t("experience", ["渠道运营"]),
				t("experience", ["带团队"], "boost"),
				t("experience", ["实习"], "exclude"),
				t("experience", ["产品"], "很重要"),
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
		assert.deepEqual(of(t("experience", [" 推荐算法 ", "机器 学习"])), [
			exp("must", "推荐算法", "机器 学习"),
		]);
	});
});

/**
 * 范围维度的取值必须在词表里。模型是唯一会写出词表外取值的来源：「资深」对不上
 * 任何一档职级。对不上的丢掉，一个不剩的条件整条消失——不解释。
 */
describe("范围只认库里真有的取值", () => {
	test("公司档、职级、招聘渠道、学历必须来自语料，凭常识造的词一律不认", () => {
		assert.deepEqual(
			of(
				t("level", ["资深", "P7"]),
				t("companyTag", ["一线大厂"]),
				t("recruitment", ["社招"]),
				t("education", ["研究生"]),
			),
			[
				{ field: "level", mode: "must", values: ["P7"] },
				{ field: "recruitment", mode: "must", values: ["社招"] },
			],
		);
	});

	test("经历类型只有两种；最短时长是任意正整数月数，不是分面那四个档", () => {
		// 这两维没有词表，但取值得是这一维读得回来的（收窄那一层查，见 term.test）：
		// 模型写「三年」「校招」的话，那条不能带着 chip 落库却不筛任何人
		assert.deepEqual(
			of(
				t("kind", ["external"]),
				t("minMonths", ["18"]),
				t("kind", ["校招"]),
				t("minMonths", ["三年"]),
			),
			[
				{ field: "kind", mode: "must", values: ["external"] },
				{ field: "minMonths", mode: "must", values: ["18"] },
			],
		);
	});

	test("公司名与学校名就是名字，只剥空白", () => {
		assert.deepEqual(of(t("org", [" 字节 "]), t("school", ["清华", "北大"])), [
			{ field: "org", mode: "must", values: ["字节"] },
			{ field: "school", mode: "must", values: ["清华", "北大"] },
		]);
	});

	test("范围上的排除没有表示，整条丢掉", () => {
		assert.deepEqual(of(t("recruitment", ["校招"], "exclude")), []);
	});

	test("库里没有的维度整条丢掉：搜索产品对说不清的条件不解释", () => {
		assert.deepEqual(
			of(
				t("city", ["北京"]),
				t("unsupported", ["北京"]),
				t("experience", ["算法"]),
			),
			[exp("must", "算法")],
		);
	});
});

describe("模型给了条件、收窄后一个不剩", () => {
	test("是这一跳失败，不是一句没有条件的话", () => {
		for (const raw of [
			{ terms: [t("level", ["资深"]), t("city", ["北京"])] },
			{ terms: [t("minMonths", ["三年"])] },
		])
			assert.equal(allDropped(raw, toSpec(raw, VOCAB)), true);
		assert.equal(
			allDropped({ terms: [] }, toSpec({ terms: [] }, VOCAB)),
			false,
		);
	});

	test("只识别出范围或偏好不算失败：各自是一份完整的查询", () => {
		for (const raw of [
			{ terms: [t("kind", ["external"])] },
			{ terms: [t("org", ["字节"], "boost")] },
		])
			assert.equal(allDropped(raw, toSpec(raw, VOCAB)), false);
	});
});

describe("模型是不可信输入", () => {
	test("什么形状都不该抛", () => {
		for (const raw of [
			null,
			undefined,
			0,
			"",
			{},
			"一句话",
			[42],
			{ terms: 1 },
		])
			assert.deepEqual(toSpec(raw, VOCAB).terms, [], JSON.stringify(raw));
	});

	test("数组里混进垃圾只丢那一项，其余照常", () => {
		assert.deepEqual(
			of(null, 42, "算法", { field: "experience" }, t("experience", ["算法"])),
			[exp("must", "算法")],
		);
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		assert.ok(
			intentSchema.safeParse({
				terms: [
					t("experience", ["渠道运营", "渠道拓展"]),
					t("minMonths", ["12"]),
					t("org", ["字节"], "boost"),
				],
			}).success,
		);
	});

	test("词表不进 schema：取值合不合法由收窄查，不让整句作废", () => {
		assert.ok(
			intentSchema.safeParse({ terms: [t("companyTag", ["一线大厂"])] })
				.success,
		);
	});

	test("词数与词长上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 termsOf / termOf，toSpec 会走它们收窄。写成 schema
		// 约束就是第二份契约：模型多给一条，整条响应作废、整句理解失败。
		assert.ok(
			intentSchema.safeParse({
				terms: Array.from({ length: 20 }, (_, i) =>
					t("experience", [`条件${i}`]),
				),
			}).success,
		);
		const long = "供应链金融风控建模";
		assert.ok(
			intentSchema.safeParse({ terms: [t("experience", [long])] }).success,
		);
		assert.deepEqual(of(t("experience", ["算".repeat(25)])), []);
		assert.deepEqual(of(t("experience", [long])), [exp("must", long)]);
	});
});
