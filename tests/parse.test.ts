import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	activeChips,
	CHIP_MAX,
	parseChips,
	parseQuery,
	QUERY_TEXT_MAX,
	queryText,
	toQuery,
} from "#/search/parse";

test("按标点与连接词切成概念词", () => {
	assert.deepEqual(parseQuery("算法、产品、后端都做过的"), [
		"算法",
		"产品",
		"后端",
	]);
	assert.deepEqual(parseQuery("数据分析 城市经营"), ["数据分析", "城市经营"]);
});

test("剥掉句首动词与句尾赘字", () => {
	assert.deepEqual(parseQuery("找做过安全运营的人"), ["安全运营"]);
	assert.deepEqual(parseQuery("带过团队的城市经理"), ["团队", "城市经理"]);
});

test("末尾的语气词不能连词一起剥掉", () => {
	// 尾字剥离只认独立的语气词：「安全」的「全」是词的一部分，剥了就剩「安」
	assert.deepEqual(parseQuery("做过客服、现在做安全的"), ["客服", "安全"]);
	assert.deepEqual(parseQuery("安全"), ["安全"]);
});

test("只剩句式词时不产生概念词", () => {
	assert.deepEqual(parseQuery("帮我找人"), []);
	assert.deepEqual(parseQuery(""), []);
});

/**
 * 剥赘字最容易剥进词里。这几个词在招聘场景里都是高频的，剥错一个字之后
 * 检索的就不再是用户要的那个概念，而界面上没有任何提示。
 */
test("单字赘尾不剥：末尾的「人」多半是词的一半", () => {
	assert.deepEqual(parseQuery("机器人"), ["机器人"]);
	assert.deepEqual(parseQuery("负责人"), ["负责人"]);
	assert.deepEqual(parseQuery("经纪人"), ["经纪人"]);
});

test("跟着「的」的「人」才是赘尾", () => {
	assert.deepEqual(parseQuery("带过团队的人"), ["团队"]);
	assert.deepEqual(parseQuery("做过风控的人"), ["风控"]);
});

test("剥掉一个字就不足两字时，原样保留而不是交出碎片", () => {
	// 碎片会静默少掉一个 AND 约束，结果集变大而界面上看不出来
	assert.deepEqual(parseQuery("有赞"), ["有赞"]);
});

test("剥掉的是多字句式就照剥，剩下的停用词自然被滤掉", () => {
	assert.deepEqual(parseQuery("帮我找人"), []);
	assert.deepEqual(parseQuery("找人"), []);
});

test("超长的一段正文不是概念词", () => {
	// 松弛探测按子串窗口打库，长度是平方级；这里不设限，一次粘贴就能打爆
	assert.deepEqual(parseQuery("算法".repeat(150)), []);
	assert.deepEqual(parseQuery("产品经理"), ["产品经理"]);
});

describe("查询 chips", () => {
	test("查询文本和 chip 数量都有统一上限", () => {
		assert.equal(
			queryText(`  ${"词".repeat(QUERY_TEXT_MAX + 10)}  `)?.length,
			QUERY_TEXT_MAX,
		);
		const raw = Array.from({ length: CHIP_MAX + 3 }, (_, i) => `条件${i}`).join(
			",",
		);
		assert.equal(parseChips(raw).length, CHIP_MAX);
	});

	test("一句原话进来全是「必须」——默认语义不变", () => {
		assert.deepEqual(parseChips("做过线下渠道运营、带过团队的人"), [
			{ term: "线下渠道运营", mode: "must" },
			{ term: "团队", mode: "must" },
		]);
	});

	test("半角逗号分组，前缀定强度", () => {
		assert.deepEqual(parseChips("渠道运营,+带团队,-实习"), [
			{ term: "渠道运营", mode: "must" },
			{ term: "带团队", mode: "boost" },
			{ term: "实习", mode: "exclude" },
		]);
	});

	test("一组里切出多个词时，整组共用同一个强度", () => {
		assert.deepEqual(parseChips("+算法、产品"), [
			{ term: "算法", mode: "boost" },
			{ term: "产品", mode: "boost" },
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

	test("原话解析出的 chips 也能规范往返", () => {
		const chips = parseChips("算法、产品都做过的人");
		assert.deepEqual(parseChips(toQuery(chips)), chips);
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
 * 一条要求的多个说法：组内 `/` 与「或」是 OR，`?` 前缀是相近档（near）。
 * 语义（怎么检索、怎么计分）在 search/rank 那两层钉，这里只钉解析与往返。
 */
describe("说法（成员）语法", () => {
	test("「或」并列的说法归成一条要求", () => {
		assert.deepEqual(parseChips("大模型或推荐系统,带团队"), [
			{ term: "大模型", alts: ["推荐系统"], mode: "must" },
			{ term: "带团队", mode: "must" },
		]);
	});

	test("`/` 与 `?` 是我们自己写回的形态，读回来逐位一致", () => {
		for (const raw of [
			"算法/?深度学习/?机器学习",
			"大模型/推荐系统,+带团队",
			"~算法/?深度学习",
			"-实习/外包",
		]) {
			const chips = parseChips(raw);
			assert.deepEqual(parseChips(toQuery(chips)), chips, raw);
		}
	});

	test("排除组的 near 说法直接丢弃：赶人的词必须准", () => {
		assert.deepEqual(parseChips("-实习/?实习生"), [
			{ term: "实习", mode: "exclude" },
		]);
	});

	test("说法跨组去重，先出现的赢", () => {
		assert.deepEqual(parseChips("算法/?深度学习,深度学习"), [
			{ term: "算法", near: ["深度学习"], mode: "must" },
		]);
	});

	test("全是 near 时第一个提为主词：一条要求必须有标签", () => {
		assert.deepEqual(parseChips("?深度学习/?机器学习"), [
			{ term: "深度学习", near: ["机器学习"], mode: "must" },
		]);
	});

	test("没有说法记号的顿号句仍是几条 AND 要求，不被并成 OR", () => {
		assert.deepEqual(parseChips("渠道运营、带团队"), [
			{ term: "渠道运营", mode: "must" },
			{ term: "带团队", mode: "must" },
		]);
	});
});
