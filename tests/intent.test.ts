/**
 * 查询理解的纯校验，不连数据库，也不调模型。`where` 合不合白名单、能不能跑由
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
const algo = exp("做过算法", { seek: { patterns: ["算法"] } });

describe("模型写出的查询就是查询", () => {
	test("标签、强度、做过什么、where、参数、累计时长原样留下", () => {
		const raw = [
			exp(
				"在甲辰科技做过推荐",
				{
					seek: {
						criterion: "做过推荐算法或推荐系统",
						patterns: ["推荐算法", "推荐系统"],
					},
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
				seek: {
					patterns: ["推荐算法", "推荐系统"],
					criterion: "做过推荐算法或推荐系统",
				},
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

	test("正则和判据是模型写的：只做边界，不改字；重复的正则只留一次", () => {
		const [c] = of(
			exp("做过增长", {
				seek: {
					criterion: " 做过用户增长 ",
					patterns: [" 用户增长 ", "用户增长", "算".repeat(125), 7],
				},
			}),
		);
		assert.deepEqual(c?.seek, {
			patterns: ["用户增长"],
			criterion: "做过用户增长",
		});
	});

	test("只写判据的 seek 留下；显式写了但无效的 seek 使整条条件无效", () => {
		const [judged] = of(
			exp("带过团队", { seek: { criterion: "本人带过团队" } }),
		);
		assert.deepEqual(judged?.seek, { patterns: [], criterion: "本人带过团队" });
		for (const seek of [
			null,
			[],
			{},
			{ patterns: [" "] },
			{ patterns: [], criterion: " " },
			{ patterns: ["字".repeat(121)] },
		])
			assert.deepEqual(of(exp("做过增长", { seek })), [], JSON.stringify(seek));
		assert.equal(of(exp("有工作经历"))[0]?.seek, undefined);
	});

	test("人的条件上的排除没有表示，整条丢掉", () => {
		assert.deepEqual(
			of(person("不要本科", "p.education = '本科'", "exclude")),
			[],
		);
	});

	test("做过什么只写在经历上，累计时长只在经历的必须与加分上", () => {
		const [p, ex] = of(
			{
				...person("硕士", "p.education = '硕士'"),
				seek: { patterns: ["算法"] },
				minMonths: 12,
			},
			exp(
				"不要外包",
				{ seek: { patterns: ["外包"] }, minMonths: 12 },
				"exclude",
			),
		);
		assert.equal(p?.seek, undefined);
		assert.equal(p?.minMonths, undefined);
		assert.deepEqual(ex?.seek, { patterns: ["外包"] });
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
			const [c] = of(
				exp("做过算法", { seek: { patterns: ["算法"] }, minMonths }),
			);
			assert.ok(c, String(minMonths));
			assert.equal(c.minMonths, undefined, String(minMonths));
		}
	});

	test("参数名要像标识符；参数只收数字和短文字", () => {
		const [c] = of(
			exp("参数", {
				seek: { patterns: ["算法"] },
				params: {
					ok: 1,
					s: "甲辰科技",
					"bad name": 2,
					long: "字".repeat(201),
					obj: {},
				},
			}),
		);
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
			seek: { patterns: ["算法"] },
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
					{
						...exp("做过推荐", { seek: { patterns: ["推荐"] } }),
						id: "keep01",
					},
					{
						...exp("做过搜索", { seek: { patterns: ["搜索"] } }),
						id: "keep01",
					},
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
			seek: { patterns: ["算法"] },
			where: "true",
		},
		{
			id: "b",
			label: "做过产品",
			mode: "must",
			from: "experience",
			seek: { patterns: ["产品"] },
			where: "true",
		},
	];

	test("同一个 id、内容没变的条件保留上一轮的停用；标签改了不算改", () => {
		const { query } = read(
			{
				conditions: [
					{ ...algo, id: "a", label: "算法方向" },
					{ ...exp("做过产品", { seek: { patterns: ["产品"] } }), id: "b" },
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
					{ ...exp("做过销售", { seek: { patterns: ["销售"] } }), off: "user" },
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
	const noted = (note: unknown) => read({ conditions: [algo], note }).notes;

	test("一句话和可选的回答原样留下，只去两头的空白；没写说明的回答不带说明", () => {
		assert.deepEqual(
			noted({
				says: " 算法有几种常见的意思，要不要把推荐也算上？ ",
				current: " 只看算法 ",
				options: [
					{ label: " 把做推荐的也算上 ", detail: " 做过推荐的有二十多位 " },
					{ label: "只看最近三年还在做的", detail: " " },
				],
			}),
			{
				says: "算法有几种常见的意思，要不要把推荐也算上？",
				choices: {
					current: "只看算法",
					others: [
						{ label: "把做推荐的也算上", detail: "做过推荐的有二十多位" },
						{ label: "只看最近三年还在做的" },
					],
				},
			},
		);
	});

	test("没写话的回答、和现在这一种一样的、和前面重复的回答不用", () => {
		const notes = noted({
			says: "算法有几种常见的意思，你要的是哪种？",
			current: "只看算法工程",
			options: [
				{ label: "只看算法工程", detail: "和现在一样" },
				{ label: " ", detail: "没写话" },
				{ detail: "没有 label" },
				{ label: "把做推荐的也算上", detail: "" },
				{ label: "把做推荐的也算上", detail: "又写了一遍" },
				"不是对象",
				null,
			],
		});
		assert.deepEqual(notes?.choices?.others, [{ label: "把做推荐的也算上" }]);
	});

	test("除了现在这一种，最多再给三种回答：多的不用", () => {
		const notes = noted({
			says: "想找哪个方向的算法？",
			current: "先不分方向",
			options: ["推荐", "搜索", "广告", "风控", "视觉"].map((word) => ({
				label: `只看做${word}的`,
				detail: "",
			})),
		});
		assert.deepEqual(
			notes?.choices?.others.map((o) => o.label),
			["只看做推荐的", "只看做搜索的", "只看做广告的"],
		);
	});

	test("没写现在是按哪种理解找的、或者没有一种能用的回答，整组不用，只留那句话", () => {
		const options = [{ label: "把做推荐的也算上", detail: "" }];
		for (const note of [
			{ says: "要不要加上推荐？", current: null, options },
			{ says: "要不要加上推荐？", current: " ", options },
			{ says: "要不要加上推荐？", options },
			{ says: "要不要加上推荐？", current: "不加", options: [] },
			{
				says: "要不要加上推荐？",
				current: "不加",
				options: [{ label: "不加", detail: "" }],
			},
			{ says: "要不要加上推荐？", current: "不加", options: "不是数组" },
		])
			assert.deepEqual(
				noted(note),
				{ says: "要不要加上推荐？", choices: null },
				JSON.stringify(note),
			);
	});

	test("回答只留标签和说明：模型多写的键不进说明", () => {
		const notes = noted({
			says: "要不要加上推荐？",
			current: "不加",
			options: [{ label: "把做推荐的也算上", detail: "", why: "推荐也算算法" }],
		});
		assert.deepEqual(notes?.choices?.others, [{ label: "把做推荐的也算上" }]);
	});

	test("没有那句话就是 null", () => {
		assert.equal(read({ conditions: [algo] }).notes, null);
		assert.equal(noted(null), null);
		assert.equal(noted({ says: " ", options: "不是数组" }), null);
		assert.equal(
			noted({
				current: "不加",
				options: [{ label: "把做推荐的也算上", detail: "" }],
			}),
			null,
			"只有回答、没有问话",
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
	/** 交给模型的形状里 seek 的判据和正则都要写。 */
	const judged = exp("做过算法", {
		seek: { criterion: "做过算法研发", patterns: ["算法"] },
	});

	test("合法输出解析得过", () => {
		assert.ok(
			submissionSchema.safeParse({
				conditions: [
					{ ...judged, minMonths: 12 },
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
						},
					],
				},
			}).success,
		);
	});

	test("回答的两项都要写，问了问题没有现在这一种时 current 写 null", () => {
		const note = (options: unknown[], current: unknown = "先不管这条") => ({
			conditions: [judged],
			note: { says: "要不要先看高潜名单上的？", current, options },
		});
		assert.ok(submissionSchema.safeParse(note([], null)).success);
		assert.ok(!submissionSchema.safeParse(note([{ label: "优先" }])).success);
		assert.ok(
			!submissionSchema.safeParse(note([{ detail: "二十多位" }])).success,
		);
		assert.ok(
			!submissionSchema.safeParse({
				conditions: [judged],
				note: { says: "要不要先看高潜名单上的？", options: [] },
			}).success,
			"current 不能省",
		);
	});

	test("数量与长度上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 draftsOf；写成 schema 约束就是第二份契约：模型多给一条，整条响应作废。
		assert.ok(
			submissionSchema.safeParse({
				conditions: Array.from({ length: 20 }, (_, i) =>
					exp(`条件${i}`, {
						seek: { criterion: `做过词${i}`, patterns: [`词${i}`] },
					}),
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
