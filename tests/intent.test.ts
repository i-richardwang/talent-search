/**
 * 查询理解的收窄。**不连数据库，也不调模型**——这正是把形状和调用拆开换到的
 * 东西：模型输出的每一种走样都能在这里钉住，而 `src/server/llm.ts` 里剩下的
 * 只有「发出去、拿回来」。
 *
 * 这里的每个用例都该读成一句「模型这么说的时候，查询应该变成什么」。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { intentSchema, resolveIntent, toIntent } from "#/search/intent";
import { parseChips, toQuery } from "#/search/parse";

const TAGS = ["头部互联网T1", "知名公司", "外包公司"];
const of = (raw: unknown) => toIntent(raw, TAGS);
const terms = (...ts: unknown[]) => ({ terms: ts });

describe("强度", () => {
	test("三档语气都翻译得出来", () => {
		const { chips } = of(
			terms(
				{ term: "渠道运营", mode: "must" },
				{ term: "团队管理", mode: "boost" },
				{ term: "实习", mode: "exclude" },
			),
		);
		assert.deepEqual(chips, [
			{ term: "渠道运营", mode: "must" },
			{ term: "团队管理", mode: "boost" },
			{ term: "实习", mode: "exclude" },
		]);
	});

	test("认不出的强度按必须算，不是丢掉这个词", () => {
		// 丢掉会静默放宽 AND 语义（少一个约束，结果集变大），而屏幕上看不出
		// 哪个条件被吃了。当成必须最多是收得太紧，那是看得见、点得掉的。
		const { chips } = of(terms({ term: "风控", mode: "很重要" }));
		assert.deepEqual(chips, [{ term: "风控", mode: "must" }]);
	});
});

describe("每个词都过一遍本地切词", () => {
	test("模型带上句式赘字也不要紧，照样剥干净", () => {
		const { chips } = of(terms({ term: "做过渠道运营的人", mode: "must" }));
		assert.deepEqual(chips, [{ term: "渠道运营", mode: "must" }]);
	});

	test("会被切词切开的词就地切开，强度跟着走", () => {
		// 「安全与风险合规」在本地会按连接词「与」切成两个。不切的话得到的是
		// 一枚点一下就变形的 chip：屏幕上写的和实际检索的不是同一个东西。
		const { chips } = of(terms({ term: "安全与风险合规", mode: "exclude" }));
		assert.deepEqual(chips, [
			{ term: "安全", mode: "exclude" },
			{ term: "风险合规", mode: "exclude" },
		]);
	});

	test("切完什么都不剩的词直接消失", () => {
		const { chips } = of(
			terms({ term: "的人", mode: "must" }, { term: "  ", mode: "must" }),
		);
		assert.deepEqual(chips, []);
	});

	test("同一个词只留一枚，先出现的强度算数", () => {
		const { chips } = of(
			terms(
				{ term: "算法", mode: "must" },
				{ term: "做过算法", mode: "boost" },
			),
		);
		assert.deepEqual(chips, [{ term: "算法", mode: "must" }]);
	});

	test("并列说法（alts）挂在同一条要求上，不拆成两条都要", () => {
		const { chips } = of(
			terms({ term: "大模型", mode: "must", alts: ["推荐系统"], near: null }),
		);
		assert.deepEqual(chips, [
			{ term: "大模型", alts: ["推荐系统"], mode: "must" },
		]);
	});

	test("相近说法（near）跟着要求走，并各自过一遍切词", () => {
		const { chips } = of(
			terms({
				term: "算法",
				mode: "must",
				alts: null,
				near: ["做过深度学习的", "机器学习"],
			}),
		);
		assert.deepEqual(chips, [
			{ term: "算法", near: ["深度学习", "机器学习"], mode: "must" },
		]);
	});

	test("排除条件的 near 被丢弃：赶人的词必须准", () => {
		const { chips } = of(
			terms({ term: "实习", mode: "exclude", alts: null, near: ["实习生"] }),
		);
		assert.deepEqual(chips, [{ term: "实习", mode: "exclude" }]);
	});

	test("产出能原样序列化再读回来", () => {
		const { chips } = of(
			terms(
				{ term: "渠道运营", mode: "must" },
				{ term: "带过团队", mode: "boost" },
				{ term: "外包", mode: "exclude" },
			),
		);
		assert.deepEqual(parseChips(toQuery(chips)), chips);
	});
});

describe("筛选只认库里真有的取值", () => {
	test("经历类型只有两种", () => {
		assert.equal(of({ ...terms(), kind: "external" }).filters.kind, "external");
		assert.equal(of({ ...terms(), kind: "外部" }).filters.kind, undefined);
	});

	test("最短时长是任意正整数月数，不是左栏那四个档", () => {
		assert.equal(of({ ...terms(), minMonths: 24 }).filters.minMonths, 24);
		// 左栏那四个档是分面的桶，不是这一维的值域（见 `MIN_MONTHS_BUCKETS`）。
		assert.equal(of({ ...terms(), minMonths: 18 }).filters.minMonths, 18);
		assert.equal(of({ ...terms(), minMonths: 30 }).filters.minMonths, 30);
	});

	test("月数不是正整数就当没填，和 URL 校验、服务端收窄同一条口径", () => {
		for (const bad of [-12, 0, 1.5, Number.NaN, "半年", null])
			assert.equal(
				of({ ...terms(), minMonths: bad }).filters.minMonths,
				undefined,
				`minMonths=${String(bad)}`,
			);
	});

	test("公司档必须来自语料，模型凭常识造的词一律不认", () => {
		assert.equal(
			of({ ...terms(), companyTag: "知名公司" }).filters.companyTag,
			"知名公司",
		);
		// 造出来的档筛不到任何人，而界面上那一维会显示成一个选中了却空着的筛选
		assert.equal(
			of({ ...terms(), companyTag: "一线大厂" }).filters.companyTag,
			undefined,
		);
	});

	test("没说的维度不填，null 不是一个筛选值", () => {
		const { filters } = of({
			...terms(),
			kind: null,
			minMonths: null,
			companyTag: null,
		});
		assert.deepEqual(filters, {});
	});
});

describe("模型是不可信输入", () => {
	test("什么形状都不该抛", () => {
		for (const raw of [null, undefined, 0, "", [], "一句话", { terms: 42 }]) {
			assert.deepEqual(
				of(raw),
				{ chips: [], filters: {}, degraded: false },
				`${JSON.stringify(raw)} 应当被当成没填`,
			);
		}
	});

	test("数组里混进垃圾只丢那一项，其余照常", () => {
		const { chips } = of(terms(null, { term: 123 }, { term: "算法" }, "算法"));
		assert.deepEqual(chips, [{ term: "算法", mode: "must" }]);
	});

	test("绕过 schema 直接传入时也只收约定数量", () => {
		const raw = terms(
			...Array.from({ length: 12 }, (_, i) => ({
				term: `条件${i}`,
				mode: "must",
			})),
		);
		assert.equal(of(raw).chips.length, 8);
	});
});

describe("模型不可用或没有给出可用条件", () => {
	/*
	 * `degraded` 不是一个日志字段，是结果正确性的一部分：退回规则解析之后
	 * 语气读不出来，「最好」「不要」会被一律判成必须条件。所以每一条回退
	 * 分支都要把这一位置上，界面才有东西可说（见 result-head.tsx）。
	 */
	test("调用失败时保留本地解析结果，并记成降级", () => {
		assert.deepEqual(resolveIntent("渠道运营,+团队管理", null, TAGS), {
			chips: [
				{ term: "渠道运营", mode: "must" },
				{ term: "团队管理", mode: "boost" },
			],
			filters: {},
			degraded: true,
		});
	});

	test("合法空对象收窄后没有任何效果时同样回退，不吞掉输入", () => {
		assert.deepEqual(
			resolveIntent(
				"渠道运营",
				{ terms: [], kind: null, minMonths: null, companyTag: null },
				TAGS,
			),
			{
				chips: [{ term: "渠道运营", mode: "must" }],
				filters: {},
				degraded: true,
			},
		);
	});

	test("只识别出筛选不算降级：模型确实读懂了这句话", () => {
		assert.deepEqual(
			resolveIntent(
				"只看入职前",
				{
					terms: [],
					kind: "external",
					minMonths: null,
					companyTag: null,
				},
				TAGS,
			),
			{ chips: [], filters: { kind: "external" }, degraded: false },
		);
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		const parsed = intentSchema(TAGS).safeParse({
			terms: [
				{ term: "渠道运营", mode: "must", alts: null, near: ["用户增长"] },
			],
			kind: null,
			minMonths: 12,
			companyTag: "知名公司",
		});
		assert.ok(parsed.success);
	});

	test("语料里没有的公司档在 schema 这一层就被挡住", () => {
		const parsed = intentSchema(TAGS).safeParse({
			terms: [],
			kind: null,
			minMonths: null,
			companyTag: "一线大厂",
		});
		assert.ok(!parsed.success);
	});

	test("语料里一个公司档都没有时，这一维只能是 null", () => {
		const schema = intentSchema([]);
		assert.ok(
			schema.safeParse({
				terms: [],
				kind: null,
				minMonths: null,
				companyTag: null,
			}).success,
		);
		assert.ok(
			!schema.safeParse({
				terms: [],
				kind: null,
				minMonths: null,
				companyTag: "知名公司",
			}).success,
		);
	});

	test("词数上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 parseChips（CHIP_MAX），toIntent 会走它收窄。写成
		// schema 约束就是第二份契约：模型多给一条，整条响应作废、退回规则
		// 解析——而收窄本来只会丢掉多出来的那几条。
		const base = { kind: null, minMonths: null, companyTag: null };
		assert.ok(
			intentSchema(TAGS).safeParse({
				...base,
				terms: Array.from({ length: 9 }, (_, i) => ({
					term: `条件${i}`,
					mode: "must",
					alts: null,
					near: null,
				})),
			}).success,
		);
	});

	test("词长不写进 schema：那是 parseQuery 的事，不该卡住整条响应", () => {
		const base = { kind: null, minMonths: null, companyTag: null };
		const long = "供应链金融风控建模"; // 九个字，一个词，没有可切之处
		// 准入放行——一个长词不该让整句话的理解一起丢掉，退回规则解析。
		assert.ok(
			intentSchema(TAGS).safeParse({
				...base,
				terms: [{ term: long, mode: "must", alts: null, near: null }],
			}).success,
		);
		// 收窄发生在 parseQuery：超过 24 字的不是概念，是被误当成词的正文。
		assert.deepEqual(
			of(terms({ term: "算".repeat(25), mode: "must" })).chips,
			[],
		);
		// 八字以上但仍然是一个词的，收窄不该丢，准入更不该拦。
		assert.deepEqual(of(terms({ term: long, mode: "must" })).chips, [
			{ term: long, mode: "must" },
		]);
	});
});
