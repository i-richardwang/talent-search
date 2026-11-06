/**
 * 查询理解的校验。**不连数据库，也不调模型**：模型输出的每一种偏差都能在这里测出来，
 * `src/server/llm.ts` 里剩下的只有「发出去、拿回来」。`where` 合不合白名单、能不能跑由
 * 提交工具试跑（`tests/agent-tools.test.ts`），这里只看形状、身份、停用与说明。
 *
 * 每个用例读成一句「模型这么写的时候，这一轮的条件应该是什么」。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { submissionSchema, unanswered, understood } from "#/search/intent";
import type { QueryCondition } from "#/search/query";

const read = (raw: unknown, base: QueryCondition[] = []) =>
	understood(raw, base);
const of = (...conditions: unknown[]) => read({ conditions }).query.conditions;
/** 去掉服务端发的 id，比较内容。 */
const bare = (list: readonly QueryCondition[]) =>
	list.map(({ id: _id, ...rest }) => rest);

/** 模型写一条经历条件的最简写法。 */
const exp = (
	label: string,
	parts: Record<string, unknown> = {},
	mode: unknown = "must",
) => ({ label, mode, from: "experience", where: "true", ...parts });
/** 模型写一条人的条件的最简写法。 */
const person = (label: string, where: string, mode: unknown = "must") => ({
	label,
	mode,
	from: "person",
	where,
});
const algo = exp("做过算法", { terms: { what: ["算法"] } });

describe("模型写出的查询就是查询", () => {
	test("标签、强度、语义词、where、参数、累计时长原样留下", () => {
		const raw = [
			exp(
				"在甲辰科技做过推荐",
				{
					terms: { what: ["推荐算法", "推荐系统"] },
					where: "e.company = :company",
					params: { company: "甲辰科技" },
					minMonths: 36,
				},
				"must",
			),
			person("职级 P7 及以上", "p.level_rank >= :rank", "boost"),
		];
		assert.deepEqual(bare(of(...raw)), [
			{
				label: "在甲辰科技做过推荐",
				mode: "must",
				from: "experience",
				terms: { what: ["推荐算法", "推荐系统"] },
				where: "e.company = :company",
				params: { company: "甲辰科技" },
				minMonths: 36,
			},
			{
				label: "职级 P7 及以上",
				mode: "boost",
				from: "person",
				where: "p.level_rank >= :rank",
			},
		]);
	});

	test("语义词是模型的表达：只做边界，不改字；重复的写法只留一次", () => {
		const [c] = of(
			exp("做过增长", {
				terms: { what: [" 用户增长 ", "用户增长", "算".repeat(25)] },
			}),
		);
		assert.deepEqual(c?.terms, { what: ["用户增长"] });
	});

	test("人的条件上的排除没有表示，整条丢掉", () => {
		assert.deepEqual(
			of(person("不要本科", "p.education = '本科'", "exclude")),
			[],
		);
	});

	test("语义词只写在经历上，累计时长只在经历的必须与加分上", () => {
		const [p, ex] = of(
			{
				...person("硕士", "p.education = '硕士'"),
				terms: { what: ["算法"] },
				minMonths: 12,
			},
			exp("不要外包", { terms: { what: ["外包"] }, minMonths: 12 }, "exclude"),
		);
		assert.equal(p?.terms, undefined);
		assert.equal(p?.minMonths, undefined);
		assert.deepEqual(ex?.terms, { what: ["外包"] });
		assert.equal(ex?.minMonths, undefined);
	});

	test("缺标签、认不出的强度或来源、空 where、过长的 where 整条丢掉", () => {
		assert.deepEqual(
			of(
				exp(""),
				exp("强度不对", {}, "maybe"),
				{ ...exp("来源不对"), from: "team" },
				exp("where 空着", { where: " " }),
				exp("where 太长", { where: `true and ${"x".repeat(2_000)}` }),
			),
			[],
		);
	});

	test("累计时长不是正整数或超过五十年就不写，条件留下", () => {
		for (const minMonths of ["三年", 0, -3, 1.5, 601]) {
			const [c] = of(exp("做过算法", { terms: { what: ["算法"] }, minMonths }));
			assert.ok(c, String(minMonths));
			assert.equal(c.minMonths, undefined, String(minMonths));
		}
	});

	test("参数名和语义词名要像标识符；参数只收数字和短文字", () => {
		const [c] = of(
			exp("参数", {
				terms: { what: ["算法"], "坏 名": ["推荐"] },
				params: {
					ok: 1,
					s: "甲辰科技",
					"bad name": 2,
					long: "字".repeat(201),
					obj: {},
				},
			}),
		);
		assert.deepEqual(c?.terms, { what: ["算法"] });
		assert.deepEqual(c?.params, { ok: 1, s: "甲辰科技" });
	});
});

describe("条件的身份", () => {
	const base: QueryCondition[] = [
		{
			id: "keep01",
			label: "做过算法",
			mode: "must",
			from: "experience",
			terms: { what: ["算法"] },
			where: "true",
		},
		{
			id: "keep02",
			label: "硕士",
			mode: "boost",
			from: "person",
			where: "p.education = '硕士'",
		},
	];

	test("新写的条件由服务端发 id", () => {
		const [c] = of(algo);
		assert.match(c?.id ?? "", /^[0-9a-f]{8}$/);
	});

	test("沿用上一轮的条件照抄 id，改了内容也照抄", () => {
		const { query } = read(
			{
				conditions: [
					{ ...algo, id: "keep01", mode: "boost" },
					{ ...person("硕士", "p.education = '硕士'", "boost"), id: "keep02" },
				],
			},
			base,
		);
		assert.deepEqual(
			query.conditions.map((c) => [c.id, c.mode]),
			[
				["keep01", "boost"],
				["keep02", "boost"],
			],
		);
	});

	test("没写 id、内容和上一轮某一条一样的，用那一条的 id", () => {
		const { query } = read(
			{ conditions: [person("硕士优先", "p.education = '硕士'", "boost")] },
			base,
		);
		assert.equal(query.conditions[0]?.id, "keep02");
	});

	test("编造的 id 不认；同一个 id 一份查询里只用一次", () => {
		const { query } = read(
			{
				conditions: [
					{ ...algo, id: "made-up" },
					{ ...exp("做过推荐", { terms: { what: ["推荐"] } }), id: "keep01" },
					{ ...exp("做过搜索", { terms: { what: ["搜索"] } }), id: "keep01" },
				],
			},
			base,
		);
		const ids = query.conditions.map((c) => c.id);
		assert.equal(ids[0], "keep01", "内容和 keep01 一样，用它的 id");
		assert.notEqual(ids[1], "keep01");
		assert.notEqual(ids[2], "keep01");
		assert.equal(new Set(ids).size, 3);
		assert.ok(!ids.includes("made-up"));
	});
});

describe("没作答", () => {
	test("给了条件、校验后一条不剩：没按约定作答", () => {
		const raw = {
			conditions: [
				person("不要本科", "true", "exclude"),
				{ label: "缺 where" },
			],
		};
		assert.match(unanswered(raw, read(raw)) ?? "", /全部不合规/);
	});

	test("条件和说明都空着：没作答", () => {
		const raw = { conditions: [], note: null };
		assert.match(unanswered(raw, read(raw)) ?? "", /也没有说明/);
	});

	test("条件为空、说得出为什么：这是一个答案", () => {
		const raw = {
			conditions: [],
			note: { says: "人才库里没有工作地点", current: null, options: [] },
		};
		assert.equal(unanswered(raw, read(raw)), null);
	});

	test("只有背景或人的偏好不算失败：各自是一份完整的查询", () => {
		for (const raw of [
			{
				conditions: [
					exp("入职前在甲辰科技待过", { where: "e.company = '甲辰科技'" }),
				],
			},
			{ conditions: [person("硕士", "p.education = '硕士'", "boost")] },
		])
			assert.equal(unanswered(raw, read(raw)), null);
	});
});

describe("停用跟着条件走", () => {
	const base: QueryCondition[] = [
		{
			id: "a",
			label: "做过算法",
			mode: "must",
			off: "user",
			from: "experience",
			terms: { what: ["算法"] },
			where: "true",
		},
		{
			id: "b",
			label: "做过产品",
			mode: "must",
			from: "experience",
			terms: { what: ["产品"] },
			where: "true",
		},
	];

	test("同一个 id、内容没变的条件保留上一轮的停用；标签改了不算改", () => {
		const { query } = read(
			{
				conditions: [
					{ ...algo, id: "a", label: "算法方向" },
					{ ...exp("做过产品", { terms: { what: ["产品"] } }), id: "b" },
				],
			},
			base,
		);
		assert.deepEqual(
			query.conditions.map((c) => [c.id, c.label, c.off]),
			[
				["a", "算法方向", "user"],
				["b", "做过产品", undefined],
			],
		);
	});

	test("没写 id 但内容一样的，同样带上停用", () => {
		const { query } = read({ conditions: [algo] }, base);
		assert.deepEqual(
			[query.conditions[0]?.id, query.conditions[0]?.off],
			["a", "user"],
		);
	});

	test("改过内容的条件没有停用；模型自己写的停用不认", () => {
		const { query } = read(
			{
				conditions: [
					{ ...algo, id: "a", mode: "boost" },
					{ ...exp("做过销售", { terms: { what: ["销售"] } }), off: "user" },
				],
			},
			base,
		);
		assert.deepEqual(
			query.conditions.map((c) => c.off),
			[undefined, undefined],
		);
	});
});

describe("说明", () => {
	const recommend = exp("做过推荐", { terms: { what: ["推荐"] } });

	test("一句话和选项原样留下，选项的表走同一道校验", () => {
		const { query, notes } = read({
			conditions: [algo],
			note: {
				says: " 算法有几种常见的意思，要不要把推荐也算上？ ",
				current: "只看算法",
				options: [
					{
						label: "把推荐也算上",
						detail: "做过推荐的有二十多位",
						conditions: [
							algo,
							recommend,
							person("不要本科", "true", "exclude"),
						],
					},
				],
			},
		});
		assert.equal(notes?.says, "算法有几种常见的意思，要不要把推荐也算上？");
		assert.equal(notes?.choices?.current, "只看算法");
		const [option] = notes?.choices?.others ?? [];
		assert.equal(option?.label, "把推荐也算上");
		assert.equal(option?.detail, "做过推荐的有二十多位");
		assert.deepEqual(
			option?.conditions.map((c) => c.label),
			["做过算法", "做过推荐"],
		);
		assert.equal(
			option?.conditions[0]?.id,
			query.conditions[0]?.id,
			"选项里和现在一样的条件用同一个 id：选了它，chip 的身份不变",
		);
	});

	test("选项的表沿用上一轮的停用", () => {
		const base: QueryCondition[] = [
			{
				id: "p",
				label: "做过产品",
				mode: "must",
				off: "user",
				from: "experience",
				terms: { what: ["产品"] },
				where: "true",
			},
		];
		const { notes } = read(
			{
				conditions: [algo],
				note: {
					says: "要不要把做过产品的也带上？",
					current: "只看算法",
					options: [
						{
							label: "带上",
							detail: "",
							conditions: [
								algo,
								exp("做过产品", { terms: { what: ["产品"] } }),
							],
						},
					],
				},
			},
			base,
		);
		assert.deepEqual(
			notes?.choices?.others[0]?.conditions.map((c) => [c.label, c.off]),
			[
				["做过算法", undefined],
				["做过产品", "user"],
			],
		);
	});

	test("和现在一样、和前面的选项一样、或校验后一条不剩的表不算一种理解", () => {
		const { notes } = read({
			conditions: [algo],
			note: {
				says: "算法有几种常见的意思，你要的是哪种？",
				current: "算法工程",
				options: [
					{
						label: "一样",
						detail: "",
						conditions: [{ ...algo, label: "换个说法" }],
					},
					{ label: "加上推荐", detail: "", conditions: [algo, recommend] },
					{ label: "还是加上推荐", detail: "", conditions: [recommend, algo] },
					{
						label: "全不合规",
						detail: "",
						conditions: [person("x", "true", "exclude")],
					},
				],
			},
		});
		assert.deepEqual(
			notes?.choices?.others.map((o) => o.label),
			["加上推荐"],
		);
	});

	test("最多再给两种理解", () => {
		const { notes } = read({
			conditions: [algo],
			note: {
				says: "要不要放宽？",
				current: "不放宽",
				options: ["推荐", "搜索", "广告"].map((word) => ({
					label: word,
					detail: "",
					conditions: [algo, exp(`做过${word}`, { terms: { what: [word] } })],
				})),
			},
		});
		assert.equal(notes?.choices?.others.length, 2);
	});

	test("没写现在是哪种、或者没有一种能用的选项，只留那句话", () => {
		const options = [
			{ label: "加上推荐", detail: "", conditions: [algo, recommend] },
		];
		for (const note of [
			{ says: "要不要加上推荐？", current: null, options },
			{ says: "要不要加上推荐？", current: "不加", options: [] },
		])
			assert.deepEqual(read({ conditions: [algo], note }).notes, {
				says: "要不要加上推荐？",
				choices: null,
			});
	});

	test("没有那句话就是 null", () => {
		assert.equal(read({ conditions: [algo] }).notes, null);
		assert.equal(read({ conditions: [algo], note: null }).notes, null);
		assert.equal(
			read({ conditions: [algo], note: { says: " ", options: "不是数组" } })
				.notes,
			null,
		);
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
			{ conditions: [null, 1, "x", []] },
		])
			assert.deepEqual(read(raw).query.conditions, [], JSON.stringify(raw));
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		assert.ok(
			submissionSchema.safeParse({
				conditions: [
					{ ...algo, minMonths: 12 },
					{
						...person("P7 及以上", "p.level_rank >= :r", "boost"),
						params: { r: 7 },
					},
				],
				note: {
					says: "人才库里看不出潜力，要不要先看高潜名单上的？",
					current: "先不管这条",
					options: [
						{
							label: "高潜名单上的优先",
							detail: "最近一期高潜名单上有二十多位",
							conditions: [algo, person("最近一期高潜", "true", "boost")],
						},
					],
				},
			}).success,
		);
	});

	test("数量与长度上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 draftsOf；写成 schema 约束就是第二份契约：模型多给一条，整条响应作废。
		assert.ok(
			submissionSchema.safeParse({
				conditions: Array.from({ length: 20 }, (_, i) =>
					exp(`条件${i}`, { terms: { what: [`词${i}`] } }),
				),
				note: null,
			}).success,
		);
		assert.ok(
			submissionSchema.safeParse({
				conditions: [exp("长", { where: "x".repeat(5_000) })],
				note: null,
			}).success,
		);
	});
});
