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
	MEMBER_MAX,
	parseChips,
	parseQuery,
	QUERY_MAX,
	queryString,
	TEXT_MAX,
	toQuery,
} from "#/search/parse";

test("按标点与连接词切成要求", () => {
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

test("只剩句式词时不产生要求", () => {
	assert.deepEqual(parseQuery("帮我找人"), []);
	assert.deepEqual(parseQuery(""), []);
});

/**
 * 剥赘字最容易剥进词里。这几个词在招聘场景里都是高频的，剥错一个字之后
 * 检索的就不再是用户要的那条要求，而界面上没有任何提示。
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

test("超长的一段正文不是要求", () => {
	// 一次粘贴进来的正文会被原样送去嵌入，再拿一个「段落向量」去和短短的岗位名比
	assert.deepEqual(parseQuery("算法".repeat(150)), []);
	assert.deepEqual(parseQuery("产品经理"), ["产品经理"]);
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
 * 一条要求的多个说法：组内 `/` 与「或」是 OR。
 * 语义（怎么检索、怎么计分）在 search/rank 那两层钉，这里只钉解析与往返。
 */
describe("说法（成员）语法", () => {
	test("「或」并列的说法归成一条要求", () => {
		assert.deepEqual(parseChips("大模型或推荐系统,带团队"), [
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

	test("没有说法记号的顿号句仍是几条 AND 要求，不被并成 OR", () => {
		assert.deepEqual(parseChips("渠道运营、带团队"), [
			{ term: "渠道运营", mode: "must" },
			{ term: "带团队", mode: "must" },
		]);
	});
});

/**
 * 改一条已有查询：串进串出。
 *
 * 这一组钉的不是某个按钮的行为，是**编辑不许有第二种做法**这条不变量。
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
			"做过渠道运营、带过团队的人",
			"大模型或推荐系统, +带团队 ,-实习",
			"~+运营",
		]) {
			const once = canonical(raw);
			assert.equal(canonical(once), once, raw);
			assert.deepEqual(parseChips(once), parseChips(raw), raw);
		}
	});

	test("查询串的上限由部件推导，不是另立的一个数", () => {
		assert.equal(QUERY_MAX, CHIP_MAX * (MEMBER_MAX * 25 + 2));
		// 收窄只保证载荷有界；含义上的上限（几条要求、几个说法）仍归 parseChips
		assert.equal(queryString(123), "");
		assert.equal(queryString("算".repeat(QUERY_MAX + 10)).length, QUERY_MAX);
	});
});
