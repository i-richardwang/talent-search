/**
 * 查询理解的校验。**不连数据库，也不调模型**——这正是把形状和调用拆开的
 * 好处：模型输出的每一种偏差都能在这里测出来，而 `src/server/llm.ts` 里剩下的
 * 只有「发出去、拿回来」。
 *
 * 这里的每个用例都该读成一句「模型对着这句话这么写的时候，查询应该变成什么」。
 * 模型写的和库里存的是同一个形状（`Condition[]`），所以这一层只剩词表检查和校验。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Condition, Mode } from "#/search/condition";
import {
	isNewClaim,
	submissionSchema,
	unanswered,
	understood,
	type Vocabulary,
	valuesOutsideVocabulary,
} from "#/search/intent";
import { claim as build } from "./conditions";

const values = (...names: string[]) =>
	names.map((name) => ({ name, people: 10 }));

const VOCAB: Vocabulary = {
	companyTag: values("头部互联网T1", "知名公司", "外包公司"),
	level: values("P5", "P6", "P7", "P8"),
	recruitment: values("校招", "社招"),
	education: values("本科", "硕士", "博士"),
};
const of = (...conditions: unknown[]) =>
	understood({ conditions }, VOCAB, []).spec.conditions;
const read = (raw: unknown, base: Condition[] = []) =>
	understood(raw, VOCAB, base);
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
				claim({ company: ["字节"] }, "boost"),
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
				{ about: "experience", mode: "boost", company: ["字节"] },
			],
		);
	});

	test("入职前在大厂做过三年以上增长，不要实习：修饰语写在同一条主张上", () => {
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
 * 任何一档职级。对不上的丢掉，一项不剩的整项消失。该说明的由模型写进说明，
 * 校验这一层只管形状。
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

	test("「及以上」的那一档也得在词表里；对不上就整条丢掉，不退回成列举", () => {
		const atLeast = (field: string, value: string) => ({
			about: "person",
			mode: "must",
			field,
			atLeast: value,
		});
		assert.deepEqual(
			of(
				atLeast("level", "P7"),
				atLeast("education", "研究生"),
				// 同时写了列举：「及以上」说的范围更宽，按它读
				{ ...atLeast("education", "本科"), values: ["硕士"] },
			),
			[
				{ about: "person", mode: "must", field: "level", atLeast: "P7" },
				{ about: "person", mode: "must", field: "education", atLeast: "本科" },
			],
		);
	});

	test("人的条件上的排除没有表示，整条丢掉", () => {
		assert.deepEqual(of(person("recruitment", ["校招"], "exclude")), []);
	});

	test("库里没有的维度整条丢掉：它该出现在说明里，不在条件表里", () => {
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

describe("没作答", () => {
	test("给了条件、校验后一条不剩：没按约定作答", () => {
		for (const raw of [
			{ conditions: [person("level", ["资深"]), person("city", ["北京"])] },
			{ conditions: [claim({ minMonths: "三年" })] },
		])
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

	test("只识别出背景或人的偏好不算失败：各自是一份完整的查询", () => {
		for (const raw of [
			{ conditions: [claim({ kind: "external" })] },
			{ conditions: [claim({ company: ["字节"] }, "boost")] },
			{ conditions: [person("education", ["硕士"], "boost")] },
		])
			assert.equal(unanswered(raw, read(raw)), null);
	});
});

describe("停用跟着条件走", () => {
	const base: Condition[] = [
		{ ...exp("must", "算法"), off: "user" },
		{ ...exp("must", "渠道运营"), off: "user" },
		exp("must", "产品"),
	];

	test("原样沿用的条件保留上一轮的停用", () => {
		const raw = {
			conditions: [
				claim({ what: ["算法"] }),
				claim({ what: ["渠道运营"] }),
				claim({ what: ["产品"] }),
				claim({ what: ["带团队"] }),
			],
		};
		assert.deepEqual(read(raw, base).spec.conditions, [
			...base,
			exp("must", "带团队"),
		]);
	});

	test("改过的条件是一条新条件，没有停用；模型自己写的停用不认", () => {
		const raw = {
			conditions: [
				claim({ what: ["算法"] }, "boost"),
				{ ...claim({ what: ["销售"] }), off: "user" },
			],
		};
		assert.deepEqual(read(raw, base).spec.conditions, [
			exp("boost", "算法"),
			exp("must", "销售"),
		]);
	});
});

describe("说明", () => {
	const algo = claim({ what: ["算法"] });

	test("一句话和选项原样留下，选项的表走同一道校验", () => {
		const { notes } = read({
			conditions: [algo],
			note: {
				says: " 简历里看不出是不是大厂出身，要不要按公司档找？ ",
				current: "先不管这条",
				options: [
					{
						label: "按公司档找",
						detail: "头部互联网待过的有一百多位",
						conditions: [
							algo,
							claim({ companyTag: ["一线大厂", "头部互联网T1"] }),
						],
					},
				],
			},
		});
		assert.deepEqual(notes, {
			says: "简历里看不出是不是大厂出身，要不要按公司档找？",
			choices: {
				current: "先不管这条",
				others: [
					{
						label: "按公司档找",
						detail: "头部互联网待过的有一百多位",
						conditions: [
							exp("must", "算法"),
							{
								about: "experience",
								mode: "must",
								companyTag: ["头部互联网T1"],
							},
						],
					},
				],
			},
		});
	});

	test("选项的表沿用上一轮的停用", () => {
		const base: Condition[] = [{ ...exp("must", "产品"), off: "user" }];
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
							conditions: [algo, claim({ what: ["产品"] })],
						},
					],
				},
			},
			base,
		);
		assert.deepEqual(notes?.choices?.others[0]?.conditions, [
			exp("must", "算法"),
			{ ...exp("must", "产品"), off: "user" },
		]);
	});

	test("和现在一样、和前面的选项一样、或校验后一条不剩的表不算一种理解", () => {
		const { notes } = read({
			conditions: [algo],
			note: {
				says: "算法有几种常见的意思，你要的是哪种？",
				current: "算法工程",
				options: [
					{ label: "一样", detail: "", conditions: [algo] },
					{
						label: "加上推荐",
						detail: "",
						conditions: [algo, claim({ what: ["推荐"] })],
					},
					{
						label: "还是加上推荐",
						detail: "",
						conditions: [claim({ what: ["推荐"] }), algo],
					},
					{
						label: "全不合规",
						detail: "",
						conditions: [person("level", ["资深"])],
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
					conditions: [algo, claim({ what: [word] })],
				})),
			},
		});
		assert.equal(notes?.choices?.others.length, 2);
	});

	test("没写现在是哪种、或者没有一种能用的选项，只留那句话", () => {
		const options = [
			{
				label: "加上推荐",
				detail: "",
				conditions: [algo, claim({ what: ["推荐"] })],
			},
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
		])
			assert.deepEqual(read(raw).spec.conditions, [], JSON.stringify(raw));
	});
});

describe("发给模型的形状", () => {
	test("合法输出解析得过", () => {
		assert.ok(
			submissionSchema.safeParse({
				conditions: [
					claim({ what: ["渠道运营", "渠道拓展"], minMonths: 12 }),
					claim({ company: ["字节"] }, "boost"),
					person("level", ["P7"], "boost"),
				],
				note: {
					says: "简历里看不出潜力，要不要先看带过团队的？",
					current: "先不管这条",
					options: [
						{
							label: "带过团队的优先",
							detail: "写过带团队的有两百多位",
							conditions: [claim({ what: ["带团队"] }, "boost")],
						},
					],
				},
			}).success,
		);
	});

	test("词表不进 schema：词表外的取值提交时告诉模型、最后丢掉，不让整句作废", () => {
		assert.ok(
			submissionSchema.safeParse({
				conditions: [claim({ companyTag: ["一线大厂"] })],
				note: null,
			}).success,
		);
	});

	test("词数与词长上限不写进 schema：多给一条不该让整句理解作废", () => {
		// 上限的事实源是 conditionsOf / termOf，understood 会走它们校验。写成 schema
		// 约束就是第二份契约：模型多给一条，整条响应作废、整句理解失败。
		assert.ok(
			submissionSchema.safeParse({
				conditions: Array.from({ length: 20 }, (_, i) =>
					claim({ what: [`条件${i}`] }),
				),
				note: null,
			}).success,
		);
		const long = "供应链金融风控建模";
		assert.ok(
			submissionSchema.safeParse({
				conditions: [claim({ what: [long] })],
				note: null,
			}).success,
		);
		assert.deepEqual(of(claim({ what: ["算".repeat(25)] })), []);
		assert.deepEqual(of(claim({ what: [long] })), [exp("must", long)]);
	});
});

describe("提交时告诉模型的词表外取值", () => {
	test("条件表和选项的表里的词表外取值各说一句，说出可选的档", () => {
		assert.deepEqual(
			valuesOutsideVocabulary(
				submissionSchema.parse({
					conditions: [
						claim({ what: ["增长"], companyTag: ["一线大厂", "知名公司"] }),
						{ about: "person", mode: "must", field: "level", atLeast: "P9" },
						person("education", ["硕士"]),
					],
					note: {
						says: "简历里看不出潜力，要不要按公司档找？",
						current: "先不管这条",
						options: [
							{
								label: "按公司档找",
								detail: "",
								conditions: [claim({ companyTag: ["一线大厂"] }, "boost")],
							},
						],
					},
				}),
				VOCAB,
			),
			[
				"companyTag 没有「一线大厂」这个取值，可选：头部互联网T1、知名公司、外包公司",
				"level 没有「P9」这个取值，可选：P5、P6、P7、P8",
			],
		);
	});

	test("学校写名字，不查词表", () => {
		assert.deepEqual(
			valuesOutsideVocabulary(
				submissionSchema.parse({
					conditions: [person("school", ["银河学院"])],
					note: null,
				}),
				VOCAB,
			),
			[],
		);
	});
});

describe("哪些条件要检查经历词找不找得到人", () => {
	test("这一轮新写的正向主张；排除、没写经历词的、上一轮已有的不检查", () => {
		const kept = build("灵能驾驶");
		const measured = isNewClaim([kept]);
		assert.deepEqual(
			[
				kept,
				build("机甲算法"),
				build("幽冥测绘", { mode: "boost" }),
				build("实习", { mode: "exclude" }),
				{ about: "experience", mode: "must", company: ["星河"] } as Condition,
			].map((c) => measured(c)),
			[false, true, true, false, false],
		);
	});
});
