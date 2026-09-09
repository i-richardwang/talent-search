/**
 * 条件的边界与不变量。这一层是纯函数：模型输出、RPC 入参、命令行敲的字都从
 * `termsOf` 这一个口子进来，所以「同一个词只留一条」「取值不改字」「几条、
 * 几个取值」「范围维度没有排除」在这里测一次，三条路一起算数。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { FILTER_LIST_MAX } from "#/search/dimensions";
import { hasMeaning } from "#/search/spec";
import {
	activeTerms,
	MAX_TERM_LEN,
	modesOf,
	scopeOf,
	TERM_MAX,
	type Term,
	termOf,
	termsOf,
	VALUES_MAX,
	withMode,
	withOff,
	withoutValue,
} from "#/search/term";
import { boundedText, TEXT_MAX } from "#/search/text";

const exp = (...values: [string, ...string[]]): Term => ({
	field: "experience",
	mode: "must",
	values,
});

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
		// 单字对语义匹配说不出任何东西；一段粘贴进来的正文会被原样送去嵌入，
		// 再拿一个「段落向量」去和短短的岗位名比
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
		// 丢掉会静默放宽 AND 语义，而屏幕上看不出哪个条件被吃了。
		// 当成必须最多是收得太紧，那是看得见、点得掉的。
		assert.deepEqual(
			termsOf([
				{ field: "experience", values: ["线下渠道运营"] },
				{ field: "experience", values: ["带团队"], mode: "很重要" },
			]),
			[exp("线下渠道运营"), exp("带团队")],
		);
	});

	test("认不出的维度整条丢掉：它说的是库里没有的东西", () => {
		assert.deepEqual(
			termsOf([
				{ field: "city", values: ["北京"] },
				{ values: ["算法"] },
				{ field: "experience", values: ["算法"] },
			]),
			[exp("算法")],
		);
	});

	test("三档强度与停用原样收下；没停用的身上不长 off，认不出的成因也不长", () => {
		assert.deepEqual(
			termsOf([
				{ field: "experience", values: ["渠道运营"], mode: "must" },
				{ field: "experience", values: ["带团队"], mode: "boost", off: "user" },
				{ field: "experience", values: ["实习"], mode: "exclude", off: "yes" },
				{ field: "experience", values: ["经理"], off: "wide" },
			]),
			[
				exp("渠道运营"),
				{ ...exp("带团队"), mode: "boost", off: "user" },
				{ ...exp("实习"), mode: "exclude" },
				{ ...exp("经理"), off: "wide" },
			],
		);
	});

	test("范围维度没有排除：「不要校招的」在这套维度里该说成「社招」", () => {
		assert.deepEqual(
			termsOf([
				{ field: "recruitment", values: ["校招"], mode: "exclude" },
				{ field: "org", values: ["字节"], mode: "boost" },
			]),
			[{ field: "org", mode: "boost", values: ["字节"] }],
		);
	});

	test("经历词跨条件去重，先出现的赢；范围取值只在同一条里去重", () => {
		assert.deepEqual(
			termsOf([
				{ field: "experience", values: ["算法", "深度学习"], mode: "must" },
				{ field: "experience", values: ["深度学习"], mode: "exclude" },
				{ field: "experience", values: ["算法"], mode: "boost" },
				{ field: "experience", values: ["运营", "算法"] },
				{ field: "level", values: ["D7", "D7", "D8"] },
			]),
			[
				exp("算法", "深度学习"),
				exp("运营"),
				{ field: "level", mode: "must", values: ["D7", "D8"] },
			],
		);
	});

	test("不合规的取值只丢那一个，其余照常；一个不剩的条件整条消失", () => {
		assert.deepEqual(
			termsOf([
				{
					field: "experience",
					values: ["算法", "  ", 7, "算", null],
					mode: "must",
				},
				{ field: "experience", values: [], mode: "must" },
				{ field: "experience", values: ["的"] },
				{ field: "org", values: ["   "] },
				null,
				"算法",
			]),
			[exp("算法")],
		);
	});

	test("几条条件、每条几个经历词都有上限，多的丢掉；范围取值不受这个数限", () => {
		const many = Array.from({ length: TERM_MAX + 3 }, (_, i) => ({
			field: "experience",
			values: [`条件${i}`],
		}));
		assert.equal(termsOf(many).length, TERM_MAX);

		const values = ["甲乙", "丙丁", "戊己", "庚辛", "壬癸", "子丑", "寅卯"];
		assert.deepEqual(termsOf([{ field: "experience", values }]), [
			exp(...(values.slice(0, VALUES_MAX) as [string, ...string[]])),
		]);
		const levels = Array.from({ length: 13 }, (_, i) => `D${i}`);
		assert.deepEqual(termsOf([{ field: "level", values: levels }]), [
			{ field: "level", mode: "must", values: levels },
		]);
		// 范围取值的上限是一维能同时选中几项，和 URL 上的筛选同一条
		const tags = Array.from(
			{ length: FILTER_LIST_MAX + 6 },
			(_, i) => `档${i}`,
		);
		assert.equal(
			termsOf([{ field: "companyTag", values: tags }])[0]?.values.length,
			FILTER_LIST_MAX,
		);
	});

	test("范围条件整条重复只留一条；取值不同、强度不同的都是各自一条", () => {
		assert.deepEqual(
			termsOf([
				{ field: "level", values: ["D7"] },
				{ field: "level", values: ["D7"] },
				{ field: "level", values: ["D7"], mode: "boost" },
				{ field: "level", values: ["D7", "D8"] },
			]),
			[
				{ field: "level", mode: "must", values: ["D7"] },
				{ field: "level", mode: "boost", values: ["D7"] },
				{ field: "level", mode: "must", values: ["D7", "D8"] },
			],
		);
	});

	test("范围取值必须是这一维读得回来的：读不回来的丢掉，写法归一", () => {
		assert.deepEqual(
			termsOf([
				{ field: "minMonths", values: ["三年", "-12", "1.5", "36"] },
				{ field: "kind", values: ["校招", "external"] },
				{ field: "level", values: ["未知", "D7"] },
				{ field: "education", values: ["博士"] },
			]),
			[
				{ field: "minMonths", mode: "must", values: ["36"] },
				{ field: "kind", mode: "must", values: ["external"] },
				{ field: "level", mode: "must", values: ["D7"] },
				{ field: "education", mode: "must", values: ["博士"] },
			],
		);
		// 一个读得回来的都没有，整条消失：一枚不筛任何人的 chip 是在说谎
		assert.deepEqual(termsOf([{ field: "minMonths", values: ["三年"] }]), []);
	});

	test("什么形状都不该抛", () => {
		for (const raw of [null, undefined, 0, "", {}, "一句话", [42], [[]]])
			assert.deepEqual(termsOf(raw), [], JSON.stringify(raw));
	});

	test("收窄是幂等的：合规的条件再过一遍一个字段都不变", () => {
		const once = termsOf([
			{
				field: "experience",
				values: ["大模型", "多模态", "LLM"],
				mode: "must",
			},
			{ field: "experience", values: ["带团队"], mode: "boost", off: "user" },
			{ field: "experience", values: ["实习"], mode: "exclude" },
			{ field: "org", values: ["字节"], mode: "boost" },
			{ field: "minMonths", values: ["36"] },
		]);
		assert.deepEqual(termsOf(once), once);
	});
});

/**
 * 停用。
 *
 * 它和三档强度**正交**，这是它值得多一个字段而不是多一档强度的全部理由：
 * 停一个加分词再开回来，它必须还是加分词。做成第四档强度的话，那次退化
 * 会安静地发生，界面上没有任何提示。
 */
describe("停用", () => {
	const boost: Term = {
		field: "experience",
		values: ["带团队", "带项目", "团队管理"],
		mode: "boost",
	};

	test("停用与启用不碰强度、不碰取值；成因跟着 off 走", () => {
		const off = withOff(boost, "user");
		assert.deepEqual(off, { ...boost, off: "user" });
		assert.deepEqual(withOff(off, null), boost);
		assert.deepEqual(withOff(withOff(boost, "wide"), null), boost);
	});

	test("activeTerms 摘掉停用的，顺序不变", () => {
		const list = termsOf([
			{ field: "experience", values: ["算法"] },
			{ field: "experience", values: ["运营"], off: "wide" },
			{ field: "experience", values: ["产品"] },
		]);
		assert.deepEqual(activeTerms(list), [exp("算法"), exp("产品")]);
	});
});

describe("删一个取值", () => {
	const t = exp("算法", "模型", "推荐算法");

	test("只删点名的那个，其余原样；删到一个不剩就是删整条", () => {
		assert.deepEqual(withoutValue(t, "推荐算法"), exp("算法", "模型"));
		assert.deepEqual(withoutValue(t, "算法"), exp("模型", "推荐算法"));
		assert.equal(withoutValue(exp("算法"), "算法"), null);
	});
});

/**
 * 范围：条件里的范围维度摊成执行用的形状。同一维两条合并；单值维先写的赢；
 * 停用的不算。
 */
describe("范围", () => {
	test("must 和 boost 各摊各的；公司名多个是「任一含」", () => {
		const terms = termsOf([
			{ field: "level", values: ["D7", "D8"] },
			{ field: "org", values: ["字节", "腾讯"], mode: "boost" },
			{ field: "kind", values: ["external"] },
			{ field: "minMonths", values: ["36"] },
			{ field: "school", values: ["清华"] },
		]);
		assert.deepEqual(scopeOf(terms, "must"), {
			level: ["D7", "D8"],
			kind: "external",
			minMonths: 36,
			school: ["清华"],
		});
		assert.deepEqual(scopeOf(terms, "boost"), { org: ["字节", "腾讯"] });
	});

	test("同一维两条合并、不重复；单值维先写的赢；停用的不算", () => {
		const terms = termsOf([
			{ field: "level", values: ["D7"] },
			{ field: "level", values: ["D8", "D7"] },
			{ field: "minMonths", values: ["36"] },
			{ field: "minMonths", values: ["12"] },
			{ field: "org", values: ["字节"], mode: "boost" },
			{ field: "org", values: ["腾讯", "字节"], mode: "boost" },
			{ field: "education", values: ["硕士"], off: "user" },
		]);
		assert.deepEqual(scopeOf(terms, "must"), {
			minMonths: 36,
			level: ["D7", "D8"],
		});
		assert.deepEqual(scopeOf(terms, "boost"), { org: ["字节", "腾讯"] });
	});
});

describe("改强度", () => {
	test("经历词三档都行；范围维度没有排除，改不动就原样交回", () => {
		const word = exp("算法");
		assert.deepEqual(modesOf(word), ["must", "boost", "exclude"]);
		assert.equal(withMode(word, "exclude").mode, "exclude");
		const org = termsOf([{ field: "org", values: ["字节"] }])[0] as Term;
		assert.deepEqual(modesOf(org), ["must", "boost"]);
		assert.equal(withMode(org, "boost").mode, "boost");
		assert.equal(withMode(org, "exclude"), org);
	});
});

describe("查询有没有说话", () => {
	test("有一条条件就算说了，哪怕它是停用的；一条都没有就是空查询", () => {
		const one = termsOf([
			{ field: "experience", values: ["算法"], off: "user" },
		]);
		assert.equal(hasMeaning({ terms: one }), true);
		assert.equal(hasMeaning({ terms: [] }), false);
	});
});
