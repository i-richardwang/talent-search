/**
 * 要求的边界与不变量。这一层是纯函数：模型输出、RPC 入参、命令行敲的字都从
 * `requirementsOf` 这一个口子进来，所以「同一个词只留一枚」「说法不改字」
 * 「几条、几个说法」在这里测一次，三条路一起算数。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	activeRequirements,
	boundedText,
	MAX_TERM_LEN,
	MEMBER_MAX,
	REQUIREMENT_MAX,
	type Requirement,
	requirementsOf,
	TEXT_MAX,
	termOf,
	withOff,
} from "#/search/requirement";
import { hasMeaning } from "#/search/spec";

/**
 * 说法只做边界工作，不改写字面：屏幕上写的那几个字和拿去比相似度的那几个字
 * 必须是同一串。任何「剥掉句式」「切开连接词」都是一次看不见的查询变更。
 */
describe("说法的边界", () => {
	test("字面原样保留，只去掉两头的空白", () => {
		assert.equal(termOf("  安全运营 "), "安全运营");
		assert.equal(termOf("做过安全运营的人"), "做过安全运营的人");
		assert.equal(termOf("machine learning"), "machine learning");
		assert.equal(termOf("C++"), "C++");
	});

	test("单字和超长正文都不是说法", () => {
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

	test("短文本的边界和说法的边界是两条：前者只限长度", () => {
		assert.equal(
			boundedText(`  ${"词".repeat(TEXT_MAX + 10)}  `)?.length,
			TEXT_MAX,
		);
		assert.equal(boundedText("   "), undefined);
	});
});

describe("不可信输入 → 要求", () => {
	test("没给强度就是「必须」；给了认不出的也按必须算，不丢词", () => {
		// 丢掉会静默放宽 AND 语义，而屏幕上看不出哪个条件被吃了。
		// 当成必须最多是收得太紧，那是看得见、点得掉的。
		assert.deepEqual(
			requirementsOf([
				{ members: ["线下渠道运营"] },
				{ members: ["带团队"], mode: "很重要" },
			]),
			[
				{ members: ["线下渠道运营"], mode: "must" },
				{ members: ["带团队"], mode: "must" },
			],
		);
	});

	test("三档强度与停用原样收下；没停用的身上不长 off", () => {
		assert.deepEqual(
			requirementsOf([
				{ members: ["渠道运营"], mode: "must" },
				{ members: ["带团队"], mode: "boost", off: true },
				{ members: ["实习"], mode: "exclude", off: "yes" },
			]),
			[
				{ members: ["渠道运营"], mode: "must" },
				{ members: ["带团队"], mode: "boost", off: true },
				{ members: ["实习"], mode: "exclude" },
			],
		);
	});

	test("说法跨要求去重，先出现的赢：同一个词既必须又排除是自相矛盾的输入", () => {
		assert.deepEqual(
			requirementsOf([
				{ members: ["算法", "深度学习"], mode: "must" },
				{ members: ["深度学习"], mode: "exclude" },
				{ members: ["算法"], mode: "boost" },
			]),
			[{ members: ["算法", "深度学习"], mode: "must" }],
		);
	});

	test("不合规的说法只丢那一个，其余照常；一个说法都不剩的要求整条消失", () => {
		assert.deepEqual(
			requirementsOf([
				{ members: ["算法", "  ", 7, "算"], mode: "must" },
				{ members: [], mode: "must" },
				{ members: ["的"] },
				null,
				"算法",
			]),
			[{ members: ["算法"], mode: "must" }],
		);
	});

	test("几条要求、每条几个说法都有上限，多的丢掉", () => {
		const many = Array.from({ length: REQUIREMENT_MAX + 3 }, (_, i) => ({
			members: [`条件${i}`],
		}));
		assert.equal(requirementsOf(many).length, REQUIREMENT_MAX);
		assert.deepEqual(
			requirementsOf([{ members: ["甲乙", "丙丁", "戊己", "庚辛", "壬癸"] }]),
			[
				{
					members: ["甲乙", "丙丁", "戊己", "庚辛"].slice(0, MEMBER_MAX),
					mode: "must",
				},
			],
		);
	});

	test("什么形状都不该抛", () => {
		for (const raw of [null, undefined, 0, "", {}, "一句话", [42], [[]]])
			assert.deepEqual(requirementsOf(raw), [], JSON.stringify(raw));
	});

	test("收窄是幂等的：合规的要求再过一遍一个字段都不变", () => {
		const once = requirementsOf([
			{ members: ["大模型", "多模态"], mode: "must" },
			{ members: ["带团队", "带项目"], mode: "boost", off: true },
			{ members: ["实习"], mode: "exclude" },
		]);
		assert.deepEqual(requirementsOf(once), once);
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
	const boost: Requirement = { members: ["带团队", "带项目"], mode: "boost" };

	test("停用与启用不碰强度、不碰说法", () => {
		const off = withOff(boost, true);
		assert.deepEqual(off, { ...boost, off: true });
		assert.deepEqual(withOff(off, false), boost);
	});

	test("activeRequirements 摘掉停用的，顺序不变", () => {
		const list = requirementsOf([
			{ members: ["算法"] },
			{ members: ["运营"], off: true },
			{ members: ["产品"] },
		]);
		assert.deepEqual(activeRequirements(list), [
			{ members: ["算法"], mode: "must" },
			{ members: ["产品"], mode: "must" },
		]);
	});
});

describe("查询有没有说话", () => {
	test("有一条要求就算说了，哪怕它是停用的；一条都没有就是空查询", () => {
		const one = requirementsOf([{ members: ["算法"], off: true }]);
		assert.equal(
			hasMeaning({ requirements: one, scope: {}, notices: [] }),
			true,
		);
		assert.equal(
			hasMeaning({ requirements: [], scope: {}, notices: [] }),
			false,
		);
	});
});
