/**
 * 要求的边界与不变量。这一层是纯函数：模型输出、RPC 入参、命令行敲的字都从
 * `requirementsOf` 这一个口子进来，所以「同一个词只留一枚」「说法不改字」
 * 「几条、几个说法」「用户的话在前、变体在后」在这里测一次，三条路一起算数。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	activeRequirements,
	boundedText,
	MAX_TERM_LEN,
	MEMBER_MAX,
	type Member,
	REQUIREMENT_MAX,
	type Requirement,
	requirementsOf,
	SAID_MAX,
	TEXT_MAX,
	termOf,
	withOff,
	withoutVariant,
} from "#/search/requirement";
import { hasMeaning } from "#/search/spec";

const said = (text: string): Member => ({ text, tier: "said" });
const same = (text: string): Member => ({ text, tier: "same" });
const near = (text: string): Member => ({ text, tier: "near" });

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
				{ members: [{ text: "线下渠道运营" }] },
				{ members: [said("带团队")], mode: "很重要" },
			]),
			[
				{ members: [said("线下渠道运营")], mode: "must" },
				{ members: [said("带团队")], mode: "must" },
			],
		);
	});

	test("没给来源就是用户说的；认不出的来源也按用户说的算", () => {
		assert.deepEqual(
			requirementsOf([{ members: [{ text: "算法", tier: "related" }] }]),
			[{ members: [said("算法")], mode: "must" }],
		);
	});

	test("三档强度与停用原样收下；没停用的身上不长 off", () => {
		assert.deepEqual(
			requirementsOf([
				{ members: [said("渠道运营")], mode: "must" },
				{ members: [said("带团队")], mode: "boost", off: true },
				{ members: [said("实习")], mode: "exclude", off: "yes" },
			]),
			[
				{ members: [said("渠道运营")], mode: "must" },
				{ members: [said("带团队")], mode: "boost", off: true },
				{ members: [said("实习")], mode: "exclude" },
			],
		);
	});

	test("用户的话排在前面，变体跟在后面，各自保持给出的顺序", () => {
		assert.deepEqual(
			requirementsOf([
				{
					members: [
						near("推荐算法"),
						said("算法"),
						same("算法工程"),
						said("模型"),
					],
				},
			]),
			[
				{
					members: [
						said("算法"),
						said("模型"),
						near("推荐算法"),
						same("算法工程"),
					],
					mode: "must",
				},
			],
		);
	});

	test("一个用户说法都没有的要求整条消失：变体没有依附", () => {
		assert.deepEqual(
			requirementsOf([{ members: [near("推荐算法"), same("算法工程")] }]),
			[],
		);
	});

	test("说法跨要求去重、不看来源，先出现的赢", () => {
		assert.deepEqual(
			requirementsOf([
				{ members: [said("算法"), near("深度学习")], mode: "must" },
				{ members: [said("深度学习")], mode: "exclude" },
				{ members: [said("算法")], mode: "boost" },
				{ members: [said("运营"), near("算法")] },
			]),
			[
				{ members: [said("算法"), near("深度学习")], mode: "must" },
				{ members: [said("运营")], mode: "must" },
			],
		);
	});

	test("不合规的说法只丢那一个，其余照常", () => {
		assert.deepEqual(
			requirementsOf([
				{
					members: [said("算法"), said("  "), 7, said("算"), null],
					mode: "must",
				},
				{ members: [], mode: "must" },
				{ members: [said("的")] },
				null,
				"算法",
			]),
			[{ members: [said("算法")], mode: "must" }],
		);
	});

	test("几条要求、每条几个用户说法、几个说法合计都有上限，多的丢掉", () => {
		const many = Array.from({ length: REQUIREMENT_MAX + 3 }, (_, i) => ({
			members: [said(`条件${i}`)],
		}));
		assert.equal(requirementsOf(many).length, REQUIREMENT_MAX);

		const saids = ["甲乙", "丙丁", "戊己", "庚辛", "壬癸"].map(said);
		assert.deepEqual(requirementsOf([{ members: saids }]), [
			{ members: saids.slice(0, SAID_MAX), mode: "must" },
		]);

		const variants = ["一二", "三四", "五六", "七八", "九十"].map(near);
		const [kept] = requirementsOf([{ members: [said("算法"), ...variants] }]);
		assert.equal(kept?.members.length, MEMBER_MAX);
		assert.deepEqual(kept?.members.slice(1), variants.slice(0, MEMBER_MAX - 1));
	});

	test("什么形状都不该抛", () => {
		for (const raw of [null, undefined, 0, "", {}, "一句话", [42], [[]]])
			assert.deepEqual(requirementsOf(raw), [], JSON.stringify(raw));
	});

	test("收窄是幂等的：合规的要求再过一遍一个字段都不变", () => {
		const once = requirementsOf([
			{ members: [said("大模型"), said("多模态"), same("LLM")], mode: "must" },
			{ members: [said("带团队"), near("带项目")], mode: "boost", off: true },
			{ members: [said("实习")], mode: "exclude" },
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
	const boost: Requirement = {
		members: [said("带团队"), said("带项目"), near("团队管理")],
		mode: "boost",
	};

	test("停用与启用不碰强度、不碰说法", () => {
		const off = withOff(boost, true);
		assert.deepEqual(off, { ...boost, off: true });
		assert.deepEqual(withOff(off, false), boost);
	});

	test("activeRequirements 摘掉停用的，顺序不变", () => {
		const list = requirementsOf([
			{ members: [said("算法")] },
			{ members: [said("运营")], off: true },
			{ members: [said("产品")] },
		]);
		assert.deepEqual(activeRequirements(list), [
			{ members: [said("算法")], mode: "must" },
			{ members: [said("产品")], mode: "must" },
		]);
	});
});

describe("删一个变体", () => {
	const r: Requirement = {
		members: [said("算法"), said("模型"), same("算法工程"), near("推荐算法")],
		mode: "must",
	};

	test("只删点名的那个变体，其余原样", () => {
		assert.deepEqual(withoutVariant(r, "推荐算法"), {
			members: [said("算法"), said("模型"), same("算法工程")],
			mode: "must",
		});
	});

	test("用户自己的说法不从这里删：点名它也不动", () => {
		assert.deepEqual(withoutVariant(r, "模型"), r);
		assert.deepEqual(withoutVariant(r, "算法"), r);
	});
});

describe("查询有没有说话", () => {
	test("有一条要求就算说了，哪怕它是停用的；一条都没有就是空查询", () => {
		const one = requirementsOf([{ members: [said("算法")], off: true }]);
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
