import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	activeChips,
	boundedText,
	CHIP_MAX,
	canonical,
	dropChip,
	editChip,
	enableAll,
	MAX_TERM_LEN,
	MEMBER_MAX,
	parseChips,
	QUERY_MAX,
	queryString,
	TEXT_MAX,
	termOf,
	toQuery,
} from "#/search/parse";
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
	});

	test("记号是语法不是字：词首的记号剥掉", () => {
		assert.equal(termOf("+带团队"), "带团队");
		assert.equal(termOf("~-实习"), "实习");
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
});

describe("查询 chips", () => {
	test("查询文本和 chip 数量都有统一上限", () => {
		assert.equal(
			boundedText(`  ${"词".repeat(TEXT_MAX + 10)}  `)?.length,
			TEXT_MAX,
		);
		const raw = Array.from({ length: CHIP_MAX + 3 }, (_, i) => `条件${i}`).join(
			",",
		);
		assert.equal(parseChips(raw).length, CHIP_MAX);
	});

	test("没有记号就是「必须」——默认语义不变", () => {
		assert.deepEqual(parseChips("线下渠道运营,带团队"), [
			{ term: "线下渠道运营", mode: "must" },
			{ term: "带团队", mode: "must" },
		]);
	});

	test("半角逗号分组，前缀定强度", () => {
		assert.deepEqual(parseChips("渠道运营,+带团队,-实习"), [
			{ term: "渠道运营", mode: "must" },
			{ term: "带团队", mode: "boost" },
			{ term: "实习", mode: "exclude" },
		]);
	});

	test("逗号之外的分隔都是字的一部分：没有第二套切词", () => {
		assert.deepEqual(parseChips("+算法、产品"), [
			{ term: "算法、产品", mode: "boost" },
		]);
	});

	test("同一个词只留第一次出现的那个强度，不自相矛盾", () => {
		assert.deepEqual(parseChips("算法,-算法"), [
			{ term: "算法", mode: "must" },
		]);
	});

	test("空组、只有一个符号的组都跳过，不产出空 chip", () => {
		assert.deepEqual(parseChips("算法,,+, ,-"), [
			{ term: "算法", mode: "must" },
		]);
	});

	test("规范查询串往返必须一模一样", () => {
		for (const raw of [
			"渠道运营,+带团队,-实习",
			"算法",
			"-实习,+数据分析,城市经营",
		]) {
			const chips = parseChips(raw);
			assert.deepEqual(parseChips(toQuery(chips)), chips, raw);
		}
	});

	test("规范化只改写法不改字：含空格与顿号的说法原样往返", () => {
		const chips = parseChips(" 算法、产品 , machine learning ");
		assert.deepEqual(parseChips(toQuery(chips)), chips);
		assert.equal(
			canonical(" 算法、产品 , machine learning "),
			"算法、产品,machine learning",
		);
	});
});

/**
 * 停用（`~`）。
 *
 * 它和三档强度**正交**，这是它值得多一个字段而不是多一档强度的全部理由：
 * 停一个加分词再开回来，它必须还是加分词。做成第四档强度的话，那次退化
 * 会安静地发生，界面上没有任何提示。
 */
describe("停用的词", () => {
	test("`~` 叠在强度符号前面，强度原样留着", () => {
		assert.deepEqual(parseChips("~渠道运营,~+带团队,~-实习"), [
			{ term: "渠道运营", mode: "must", off: true },
			{ term: "带团队", mode: "boost", off: true },
			{ term: "实习", mode: "exclude", off: true },
		]);
	});

	test("没停用的词身上不长这个字段——默认状态不该有记号", () => {
		assert.deepEqual(parseChips("算法"), [{ term: "算法", mode: "must" }]);
	});

	test("停用和启用混在一句里，各归各的", () => {
		assert.deepEqual(parseChips("算法,~+运营"), [
			{ term: "算法", mode: "must" },
			{ term: "运营", mode: "boost", off: true },
		]);
	});

	test("往返：停用状态也得原样序列化再读回来", () => {
		for (const raw of ["~算法", "~+运营,城市经营", "~-实习,~+数据分析"]) {
			const chips = parseChips(raw);
			assert.deepEqual(parseChips(toQuery(chips)), chips, raw);
		}
	});

	test("只有一个 `~` 的组不产出空 chip", () => {
		assert.deepEqual(parseChips("算法,~,~+"), [{ term: "算法", mode: "must" }]);
	});

	test("activeChips 摘掉停用的，顺序不变", () => {
		const chips = parseChips("算法,~运营,产品");
		assert.deepEqual(activeChips(chips), [
			{ term: "算法", mode: "must" },
			{ term: "产品", mode: "must" },
		]);
	});
});

/**
 * 一条要求的多个说法：组内 `/` 是 OR。
 * 语义（怎么检索、怎么计分）在 search/rank 那两层测，这里只测解析与往返。
 */
describe("说法（成员）语法", () => {
	test("`/` 并列的说法归成一条要求", () => {
		assert.deepEqual(parseChips("大模型/推荐系统,带团队"), [
			{ term: "大模型", alts: ["推荐系统"], mode: "must" },
			{ term: "带团队", mode: "must" },
		]);
	});

	test("`/` 是我们自己写回的形态，读回来逐位一致", () => {
		for (const raw of [
			"算法/深度学习/机器学习",
			"大模型/推荐系统,+带团队",
			"~算法/深度学习",
			"-实习/外包",
		]) {
			const chips = parseChips(raw);
			assert.deepEqual(parseChips(toQuery(chips)), chips, raw);
		}
	});

	test("说法跨组去重，先出现的赢", () => {
		assert.deepEqual(parseChips("算法/深度学习,深度学习"), [
			{ term: "算法", alts: ["深度学习"], mode: "must" },
		]);
	});

	test("一条要求最多四个说法，多的丢掉", () => {
		assert.deepEqual(parseChips("甲乙/丙丁/戊己/庚辛/壬癸"), [
			{ term: "甲乙", alts: ["丙丁", "戊己", "庚辛"], mode: "must" },
		]);
	});

	test("「或」是自然语言，不是语法：翻译它是模型的事", () => {
		assert.deepEqual(parseChips("大模型或推荐系统"), [
			{ term: "大模型或推荐系统", mode: "must" },
		]);
	});
});

/**
 * 改一条已有查询：串进串出。
 *
 * 这一组测的不是某个按钮的行为，是**编辑不许有第二种做法**这条不变量。
 * 每个调用点各自拼一个 chip 对象写回去的话，「一键启用全部条件」就会把并列
 * 说法拼没——`{term, mode}` 少写一个 `alts`，类型检查、构建、界面测试全绿，
 * 只有用户看得见自己的说法少了一个。所以编辑只有这三个函数，它们从解析出来的
 * chip 出发、原样带着其余字段写回去，没有拼装的机会。
 */
describe("查询编辑", () => {
	const Q = "大模型/多模态,~+带团队/带项目,-实习";

	test("改强度不碰说法，也不碰停用", () => {
		assert.equal(
			editChip(Q, 1, { mode: "must" }),
			"大模型/多模态,~带团队/带项目,-实习",
		);
	});

	test("停用与启用不碰强度：`~+X` 开回来还是加分词", () => {
		const off = editChip("+带团队", 0, { off: true });
		assert.equal(off, "~+带团队");
		assert.equal(editChip(off, 0, { off: false }), "+带团队");
	});

	test("删掉一条只删这一条", () => {
		assert.equal(dropChip(Q, 1), "大模型/多模态,-实习");
	});

	test("一键启用保住每一条的强度和全部说法", () => {
		assert.equal(
			enableAll("~大模型/多模态,~+带团队/带项目,-实习"),
			"大模型/多模态,+带团队/带项目,-实习",
		);
	});

	test("任何一次编辑之后仍然是规范串，改的只有目标那一枚", () => {
		const chips = parseChips(Q);
		for (const [i] of chips.entries())
			for (const patch of [
				{ mode: "boost" as const },
				{ off: true },
				{ off: false },
			]) {
				const next = editChip(Q, i, patch);
				assert.equal(canonical(next), next, `${i} ${JSON.stringify(patch)}`);
				assert.deepEqual(
					parseChips(next).filter((_, j) => j !== i),
					chips.filter((_, j) => j !== i),
					"别的要求一个字段都不该动",
				);
			}
	});
});

describe("规范化与长度边界", () => {
	test("规范化是幂等的：同一份含义只有一种写法", () => {
		for (const raw of [
			"渠道运营 , 带团队",
			"大模型/推荐系统, +带团队 ,-实习",
			"~+运营",
		]) {
			const once = canonical(raw);
			assert.equal(canonical(once), once, raw);
			assert.deepEqual(parseChips(once), parseChips(raw), raw);
		}
	});

	test("查询串的上限由部件推导，不是另立的一个数", () => {
		// 写死 25 的话，调大词长那天这条边界会在别处安静地把查询截断
		assert.equal(QUERY_MAX, CHIP_MAX * (MEMBER_MAX * (MAX_TERM_LEN + 1) + 2));
		// 收窄只保证载荷有界；含义上的上限（几条要求、几个说法）仍归 parseChips
		assert.equal(queryString(123), "");
		assert.equal(queryString("算".repeat(QUERY_MAX + 10)).length, QUERY_MAX);
	});
});

/**
 * 往返恒等式对**任何**输入串都得成立，不只对我们自己写回去的那些。
 *
 * 这三条不变量是「查询的唯一表示是那串规范查询串」的全部内容：规范化幂等、
 * 解析→写回→再解析不变、`hasMeaning` 和解析结果说的是同一件事。它们只要有
 * 一条在某个输入上破了，症状就是「我的说法怎么少了一个」或者「明明有条件却
 * 说查询为空」——类型、构建、界面测试全绿。
 *
 * 所以这里不举例子，拿一批**故意写歪的**串逐条过：记号混进说法里、说法里
 * 又有停用号、重复说法、空说法、一个字、超长、各种分隔符、中英文混排。
 */
describe("规范查询串的不变量", () => {
	const ADVERSARIAL = [
		"",
		" ",
		",,,",
		"//",
		"~",
		"+",
		"-",
		"~+",
		"+b",
		"a/+b",
		"大模型/+带团队",
		"大模型/~带团队",
		"~-实习/+实习",
		"+++算法",
		"-~算法",
		"算法/算法",
		"算法//带团队",
		"算法, 算法",
		"算法/",
		"/算法",
		"a",
		"算",
		"算法".repeat(MAX_TERM_LEN),
		`+${"算法".repeat(MAX_TERM_LEN)}`,
		"算法、产品，后端 增长",
		"大模型或者推荐系统",
		"~+带团队,-实习,大模型/多模态",
		"algorithm/machine learning",
		"C++/Java",
		"帮我找做过算法的人",
		"a".repeat(QUERY_MAX + 10),
		[...Array(CHIP_MAX + 3).keys()].map((i) => `词${i}${i}`).join(","),
	];

	test("规范化是幂等的", () => {
		for (const raw of ADVERSARIAL)
			assert.equal(canonical(canonical(raw)), canonical(raw), raw);
	});

	test("解析→写回→再解析一个字段都不差", () => {
		for (const raw of ADVERSARIAL) {
			const chips = parseChips(raw);
			assert.deepEqual(parseChips(toQuery(chips)), chips, raw);
		}
	});

	test("说法永远不以记号开头：记号是语法，不是字", () => {
		for (const raw of ADVERSARIAL)
			for (const chip of parseChips(raw))
				for (const member of [chip.term, ...(chip.alts ?? [])])
					assert.doesNotMatch(member, /^[~+-]/, `${raw} → ${member}`);
	});

	test("解析不出条件的串就是空查询，没有第三种状态", () => {
		for (const raw of ADVERSARIAL) {
			const spec = { evidence: canonical(raw), scope: {}, notices: [] };
			assert.equal(hasMeaning(spec), parseChips(spec.evidence).length > 0, raw);
		}
	});
});
