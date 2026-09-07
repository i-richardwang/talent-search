/**
 * 查询理解的收窄。**不连数据库，也不调模型**——这正是把形状和调用拆开换到的
 * 东西：模型输出的每一种走样都能在这里测出来，而 `src/server/llm.ts` 里剩下的
 * 只有「发出去、拿回来」。
 *
 * 这里的每个用例都该读成一句「模型这么说的时候，查询应该变成什么」。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { intentSchema, toSpec, type Vocabulary } from "#/search/intent";
import { unsupportedOf } from "#/search/spec";

const VOCAB: Vocabulary = {
	companyTag: ["头部互联网T1", "知名公司", "外包公司"],
	level: ["P5", "P6", "P7", "P8"],
	recruitment: ["校招", "社招"],
	education: ["本科", "硕士", "博士"],
};
const of = (raw: unknown) => toSpec(raw, VOCAB);
const chipsOf = (raw: unknown) => of(raw).requirements;
const terms = (...ts: unknown[]) => ({ terms: ts });
const said = (text: string) => ({ text, tier: "said" as const });
/** 模型给一条要求的最简写法：一个用户说法，配一档强度 */
const one = (text: string, mode: unknown = "must") => ({
	members: [said(text)],
	mode,
});
/** 一份只有筛选的合法输出，逐项覆盖 */
const NONE = {
	terms: [],
	kind: null,
	minMonths: null,
	companyTag: null,
	level: null,
	recruitment: null,
	education: null,
	org: null,
	school: null,
	unsupported: [],
};

describe("强度", () => {
	test("三档语气都翻译得出来", () => {
		const evidence = chipsOf(
			terms(one("渠道运营"), one("团队管理", "boost"), one("实习", "exclude")),
		);
		assert.deepEqual(evidence, [
			{ members: [said("渠道运营")], mode: "must" },
			{ members: [said("团队管理")], mode: "boost" },
			{ members: [said("实习")], mode: "exclude" },
		]);
	});

	test("认不出的强度按必须算，不是丢掉这个词", () => {
		// 丢掉会静默放宽 AND 语义（少一个约束，结果集变大），而屏幕上看不出
		// 哪个条件被吃了。当成必须最多是收得太紧，那是看得见、点得掉的。
		const evidence = chipsOf(terms(one("风控", "很重要")));
		assert.deepEqual(evidence, [{ members: [said("风控")], mode: "must" }]);
	});
});

describe("每个词都过一遍同一道边界", () => {
	test("模型给的字面原样保留：改写发生在哪里都是一次看不见的查询变更", () => {
		const evidence = chipsOf(terms(one(" 安全与风险合规 ", "exclude")));
		assert.deepEqual(evidence, [
			{ members: [said("安全与风险合规")], mode: "exclude" },
		]);
	});

	test("空白和单字不是说法，直接消失", () => {
		const evidence = chipsOf(terms(one("的"), one("  ")));
		assert.deepEqual(evidence, []);
	});

	test("同一个词只留一枚，先出现的强度算数", () => {
		const evidence = chipsOf(terms(one("算法"), one("算法", "boost")));
		assert.deepEqual(evidence, [{ members: [said("算法")], mode: "must" }]);
	});

	test("用户说了「或」的几个说法是同一条要求的几个 said，不拆成两条都要", () => {
		const evidence = chipsOf(
			terms({ members: [said("大模型"), said("推荐系统")], mode: "must" }),
		);
		assert.deepEqual(evidence, [
			{ members: [said("大模型"), said("推荐系统")], mode: "must" },
		]);
	});

	test("模型补的变体带着来源落到用户说法后面；垃圾丢掉，其余原样", () => {
		const evidence = chipsOf(
			terms({
				members: [
					{ text: "推荐算法", tier: "near" },
					said("算法"),
					{ text: "  ", tier: "same" },
					7,
					{ text: "算法工程", tier: "same" },
				],
				mode: "must",
			}),
		);
		assert.deepEqual(evidence, [
			{
				members: [
					said("算法"),
					{ text: "推荐算法", tier: "near" },
					{ text: "算法工程", tier: "same" },
				],
				mode: "must",
			},
		]);
	});
});

describe("筛选只认库里真有的取值", () => {
	test("经历类型只有两种", () => {
		assert.equal(of({ ...NONE, kind: "external" }).scope.kind, "external");
		assert.equal(of({ ...NONE, kind: "外部" }).scope.kind, undefined);
	});

	test("最短时长是任意正整数月数，不是分面那四个档", () => {
		assert.equal(of({ ...NONE, minMonths: 24 }).scope.minMonths, 24);
		// 分面那四个档是桶，不是这一维的值域（见 `MIN_MONTHS_BUCKETS`）。
		assert.equal(of({ ...NONE, minMonths: 18 }).scope.minMonths, 18);
		assert.equal(of({ ...NONE, minMonths: 30 }).scope.minMonths, 30);
	});

	test("月数不是正整数就当没填，和 URL 校验、服务端收窄同一条口径", () => {
		for (const bad of [-12, 0, 1.5, Number.NaN, "半年", null])
			assert.equal(
				of({ ...NONE, minMonths: bad }).scope.minMonths,
				undefined,
				`minMonths=${String(bad)}`,
			);
	});

	test("公司档、职级、招聘渠道、学历必须来自语料，凭常识造的词一律不认", () => {
		const { scope } = of({
			...NONE,
			companyTag: "知名公司",
			level: "P7",
			recruitment: "校招",
			education: "硕士",
		});
		// 模型一维只给一个值，落到记录上是这一维的一项——范围和筛选是同一批
		// 维度的两种生命周期，形状因此相同（`dimensions.ts` 的 `Picked`）。
		assert.deepEqual(scope, {
			companyTag: ["知名公司"],
			level: ["P7"],
			recruitment: ["校招"],
			education: ["硕士"],
		});
		// 造出来的档筛不到任何人，而界面上那一维会显示成一个选中了却空着的筛选
		assert.deepEqual(
			of({
				...NONE,
				companyTag: "一线大厂",
				level: "总监",
				recruitment: "内推",
				education: "大专",
			}).scope,
			{},
		);
	});

	test("公司名与学校名是自由文本，原样照抄，只剥空白", () => {
		const { scope } = of({ ...NONE, org: " 字节 ", school: "清华" });
		assert.deepEqual(scope, { org: "字节", school: "清华" });
		assert.deepEqual(of({ ...NONE, org: "  ", school: 42 }).scope, {});
	});

	test("没说的维度不填，null 不是一个筛选值", () => {
		assert.deepEqual(of(NONE).scope, {});
	});
});

describe("没处放的条件", () => {
	test("原样带出来，去重、剥空白", () => {
		const spec = of({
			...NONE,
			unsupported: ["北京", " 北京", "35 岁以下", ""],
		});
		assert.deepEqual(unsupportedOf(spec), ["北京", "35 岁以下"]);
	});

	test("不是数组就当没有", () => {
		assert.deepEqual(unsupportedOf(of({ ...NONE, unsupported: "北京" })), []);
	});
});

describe("模型是不可信输入", () => {
	test("什么形状都不该抛", () => {
		for (const raw of [null, undefined, 0, "", [], "一句话", { terms: 42 }]) {
			assert.deepEqual(
				of(raw),
				{ requirements: [], scope: {}, notices: [] },
				`${JSON.stringify(raw)} 应当被当成没填`,
			);
		}
	});

	test("数组里混进垃圾只丢那一项，其余照常", () => {
		const evidence = chipsOf(
			terms(null, { members: [{ text: 123 }] }, one("算法"), "算法"),
		);
		assert.deepEqual(evidence, [{ members: [said("算法")], mode: "must" }]);
	});

	test("绕过 schema 直接传入时也只收约定数量", () => {
		const raw = terms(...Array.from({ length: 12 }, (_, i) => one(`条件${i}`)));
		assert.equal(chipsOf(raw).length, 8);
	});
});

describe("模型读出的每一种东西都是完整理解", () => {
	test("只识别出筛选：证据为空，范围成立", () => {
		assert.deepEqual(of({ ...NONE, kind: "external" }), {
			requirements: [],
			scope: { kind: "external" },
			notices: [],
		});
	});

	test("只识别出不支持条件：不把原话伪造成语义要求", () => {
		assert.deepEqual(of({ ...NONE, unsupported: ["北京"] }), {
			requirements: [],
			scope: {},
			notices: [{ kind: "unsupported", text: "北京" }],
		});
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		const parsed = intentSchema(VOCAB).safeParse({
			...NONE,
			terms: [
				{
					members: [said("渠道运营"), { text: "渠道拓展", tier: "near" }],
					mode: "must",
				},
			],
			minMonths: 12,
			companyTag: "知名公司",
			level: "P7",
			org: "字节",
			unsupported: ["北京"],
		});
		assert.ok(parsed.success);
	});

	test("语料里没有的取值在 schema 这一层就被挡住", () => {
		assert.ok(
			!intentSchema(VOCAB).safeParse({ ...NONE, companyTag: "一线大厂" })
				.success,
		);
		assert.ok(
			!intentSchema(VOCAB).safeParse({ ...NONE, level: "总监" }).success,
		);
	});

	test("语料里一维一个取值都没有时，这一维只能是 null", () => {
		const schema = intentSchema({
			companyTag: [],
			level: [],
			recruitment: [],
			education: [],
		});
		assert.ok(schema.safeParse(NONE).success);
		assert.ok(!schema.safeParse({ ...NONE, companyTag: "知名公司" }).success);
	});

	test("词数上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 requirementsOf（REQUIREMENT_MAX），toSpec 会走它收窄。写成
		// schema 约束就是第二份契约：模型多给一条，整条响应作废、整句理解
		// 失败——而收窄本来只会丢掉多出来的那几条。
		assert.ok(
			intentSchema(VOCAB).safeParse({
				...NONE,
				terms: Array.from({ length: 9 }, (_, i) => one(`条件${i}`)),
			}).success,
		);
	});

	test("词长不写进 schema：那是 termOf 的事，不该卡住整条响应", () => {
		const long = "供应链金融风控建模"; // 九个字，一个词
		// 准入放行——一个长词不该让整句话的理解一起丢掉。
		assert.ok(
			intentSchema(VOCAB).safeParse({
				...NONE,
				terms: [one(long)],
			}).success,
		);
		// 收窄发生在 termOf：超过 24 字的不是要求，是被误当成词的正文。
		assert.deepEqual(chipsOf(terms(one("算".repeat(25)))), []);
		// 八字以上但仍然是一个词的，收窄不该丢，准入更不该拦。
		assert.deepEqual(chipsOf(terms(one(long))), [
			{ members: [said(long)], mode: "must" },
		]);
	});
});
