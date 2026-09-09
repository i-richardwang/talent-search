/**
 * 查询理解的收窄。**不连数据库，也不调模型**——这正是把形状和调用拆开换到的
 * 东西：模型输出的每一种走样都能在这里测出来，而 `src/server/llm.ts` 里剩下的
 * 只有「发出去、拿回来」。
 *
 * 这里的每个用例都该读成一句「模型对着这句话这么说的时候，查询应该变成什么」。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	allDropped,
	intentSchema,
	toSpec,
	type Vocabulary,
} from "#/search/intent";
import { unsupportedOf } from "#/search/spec";

const VOCAB: Vocabulary = {
	companyTag: ["头部互联网T1", "知名公司", "外包公司"],
	level: ["P5", "P6", "P7", "P8"],
	recruitment: ["校招", "社招"],
	education: ["本科", "硕士", "博士"],
};
const of = (sentence: string, ...items: unknown[]) =>
	toSpec({ items }, sentence, VOCAB);
const chipsOf = (sentence: string, ...items: unknown[]) =>
	of(sentence, ...items).requirements;
/** 收窄之后的一个说法。 */
const said = (text: string) => ({ text, tier: "said" as const });
/** 模型说一个片段的最简写法。 */
const item = (
	said: string,
	is: string,
	rest: Partial<{
		mode: unknown;
		value: unknown;
		anyOf: unknown;
		variants: unknown;
	}> = {},
) => ({
	said,
	is,
	mode: "must",
	value: null,
	anyOf: [],
	variants: [],
	...rest,
});
const req = (said: string, mode: unknown = "must") =>
	item(said, "requirement", { mode });

describe("那句话里的三种东西", () => {
	test("算法和后端都做过的，比较资深的，最好是字节来的", () => {
		const spec = of(
			"算法和后端都做过的，比较资深的，最好是字节来的",
			item("算法", "requirement", {
				variants: [{ text: "推荐算法", tier: "near" }],
			}),
			req("后端"),
			item("资深", "level"),
			item("字节", "org", { mode: "boost" }),
		);
		assert.deepEqual(spec, {
			requirements: [
				{
					members: [said("算法"), { text: "推荐算法", tier: "near" }],
					mode: "must",
				},
				{ members: [said("后端")], mode: "must" },
			],
			scope: {},
			// 「最好」是偏好，不裁人
			prefer: { org: "字节" },
			// 「资深」对不上任何一档职级：带着原话降成没处放的条件，不安静消失
			notices: [{ kind: "unsupported", text: "资深" }],
		});
	});

	test("三档语气都翻译得出来", () => {
		assert.deepEqual(
			chipsOf(
				"做过渠道运营，最好带过团队，不要实习",
				req("渠道运营"),
				req("团队", "boost"),
				req("实习", "exclude"),
			),
			[
				{ members: [said("渠道运营")], mode: "must" },
				{ members: [said("团队")], mode: "boost" },
				{ members: [said("实习")], mode: "exclude" },
			],
		);
	});

	test("认不出的强度按必须算，不是丢掉这个词", () => {
		// 丢掉会静默放宽 AND 语义，而屏幕上看不出哪个条件被吃了。当成必须最多是
		// 收得太紧，那是看得见、点得掉的。
		assert.deepEqual(chipsOf("风控", req("风控", "很重要")), [
			{ members: [said("风控")], mode: "must" },
		]);
	});
});

describe("said 必须是句子里的字", () => {
	test("说了句子里没有的词，整个片段丢掉", () => {
		assert.deepEqual(chipsOf("做过算法的人", req("推荐算法")), []);
		assert.deepEqual(of("做过算法的人", item("清华", "school")).scope, {});
	});

	test("照抄的口径：空白和大小写不算改字", () => {
		assert.deepEqual(chipsOf("做过 BD 的", req("bd")), [
			{ members: [said("bd")], mode: "must" },
		]);
		assert.deepEqual(chipsOf("三 年 以上", req("三年以上")), [
			{ members: [said("三年以上")], mode: "must" },
		]);
	});

	test("一段原话只能被认领一次，先出现的赢", () => {
		// 「字节」既是公司又是学校，第二个不是理解，是复读
		const spec = of(
			"最好是字节来的",
			item("字节", "org"),
			item("字节", "school"),
			req("字节"),
		);
		assert.deepEqual(spec.scope, { org: "字节" });
		assert.deepEqual(spec.requirements, []);
	});

	test("「或」的另几个说法同样得是原话", () => {
		assert.deepEqual(
			chipsOf(
				"大模型或推荐系统方向",
				item("大模型", "requirement", { anyOf: ["推荐系统", "搜索"] }),
			),
			[{ members: [said("大模型"), said("推荐系统")], mode: "must" }],
		);
	});
});

describe("每个词都过一遍同一道边界", () => {
	test("模型给的字面原样保留：改写发生在哪里都是一次看不见的查询变更", () => {
		assert.deepEqual(
			chipsOf("不要 安全与风险合规 ", req(" 安全与风险合规 ", "exclude")),
			[{ members: [said("安全与风险合规")], mode: "exclude" }],
		);
	});

	test("空白和单字不是说法，直接消失", () => {
		assert.deepEqual(chipsOf("的  ", req("的"), req("  ")), []);
	});

	test("变体带着来源落到用户说法后面；垃圾丢掉，其余原样", () => {
		assert.deepEqual(
			chipsOf(
				"算法",
				item("算法", "requirement", {
					variants: [
						{ text: "推荐算法", tier: "near" },
						{ text: "  ", tier: "same" },
						7,
						// 模型把一个变体标成 said 就是在认领原话：形状里没有这一档
						{ text: "算法工程师", tier: "said" },
						{ text: "算法工程", tier: "same" },
					],
				}),
			),
			[
				{
					members: [
						said("算法"),
						{ text: "推荐算法", tier: "near" },
						{ text: "算法工程", tier: "same" },
					],
					mode: "must",
				},
			],
		);
	});
});

describe("范围只认库里真有的取值", () => {
	const S = "入职前 24 个月 知名公司 P7 校招 硕士 一线大厂 总监 内推 大专";

	test("经历类型只有两种", () => {
		assert.equal(
			of(S, item("入职前", "kind", { value: "external" })).scope.kind,
			"external",
		);
		// 对不上的取值降成没处放的条件，带着原话
		const spec = of(S, item("入职前", "kind", { value: "外部" }));
		assert.equal(spec.scope.kind, undefined);
		assert.deepEqual(unsupportedOf(spec), ["入职前"]);
	});

	test("最短时长是任意正整数月数，不是分面那四个档", () => {
		for (const months of ["24", "18", "30"])
			assert.equal(
				of(S, item("24 个月", "minMonths", { value: months })).scope.minMonths,
				Number(months),
			);
		for (const bad of ["-12", "0", "1.5", "半年", null])
			assert.equal(
				of(S, item("24 个月", "minMonths", { value: bad })).scope.minMonths,
				undefined,
				`minMonths=${String(bad)}`,
			);
	});

	test("公司档、职级、招聘渠道、学历必须来自语料，凭常识造的词一律不认", () => {
		const { scope } = of(
			S,
			item("知名公司", "companyTag", { value: "知名公司" }),
			item("P7", "level", { value: "P7" }),
			item("校招", "recruitment", { value: "校招" }),
			item("硕士", "education", { value: "硕士" }),
		);
		// 模型一维只给一个值，落到记录上是这一维的一项——范围和筛选是同一批
		// 维度的两种生命周期，形状因此相同（`dimensions.ts` 的 `Picked`）。
		assert.deepEqual(scope, {
			companyTag: ["知名公司"],
			level: ["P7"],
			recruitment: ["校招"],
			education: ["硕士"],
		});
		// 造出来的档筛不到任何人：不进范围，原话进「没处放的条件」
		const made = of(
			S,
			item("一线大厂", "companyTag", { value: "一线大厂" }),
			item("总监", "level", { value: "总监" }),
			item("内推", "recruitment", { value: "内推" }),
			item("大专", "education", { value: "大专" }),
		);
		assert.deepEqual(made.scope, {});
		assert.deepEqual(unsupportedOf(made), ["一线大厂", "总监", "内推", "大专"]);
	});

	test("公司名与学校名就是原话，只剥空白", () => {
		const { scope } = of(
			"待过字节，清华毕业",
			item(" 字节 ", "org"),
			item("清华", "school"),
		);
		assert.deepEqual(scope, { org: "字节", school: "清华" });
	});

	test("偏好的范围另放一栏，同一批维度", () => {
		const spec = of(
			"最好是校招进来的，最好待过大厂",
			item("校招", "recruitment", { mode: "boost", value: "校招" }),
			item("大厂", "companyTag", { mode: "boost", value: "头部互联网T1" }),
		);
		assert.deepEqual(spec.scope, {});
		assert.deepEqual(spec.prefer, {
			recruitment: ["校招"],
			companyTag: ["头部互联网T1"],
		});
	});

	test("范围上的排除没有表示，降成没处放的条件", () => {
		const spec = of("不要字节的", item("字节", "org", { mode: "exclude" }));
		assert.deepEqual(spec.scope, {});
		assert.deepEqual(unsupportedOf(spec), ["字节"]);
	});

	test("没说的维度不出现", () => {
		assert.deepEqual(of("算法", req("算法")).scope, {});
		assert.equal(of("算法", req("算法")).prefer, undefined);
	});
});

describe("没处放的条件", () => {
	test("原样带出来，去重、剥空白", () => {
		const spec = of(
			"北京 北京 35 岁以下",
			item("北京", "unsupported"),
			item(" 北京", "unsupported"),
			item("35 岁以下", "unsupported"),
			item("", "unsupported"),
		);
		assert.deepEqual(unsupportedOf(spec), ["北京", "35 岁以下"]);
	});

	test("认不出的种类当没处放的条件，不当要求", () => {
		const spec = of("北京", item("北京", "地点"));
		assert.deepEqual(spec.requirements, []);
		assert.deepEqual(unsupportedOf(spec), ["北京"]);
	});
});

describe("模型给了片段、收窄后一个不剩", () => {
	test("是这一跳失败，不是一句没有条件的话", () => {
		const raw = { items: [req("推荐算法")] };
		assert.ok(allDropped(raw, toSpec(raw, "做过算法的人", VOCAB)));
	});

	test("只识别出范围、偏好或不支持条件不算失败：各自是一份完整的理解", () => {
		for (const raw of [
			{ items: [item("入职前", "kind", { value: "external" })] },
			{ items: [item("字节", "org", { mode: "boost" })] },
			{ items: [item("北京", "unsupported")] },
			{ items: [item("资深", "level")] },
			{ items: [] },
		])
			assert.ok(
				!allDropped(raw, toSpec(raw, "入职前 字节 北京 资深", VOCAB)),
				JSON.stringify(raw),
			);
	});
});

describe("模型是不可信输入", () => {
	test("什么形状都不该抛", () => {
		for (const raw of [null, undefined, 0, "", [], "一句话", { items: 42 }]) {
			assert.deepEqual(
				toSpec(raw, "一句话", VOCAB),
				{ requirements: [], scope: {}, notices: [] },
				`${JSON.stringify(raw)} 应当被当成没填`,
			);
		}
	});

	test("数组里混进垃圾只丢那一项，其余照常", () => {
		assert.deepEqual(
			chipsOf("算法", null, { said: 123 }, req("算法"), "算法"),
			[{ members: [said("算法")], mode: "must" }],
		);
	});

	test("绕过 schema 直接传入时也只收约定数量", () => {
		const words = Array.from({ length: 12 }, (_, i) => `条件${i}`);
		assert.equal(
			chipsOf(words.join(" "), ...words.map((w) => req(w))).length,
			8,
		);
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		assert.ok(
			intentSchema.safeParse({
				items: [
					item("渠道运营", "requirement", {
						variants: [{ text: "渠道拓展", tier: "near" }],
					}),
					item("一年以上", "minMonths", { value: "12" }),
					item("字节", "org", { mode: "boost" }),
					item("北京", "unsupported"),
				],
			}).success,
		);
	});

	test("词表不进 schema：取值合不合法由收窄查，不让整句作废", () => {
		assert.ok(
			intentSchema.safeParse({
				items: [item("大厂", "companyTag", { value: "一线大厂" })],
			}).success,
		);
	});

	test("词数与词长上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 requirementsOf / termOf，toSpec 会走它们收窄。写成 schema
		// 约束就是第二份契约：模型多给一条，整条响应作废、整句理解失败。
		assert.ok(
			intentSchema.safeParse({
				items: Array.from({ length: 9 }, (_, i) => req(`条件${i}`)),
			}).success,
		);
		const long = "供应链金融风控建模";
		assert.ok(intentSchema.safeParse({ items: [req(long)] }).success);
		assert.deepEqual(chipsOf("算".repeat(25), req("算".repeat(25))), []);
		assert.deepEqual(chipsOf(long, req(long)), [
			{ members: [said(long)], mode: "must" },
		]);
	});
});
