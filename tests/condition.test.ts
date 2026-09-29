/**
 * 条件的边界与不变量。这一层是纯函数：模型输出、RPC 入参、命令行敲的字都从
 * `conditionsOf` 这一个入口进来，所以「取值不改字」「几条、几个词」「人的条件
 * 没有排除」「一项都不剩的整条消失」在这里测一次，三条路一起算数。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	activeConditions,
	CONDITION_MAX,
	type Condition,
	conditionKey,
	conditionsOf,
	MAX_TERM_LEN,
	modesOf,
	partsOf,
	termOf,
	VALUES_MAX,
	withMode,
	withOff,
	withoutPart,
} from "#/search/condition";
import { conditionLabel, partLabel } from "#/search/condition-label";
import { dimCompare, FILTER_LIST_MAX } from "#/search/dimensions";
import { parseQuery } from "#/search/query-syntax";
import { hasMeaning } from "#/search/spec";
import { boundedText, TEXT_MAX } from "#/search/text";
import { claim } from "./conditions";

const exp = (...what: [string, ...string[]]): Condition => claim(what);

/**
 * 取值只做边界工作，不改写字面：屏幕上写的那几个字和拿去比相似度的那几个字
 * 必须是同一串。任何「剥掉句式」「切开连接词」都是一次看不见的查询变更。
 */
describe("经历词的边界", () => {
	test("字面原样保留，只去掉两头的空白", () => {
		assert.equal(termOf("  安全运营 "), "安全运营");
		assert.equal(termOf("做过安全运营的人"), "做过安全运营的人");
		assert.equal(termOf("machine learning"), "machine learning");
		assert.equal(termOf("C++"), "C++");
	});

	test("单字和超长正文都不是经历词", () => {
		assert.equal(termOf("算"), undefined);
		assert.equal(termOf("算法".repeat(MAX_TERM_LEN)), undefined);
		assert.equal(
			termOf("算法".repeat(MAX_TERM_LEN / 2)),
			"算法".repeat(MAX_TERM_LEN / 2),
		);
		assert.equal(termOf(""), undefined);
		assert.equal(termOf(123), undefined);
	});

	test("短文本的边界和经历词的边界是两条：前者只限长度", () => {
		assert.equal(
			boundedText(`  ${"词".repeat(TEXT_MAX + 10)}  `)?.length,
			TEXT_MAX,
		);
		assert.equal(boundedText("   "), undefined);
	});
});

describe("不可信输入 → 条件", () => {
	test("没给强度就是「必须」；给了认不出的也按必须算，不丢词", () => {
		// 丢掉会静默放宽 AND 语义，而屏幕上看不出哪个条件被丢了。
		// 当成必须最多是条件太严，那是看得见、点得掉的。
		assert.deepEqual(
			conditionsOf([
				{ about: "experience", what: ["线下渠道运营"] },
				{ about: "experience", what: ["带团队"], mode: "很重要" },
			]),
			[exp("线下渠道运营"), exp("带团队")],
		);
	});

	test("认不出是哪种条件、哪一维的整条丢掉：它说的是库里没有的东西", () => {
		assert.deepEqual(
			conditionsOf([
				{ about: "city", what: ["北京"] },
				{ what: ["算法"] },
				{ about: "person", field: "age", values: ["30"] },
				{ about: "experience", what: ["算法"] },
			]),
			[exp("算法")],
		);
	});

	test("一条主张的每一项各自校验，写下的项都留在同一条上", () => {
		assert.deepEqual(
			conditionsOf([
				{
					about: "experience",
					mode: "must",
					what: ["增长", "用户增长"],
					org: ["字节"],
					companyTag: ["大厂", "未知"],
					kind: "external",
					minMonths: "36",
				},
			]),
			[
				{
					about: "experience",
					mode: "must",
					what: ["增长", "用户增长"],
					org: ["字节"],
					companyTag: ["大厂"],
					kind: "external",
					minMonths: 36,
				},
			],
		);
	});

	test("三档强度与停用原样收下；没停用的不带 off，认不出的成因也不带", () => {
		assert.deepEqual(
			conditionsOf([
				{ about: "experience", what: ["渠道运营"], mode: "must" },
				{ about: "experience", what: ["带团队"], mode: "boost", off: "user" },
				{ about: "experience", what: ["实习"], mode: "exclude", off: "yes" },
				{ about: "experience", what: ["经理"], off: "wide" },
			]),
			[
				exp("渠道运营"),
				{ ...exp("带团队"), mode: "boost", off: "user" },
				{ ...exp("实习"), mode: "exclude" },
				{ ...exp("经理"), off: "wide" },
			],
		);
	});

	test("人的条件没有排除：「不要校招的」在这套维度里该说成「社招」", () => {
		assert.deepEqual(
			conditionsOf([
				{
					about: "person",
					field: "recruitment",
					values: ["校招"],
					mode: "exclude",
				},
				{ about: "experience", org: ["字节"], mode: "boost" },
			]),
			[{ about: "experience", mode: "boost", org: ["字节"] }],
		);
	});

	test("完全相同的条件只留第一条，停用与否不算；同一项内的取值去重", () => {
		assert.deepEqual(
			conditionsOf([
				{ about: "experience", what: ["算法", "深度学习", "算法"] },
				{ about: "experience", what: ["算法", "深度学习"], off: "user" },
				{ about: "experience", what: ["算法"], mode: "boost" },
				{ about: "person", field: "level", values: ["D7", "D7", "D8"] },
			]),
			[
				exp("算法", "深度学习"),
				{ ...exp("算法"), mode: "boost" },
				{ about: "person", mode: "must", field: "level", values: ["D7", "D8"] },
			],
		);
	});

	test("不合规的取值只丢那一个，其余照常；一项不剩的条件整条消失", () => {
		assert.deepEqual(
			conditionsOf([
				{ about: "experience", what: ["算法", "  ", 7, "算", null] },
				{ about: "experience", what: [] },
				{ about: "experience", what: ["的"] },
				{ about: "experience", org: ["   "] },
				{ about: "experience", minMonths: "三年" },
				{ about: "person", field: "school", values: [] },
				null,
				"算法",
			]),
			[exp("算法")],
		);
	});

	test("几条条件、每条几个经历词都有上限，多的丢掉；词表取值不受这个数限", () => {
		const many = Array.from({ length: CONDITION_MAX + 3 }, (_, i) => ({
			about: "experience",
			what: [`条件${i}`],
		}));
		assert.equal(conditionsOf(many).length, CONDITION_MAX);

		const what = ["甲乙", "丙丁", "戊己", "庚辛", "壬癸", "子丑", "寅卯"];
		assert.deepEqual(conditionsOf([{ about: "experience", what }]), [
			exp(...(what.slice(0, VALUES_MAX) as [string, ...string[]])),
		]);
		const levels = Array.from({ length: 13 }, (_, i) => `D${i}`);
		assert.deepEqual(
			conditionsOf([{ about: "person", field: "level", values: levels }]),
			[{ about: "person", mode: "must", field: "level", values: levels }],
		);
		// 词表取值的上限是一维能同时选中几项，和 URL 上的筛选同一条
		const tags = Array.from(
			{ length: FILTER_LIST_MAX + 6 },
			(_, i) => `档${i}`,
		);
		const [claim] = conditionsOf([{ about: "experience", companyTag: tags }]);
		assert.equal(
			claim?.about === "experience" ? claim.companyTag?.length : 0,
			FILTER_LIST_MAX,
		);
	});

	test("单值项只认这一维读得回来的：读不回来的丢掉，写法归一", () => {
		assert.deepEqual(
			conditionsOf([
				{ about: "experience", minMonths: -12, what: ["算法"] },
				{ about: "experience", minMonths: 1.5, what: ["运营"] },
				{ about: "experience", kind: "校招", what: ["产品"] },
				{ about: "experience", kind: "external", minMonths: "36" },
				{ about: "person", field: "level", values: ["未知", "D7"] },
			]),
			[
				exp("算法"),
				exp("运营"),
				exp("产品"),
				{ about: "experience", mode: "must", kind: "external", minMonths: 36 },
				{ about: "person", mode: "must", field: "level", values: ["D7"] },
			],
		);
	});

	test("任何形状的输入都不抛错", () => {
		for (const raw of [null, undefined, 0, "", {}, "一句话", [42], [[]]])
			assert.deepEqual(conditionsOf(raw), [], JSON.stringify(raw));
	});

	test("校验是幂等的：合规的条件再过一遍一个字段都不变", () => {
		const once = conditionsOf([
			{ about: "experience", what: ["大模型", "多模态", "LLM"], mode: "must" },
			{ about: "experience", what: ["带团队"], mode: "boost", off: "user" },
			{ about: "experience", what: ["实习"], mode: "exclude" },
			{ about: "experience", org: ["字节"], mode: "boost" },
			{ about: "experience", what: ["增长"], kind: "external", minMonths: 36 },
			{ about: "person", field: "school", values: ["清华"] },
		]);
		assert.deepEqual(conditionsOf(once), once);
	});
});

/**
 * 停用。
 *
 * 它和三档强度**正交**，这是它值得多一个字段而不是多一档强度的全部理由：
 * 停一条加分的主张再开回来，它必须还是加分的。做成第四档强度的话，那次退化
 * 会安静地发生，界面上没有任何提示。
 */
describe("停用", () => {
	const boost: Condition = {
		about: "experience",
		mode: "boost",
		what: ["带团队", "带项目", "团队管理"],
	};

	test("停用与启用不碰强度、不碰取值；成因跟着 off 走", () => {
		const off = withOff(boost, "user");
		assert.deepEqual(off, { ...boost, off: "user" });
		assert.deepEqual(withOff(off, null), boost);
		assert.deepEqual(withOff(withOff(boost, "wide"), null), boost);
	});

	test("activeConditions 去掉停用的，顺序不变", () => {
		const list = conditionsOf([
			{ about: "experience", what: ["算法"] },
			{ about: "experience", what: ["运营"], off: "wide" },
			{ about: "experience", what: ["产品"] },
		]);
		assert.deepEqual(activeConditions(list), [exp("算法"), exp("产品")]);
	});

	test("身份不看停用：同一条条件停与不停是同一个 chip", () => {
		assert.equal(conditionKey(boost), conditionKey(withOff(boost, "user")));
		assert.notEqual(conditionKey(boost), conditionKey(withMode(boost, "must")));
	});
});

describe("逐项去掉", () => {
	const claim: Condition = {
		about: "experience",
		mode: "must",
		what: ["算法", "模型"],
		org: ["字节"],
		kind: "external",
		minMonths: 36,
	};

	test("各项按读出来的顺序排列：什么时候、在哪、做过什么、多久", () => {
		assert.deepEqual(partsOf(claim), [
			{ key: "kind", value: "external" },
			{ key: "org", value: "字节" },
			{ key: "what", value: "算法" },
			{ key: "what", value: "模型" },
			{ key: "minMonths", value: 36 },
		]);
	});

	test("只去掉指定的那一项，其余原样；去到一项不剩就是删整条", () => {
		assert.deepEqual(withoutPart(claim, { key: "what", value: "模型" }), {
			...claim,
			what: ["算法"],
		});
		const { kind: _kind, ...noKind } = claim;
		assert.deepEqual(
			withoutPart(claim, { key: "kind", value: "external" }),
			noKind,
		);
		const { org: _org, ...noOrg } = claim;
		assert.deepEqual(withoutPart(claim, { key: "org", value: "字节" }), noOrg);
		const { minMonths: _m, ...noMonths } = claim;
		assert.deepEqual(
			withoutPart(claim, { key: "minMonths", value: 36 }),
			noMonths,
		);
		assert.equal(
			withoutPart(exp("算法"), { key: "what", value: "算法" }),
			null,
		);

		const person: Condition = {
			about: "person",
			mode: "must",
			field: "level",
			values: ["D7", "D8"],
		};
		assert.deepEqual(withoutPart(person, { key: "values", value: "D7" }), {
			...person,
			values: ["D8"],
		});
		assert.equal(
			withoutPart(
				{ ...person, values: ["D7"] },
				{ key: "values", value: "D7" },
			),
			null,
		);
	});
});

describe("改强度", () => {
	test("经历主张三档都行；人的条件没有排除，改不了就原样返回", () => {
		const word = exp("算法");
		assert.deepEqual(modesOf(word), ["must", "boost", "exclude"]);
		assert.equal(withMode(word, "exclude").mode, "exclude");
		const [level] = conditionsOf([
			{ about: "person", field: "level", values: ["D7"] },
		]);
		if (!level) throw new Error("夹具丢了");
		assert.deepEqual(modesOf(level), ["must", "boost"]);
		assert.equal(withMode(level, "boost").mode, "boost");
		assert.equal(withMode(level, "exclude"), level);
	});
});

describe("查询是否为空", () => {
	test("有一条条件就算说了，哪怕它是停用的；一条都没有就是空查询", () => {
		const one = conditionsOf([
			{ about: "experience", what: ["算法"], off: "user" },
		]);
		assert.equal(hasMeaning({ conditions: one }), true);
		assert.equal(hasMeaning({ conditions: [] }), false);
	});
});

describe("有高低的维：某档及以上", () => {
	const atLeast = {
		about: "person",
		mode: "must",
		field: "education",
		atLeast: "本科",
	};

	test("只有职级和学历能说及以上；别的维度写了也不认", () => {
		assert.deepEqual(conditionsOf([atLeast]), [atLeast]);
		assert.deepEqual(
			conditionsOf([{ ...atLeast, field: "recruitment", values: ["社招"] }]),
			[
				{
					about: "person",
					mode: "must",
					field: "recruitment",
					values: ["社招"],
				},
			],
		);
		assert.deepEqual(conditionsOf([{ ...atLeast, atLeast: "" }]), []);
	});

	test("写成一句话是「学历 · 本科及以上」，整条是一项，拿掉就没了", () => {
		const [condition] = conditionsOf([atLeast]);
		assert.ok(condition);
		assert.equal(conditionLabel(condition), "学历 · 本科及以上");
		const part = { key: "atLeast", value: "本科" } as const;
		assert.deepEqual(partsOf(condition), [part]);
		assert.equal(partLabel(condition, part), "本科及以上");
		assert.equal(withoutPart(condition, part), null);
	});

	test("命令行写 >= 就是及以上", () => {
		assert.deepEqual(parseQuery("education:>=本科"), [atLeast]);
		assert.deepEqual(parseQuery("+level:>=P7/M1"), [
			{ about: "person", mode: "boost", field: "level", atLeast: "P7/M1" },
		]);
	});

	test("候选按档高排，不按名字：P10 在 P9 后面", () => {
		const rows = [
			{ value: "P10", n: 1, rank: 10 },
			{ value: "P9", n: 5, rank: 9 },
		];
		assert.deepEqual(
			rows.sort((a, b) => dimCompare("level", a, b)).map((r) => r.value),
			["P9", "P10"],
		);
	});
});
