/**
 * 检索语义的集成测试。跑在临时 schema 上的真 SQL、真 pgvector。
 *
 * 打分本身不在这里——它是纯函数，在 `tests/rank.test.ts` 里测，不必起数据库。
 * 这里管的是打分**够得着的事实**：哪一路过了阈值、相关度、月数和结束日期
 * 有没有原样传到打分那一层。列名或日期序列化错误只有走真 SQL 才看得见，
 * 而纯函数测试对它完全无感。
 *
 * 另外三件事各有自己的文件，因为它们要的语料和这里不是一份：语料锁
 * （`search-snapshot.test.ts`，其中一条真的把整库换掉了）、写入约束
 * （`search-constraints.test.ts`）、分面口径（`facets.test.ts`，那条穷举
 * 不变量需要一份说得清的语料）。
 *
 * 嵌入是假的（见 fixture.ts 的 `fakeEmbedding`）：相关度 = 共有字数 / √(字数×字数)，
 * 所以每条断言旁边都算得出那个数。「算法」对「算法工程师」是 2/√(2×5) ≈ 0.63，
 * 过 `RELEVANCE_MIN`；对「算法平台运维工程师」是 2/√(2×9) ≈ 0.47，不过。
 * 种子里的文本都按这把尺挑过，它们测的是机制，不是语义。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { NOT_A_VALUE, VOCAB_KEYS } from "#/search/dimensions";
import { parseQuery } from "#/search/query-syntax";
import { fakeSimilarity, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 与 #/server/embed 在模块求值时就绑死了环境变量
const { overflowContributors, probeWide, search, vocabulary } = await import(
	"#/search/search"
);
const run = async (query: string, filters = {}, limit?: number) => {
	const outcome = await search(
		{ requirements: parseQuery(query), scope: {}, notices: [] },
		filters,
		limit,
	);
	assert.equal(outcome.order, "relevance");
	if (outcome.order !== "relevance")
		throw new Error("要求查询未进入相关度路径");
	return outcome;
};
const { RESULT_PAGE, RECALL_MIN, RELEVANCE_MIN, RELEVANCE_MIN_EXCLUDE } =
	await import("#/search/weights");

before(async () => {
	await seed([
		{
			empId: "T001",
			name: "两词都受控",
			segments: [
				{ seqL2: "算法", months: 36 },
				{ title: "运营", months: 24, kind: "external" },
			],
		},
		{
			empId: "T002",
			name: "只命中一个词",
			segments: [{ title: "算法工程师", months: 36 }],
		},
		{
			empId: "T003",
			name: "两词都只是简历里提过",
			segments: [
				{
					kind: "external",
					months: 36,
					org: "某公司",
					description: "算法运营",
				},
			],
		},
		{
			empId: "T004",
			name: "同段既在部门名又在简历里",
			segments: [{ org: "安全部", description: "安全巡检", months: 36 }],
		},
		{
			empId: "T005",
			name: "同一个词命中长短两段",
			segments: [
				{ seqL2: "算法", months: 3 },
				{ seqL2: "算法", months: 36 },
				{ title: "运营", months: 36 },
			],
		},
		{
			empId: "T006",
			name: "序列里写着渠道运营",
			segments: [{ seqL2: "渠道运营", months: 36 }],
		},
		{
			empId: "T007",
			name: "岗位名太长，相关度不过线",
			segments: [{ title: "算法平台运维工程师", months: 36 }],
		},
		{
			empId: "T008",
			name: "同权重路径稳定并列",
			segments: [{ seqL2: "算法", title: "算法", months: 36 }],
		},
		{
			empId: "T009",
			name: "能力词与做过的事是从简历里抽出来的",
			segments: [
				{
					kind: "external",
					months: 36,
					org: "某公司",
					description: "负责服务端",
					skills: ["Python", "Spark"],
					did: [{ involvement: "从零搭建", domain: "推荐系统" }],
				},
			],
		},
		{
			empId: "T010",
			name: "岗位名恰好和别人的能力词是同一串字",
			segments: [{ title: "Python", months: 36 }],
		},
	]);
});

describe("抽取的两路", () => {
	test("能力词命中时证据行带回命中的那条说法", async () => {
		const { results } = await run("Python");
		const hit = results
			.find((r) => r.employee.empId === "T009")
			?.hits.find((h) => h.term === "Python");
		assert.equal(hit?.route, "skill");
		assert.equal(hit?.phrase, "Python");
	});

	test("同一段可以有多条能力词，各自独立作证", async () => {
		// 主键是（段、路、说法）三列：两条能力词落在同一段上，AND 要两个都过
		const { results } = await run("Python,Spark");
		assert.ok(results.some((r) => r.employee.empId === "T009"));
	});

	test("做过的事只拿领域比相关度，参与方式随命中带回来", async () => {
		const { results } = await run("推荐系统");
		const hit = results
			.find((r) => r.employee.empId === "T009")
			?.hits.find((h) => h.term === "推荐系统");
		assert.equal(hit?.route, "did");
		assert.equal(hit?.phrase, "推荐系统");
		assert.equal(hit?.involvement, "从零搭建");
	});

	test("参与方式不进向量：查它本身命不中做过的事", async () => {
		const { results } = await run("从零搭建");
		const hit = results
			.find((r) => r.employee.empId === "T009")
			?.hits.find((h) => h.route === "did");
		assert.equal(hit, undefined);
	});

	test("同一串字既是岗位名又是能力词时各归各的路，原文路不带说法文本", async () => {
		const { results } = await run("Python");
		const hit = results
			.find((r) => r.employee.empId === "T010")
			?.hits.find((h) => h.term === "Python");
		assert.equal(hit?.route, "title");
		assert.equal(hit?.phrase, null);
		assert.equal(hit?.involvement, null);
	});

	test("能力词和简历原文同档：受控命中仍排在前面", async () => {
		const { results } = await run("Python");
		const rank = results.map((r) => r.employee.empId);
		assert.ok(rank.indexOf("T010") < rank.indexOf("T009"));
	});
});

describe("事实行保险丝", () => {
	test("按事实贡献选择最少数量的主要要求，不借用人数覆盖率", () => {
		assert.deepEqual(
			overflowContributors(
				[
					{ termIdx: 0, facts: 40 },
					{ termIdx: 1, facts: 120 },
					{ termIdx: 2, facts: 90 },
				],
				100,
			),
			[1, 2],
		);
	});

	test("没有超过上限时不虚构贡献者", () => {
		assert.deepEqual(
			overflowContributors(
				[
					{ termIdx: 0, facts: 40 },
					{ termIdx: 1, facts: 60 },
				],
				100,
			),
			[],
		);
	});
});

describe("语义命中", () => {
	test("假端点下通过的阈值只有一个数：召回下限不高于判定线", () => {
		// 假重排分数就是假余弦。召回下限必须覆盖判定线，下面每条断言才由
		// RELEVANCE_MIN 这一个成员门槛决定。
		assert.ok(RECALL_MIN <= RELEVANCE_MIN);
	});

	test("整词不必出现在原文里：相关度过阈值就是命中", async () => {
		// 「线下渠道运营」对序列「渠道运营」是 4/√(6×4) ≈ 0.82
		assert.ok(fakeSimilarity("线下渠道运营", "渠道运营") >= RELEVANCE_MIN);
		const { results } = await run("线下渠道运营");
		assert.ok(results.some((r) => r.employee.empId === "T006"));
	});

	test("相关度不过阈值的段不算命中", async () => {
		// 「算法」对「算法平台运维工程师」是 2/√(2×9) ≈ 0.47
		assert.ok(fakeSimilarity("算法", "算法平台运维工程师") < RELEVANCE_MIN);
		const { results } = await run("算法");
		assert.ok(!results.some((r) => r.employee.empId === "T007"));
	});

	test("语料里完全不相干的词一个人都匹配不到", async () => {
		const { results } = await run("量子炼金");
		assert.equal(results.length, 0);
	});

	test("相关度原样到达打分层与证据行", async () => {
		const { results } = await run("算法");
		const t2 = results.find((r) => r.employee.empId === "T002");
		const expected = fakeSimilarity("算法", "算法工程师");
		assert.ok(Math.abs((t2?.basis[0]?.relevance ?? 0) - expected) < 0.01);
		assert.ok(Math.abs((t2?.hits[0]?.relevance ?? 0) - expected) < 0.01);
		const t1 = results.find((r) => r.employee.empId === "T001");
		assert.equal(t1?.basis[0]?.relevance, 1, "原文和条件一字不差就是 1");
	});
});

describe("AND 语义", () => {
	test("每条要求都要命中，缺一个就被淘汰", async () => {
		const { results } = await run("算法,运营");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "两词都命中的人应当在结果里");
		assert.ok(!ids.includes("T002"), "只命中「算法」的人必须被淘汰");
	});

	test("两个词可以落在不同的经历段上", async () => {
		const { results } = await run("算法,运营");
		const t001 = results.find((r) => r.employee.empId === "T001");
		const segs = new Set(t001?.hits.map((h) => h.experienceId));
		assert.equal(segs.size, 2, "两个词应当来自两段不同的经历");
	});

	test("没有可检索要求时不返回任何人", async () => {
		const { terms, results } = await run("~算法,~运营");
		assert.equal(terms.length, 0);
		assert.equal(results.length, 0);
	});
});

describe("结构化范围是独立的候选定义", () => {
	test("没有语义要求也能按范围找到人，不调用向量词伪造候选", async () => {
		const outcome = await search({
			requirements: parseQuery(""),
			scope: { kind: "external" },
			notices: [],
		});
		assert.equal(outcome.order, "employee");
		assert.deepEqual(
			outcome.results.map((result) => result.employee.empId),
			["T001", "T003", "T009"],
		);
		assert.ok(outcome.results.every((result) => !("hits" in result)));
		assert.deepEqual(outcome.facets.kind, [{ value: "external", n: 3 }]);
	});

	test("查询范围是硬约束，视图只能继续收窄，不能换掉它", async () => {
		const outcome = await search(
			{
				requirements: parseQuery(""),
				scope: { kind: "external" },
				notices: [],
			},
			{ kind: "internal" },
		);
		assert.equal(outcome.total, 0);
	});

	test("有语义要求时，范围约束的是能够作证的经历段", async () => {
		const outcome = await search({
			requirements: parseQuery("算法"),
			scope: { kind: "external" },
			notices: [],
		});
		assert.deepEqual(
			outcome.results.map((result) => result.employee.empId),
			["T003"],
		);
	});
});

/**
 * 结构化范围的分面和语义检索的分面是**同一件东西**：值域只随查询变，计数随
 * 筛选变。两条路各写一份求值器的话，同一栏筛选在结构化查询下会变成「点一项，
 * 别的维度里凑不出人的行当场消失」——而那正是筛选栏不能被信任的样子。
 */
describe("结构化范围的分面口径", () => {
	before(async () => {
		await seed([
			{
				empId: "S001",
				name: "范围甲",
				curLevel: "P4",
				recruitment: "校招",
				segments: [
					{
						kind: "external",
						title: "星际护卫",
						months: 12,
						companyTag: "星域联盟",
					},
				],
			},
			{
				empId: "S002",
				name: "范围乙",
				curLevel: "P9",
				recruitment: "社招",
				segments: [
					{
						kind: "external",
						title: "星际护卫",
						months: 12,
						companyTag: "星域联盟",
					},
				],
			},
		]);
	});

	test("点了一维之后，别的维度被挤成 0 的行留在原地", async () => {
		const scope = { companyTag: ["星域联盟"] };
		const base = await search({
			requirements: parseQuery(""),
			scope,
			notices: [],
		});
		assert.equal(base.total, 2);
		assert.deepEqual(base.facets.recruitment, [
			{ value: "社招", n: 1 },
			{ value: "校招", n: 1 },
		]);

		const picked = await search(
			{ requirements: parseQuery(""), scope, notices: [] },
			{
				level: ["P4"],
			},
		);
		assert.equal(picked.total, 1);
		assert.deepEqual(
			picked.facets.recruitment,
			[
				{ value: "校招", n: 1 },
				{ value: "社招", n: 0 },
			],
			"值域只随查询变：被职级挤到 0 的那一行写着 0，不消失",
		);
	});
});

describe("命中路径判定", () => {
	test("一段同时几路过阈值时取加权相关度最高的那一路", async () => {
		// 「安全」对部门「安全部」0.82 × 0.5，对描述「安全巡检」0.71 × 0.25：
		// 必须判成 org。
		const { results } = await run("安全");
		const hit = results
			.find((r) => r.employee.empId === "T004")
			?.hits.find((h) => h.term === "安全");
		assert.equal(hit?.route, "org");
	});

	test("加权强度相同时按全站路径顺序稳定选择", async () => {
		const { results } = await run("算法");
		const hit = results
			.find((result) => result.employee.empId === "T008")
			?.hits.find((item) => item.term === "算法");
		assert.equal(hit?.route, "seq");
	});

	test("受控字段命中排在仅简历自述之前", async () => {
		const { results } = await run("算法,运营");
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("T001") < rank.indexOf("T003"),
			"序列＋岗位命中应当排在两词都只是简历提及的人之前",
		);
	});
});

/**
 * 打分够得着的事实。
 *
 * 打分公式本身在 rank.test.ts 里测，这里只验一件事：**月数和结束日期确实
 * 原样穿过了 SQL 到达打分层**。这两个字段任何一个在取数那一层丢掉或者写错列名，
 * 纯函数测试都照样全绿，而界面上的表现是「排序看起来有点怪」——没有任何断言会红。
 */
describe("月数与结束日期到得了打分层", () => {
	before(async () => {
		await seed([
			{
				empId: "R001",
				name: "还在做",
				segments: [{ seqL2: "考古", months: 24 }],
			},
			{
				empId: "R002",
				name: "十年前做过",
				segments: [{ seqL2: "考古", months: 24, endDate: "2015-01-01" }],
			},
			{
				empId: "R003",
				name: "还在做且做得久",
				segments: [
					{ seqL2: "考古", months: 24 },
					{ seqL2: "考古", months: 24 },
				],
			},
		]);
	});

	test("还在做的排在早就不做的前面", async () => {
		const { results } = await run("考古");
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("R001") < rank.indexOf("R002"),
			"近因因子没生效：end_date 没传到打分层",
		);
	});

	test("累计时长合并同一路径的全部经历段", async () => {
		const { results } = await run("考古");
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("R003") < rank.indexOf("R001"),
			"两段 24 个月应当胜过一段 24 个月",
		);
	});

	test("同一批人不会再挤成一个分数", async () => {
		const { results } = await run("考古");
		const scores = new Set(results.map((r) => r.score));
		assert.equal(scores.size, 3, "三个人三个分数，排序才有分辨率");
	});
});

describe("筛选条件", () => {
	test("只看入职前经历会排除仅有在职命中的人", async () => {
		const { results } = await run("算法", { kind: "external" });
		assert.ok(!results.some((r) => r.employee.empId === "T001"));
	});

	test("最短时长会滤掉短段", async () => {
		const { results } = await run("算法", { minMonths: 30 });
		assert.ok(results.some((r) => r.employee.empId === "T005"));
		const basis = results
			.find((r) => r.employee.empId === "T005")
			?.basis.find((b) => b?.term === "算法");
		assert.equal(basis?.months, 36);
	});

	test("收窄筛选只会让人变少，不会变多", async () => {
		const plain = await run("算法");
		const narrowed = await run("算法", { kind: "external" });
		assert.ok(narrowed.total < plain.total, "这个筛选真的筛掉了人");
	});
});

/**
 * 跟人走的筛选：职级、招聘渠道、学历是分面，公司名、学校名是精确文本条件。
 * 后两者是专有名词，永远不进向量——「字节」对「腾讯」在向量空间里是邻居。
 */
describe("跟人走的筛选", () => {
	before(async () => {
		await seed([
			{
				empId: "P001",
				name: "六级校招硕士",
				curLevel: "P6",
				recruitment: "校招",
				education: "硕士",
				school: "明德大学",
				segments: [{ seqL2: "潜水", months: 12 }],
			},
			{
				empId: "P002",
				name: "七级社招本科待过字节",
				curLevel: "P7",
				recruitment: "社招",
				education: "本科",
				school: "北岭大学",
				segments: [
					{ seqL2: "潜水", months: 12 },
					{ kind: "external", org: "字节跳动", title: "产品经理", months: 24 },
				],
			},
			{
				empId: "P003",
				name: "七级校招硕士",
				curLevel: "P7",
				recruitment: "校招",
				education: "硕士",
				school: "明德大学",
				segments: [{ seqL2: "潜水", months: 12 }],
			},
		]);
	});

	test("三个分面数的都是人，职级按名字排", async () => {
		const { facets, total } = await run("潜水");
		assert.equal(total, 3);
		assert.deepEqual(facets.level, [
			{ value: "P6", n: 1 },
			{ value: "P7", n: 2 },
		]);
		assert.deepEqual(facets.recruitment, [
			{ value: "校招", n: 2 },
			{ value: "社招", n: 1 },
		]);
		assert.deepEqual(facets.education, [
			{ value: "硕士", n: 2 },
			{ value: "本科", n: 1 },
		]);
	});

	test("职级筛选收窄人群，且这一维自己的候选不受自己影响", async () => {
		const { facets, total } = await run("潜水", {
			level: "P7",
		});
		assert.equal(total, 2);
		assert.equal(facets.level.find((l) => l.value === "P6")?.n, 1);
		// 别的维度按筛过的人群数
		assert.deepEqual(facets.education, [
			{ value: "本科", n: 1 },
			{ value: "硕士", n: 1 },
		]);
	});

	test("公司名是按人裁的精确条件，分面随之只数剩下的人", async () => {
		const { results, facets } = await run("潜水", {
			org: "字节",
		});
		assert.deepEqual(
			results.map((r) => r.employee.empId),
			["P002"],
		);
		assert.deepEqual(facets.level, [{ value: "P7", n: 1 }]);
	});

	test("偏好的公司名不裁人，只把满足的人排到前面", async () => {
		const spec = {
			requirements: parseQuery("潜水"),
			scope: {},
			prefer: { org: "字节" },
			notices: [],
		};
		const preferred = await search(spec);
		const plain = await search({ ...spec, prefer: undefined });
		assert.equal(preferred.total, 3);
		assert.equal(preferred.results[0]?.employee.empId, "P002");
		assert.equal(preferred.order, "relevance");
		assert.equal(plain.order, "relevance");
		if (preferred.order !== "relevance" || plain.order !== "relevance") return;
		// 只有满足偏好的那个人的分变了，其余原样
		const by = (o: typeof plain) =>
			new Map(o.results.map((r) => [r.employee.empId, r.score]));
		const a = by(preferred);
		const b = by(plain);
		assert.ok((a.get("P002") ?? 0) > (b.get("P002") ?? 0));
		assert.equal(a.get("P001"), b.get("P001"));
		assert.equal(a.get("P003"), b.get("P003"));
	});

	test("只有偏好的查询是「所有人，满足的在前」", async () => {
		const outcome = await search({
			requirements: [],
			scope: {},
			prefer: { org: "字节" },
			notices: [],
		});
		assert.equal(outcome.order, "employee");
		// 没有范围就是全库的人，不止这一组的三个
		assert.ok(outcome.total > 3);
		assert.equal(outcome.results[0]?.employee.empId, "P002");
	});

	test("学校名同理", async () => {
		const { results } = await run("潜水", { school: "明德" });
		assert.deepEqual(results.map((r) => r.employee.empId).sort(), [
			"P001",
			"P003",
		]);
	});

	test("文本条件里的通配符只能是字面量", async () => {
		// 不转义的话「%%」就让每一行恒真，这个条件等于没筛
		assert.equal((await run("潜水", { org: "%%" })).total, 0);
		assert.equal((await run("潜水", { school: "明_大学" })).total, 0);
	});

	/**
	 * 词表是模型挑筛选值时唯一能看的东西。逐维手写断言的话，加一维就会有一维
	 * 没人验，而症状是模型对那一维永远挑不出值——不报错，只是少认一维。
	 */
	test("每一维都有词表，取值都是语料里真有的", async () => {
		const v = await vocabulary();
		assert.deepEqual(Object.keys(v).sort(), [...VOCAB_KEYS].sort());
		for (const key of VOCAB_KEYS) {
			assert.ok(v[key].length > 0, `${key} 一个取值都没数出来`);
			assert.ok(!v[key].includes(""), `${key} 把空串当成了取值`);
			for (const notValue of NOT_A_VALUE)
				assert.ok(
					!v[key].includes(notValue),
					`${key} 把「${notValue}」当成了取值`,
				);
		}
		assert.ok(v.level.includes("P6") && v.level.includes("P7"));
		assert.ok(v.recruitment.includes("校招") && v.recruitment.includes("社招"));
		assert.ok(v.education.includes("硕士") && v.education.includes("本科"));
		assert.ok(v.companyTag.includes("星域联盟"));
	});
});

describe("入职前经历对齐的序列", () => {
	before(async () => {
		await seed([
			{
				empId: "A001",
				name: "入职前在别处做算法",
				segments: [
					{
						kind: "external",
						months: 36,
						org: "某公司",
						title: "深海算法工程师",
						seqInferredL1: "技术",
						seqInferredL2: "深海算法",
					},
				],
			},
			{
				empId: "A002",
				name: "入职前经历无法对齐",
				segments: [
					{
						kind: "external",
						months: 36,
						org: "某公司",
						title: "深海算法工程师",
					},
				],
			},
		]);
	});

	test("序列筛选把对齐的段算进去，无法对齐的段不算", async () => {
		const seq = [{ l1: "技术", l2: "深海算法" }];
		const { results } = await run("深海算法工程师", { seq });
		assert.deepEqual(
			results.map((r) => r.employee.empId).filter((id) => id.startsWith("A")),
			["A001"],
		);
	});

	test("分面里对齐的序列和登记的序列是同一个口径", async () => {
		const { facets } = await run("深海算法工程师");
		const seq = facets.seq.find((s) => s.value.l2 === "深海算法");
		assert.deepEqual(seq, { value: { l1: "技术", l2: "深海算法" }, n: 1 });
	});

	test("对齐的序列不做证据：命中的只有岗位名那一路", async () => {
		const { results } = await run("深海算法");
		const hit = results.find((r) => r.employee.empId === "A001");
		assert.ok(hit);
		assert.ok(hit.hits.every((h) => h.route !== "seq"));
	});
});

describe("命中总数", () => {
	before(async () => {
		await seed(
			Array.from({ length: 55 }, (_, i) => ({
				empId: `L${String(i).padStart(3, "0")}`,
				name: `批量${i}`,
				segments: [{ seqL1: "技术", seqL2: "深海潜航", months: 24 }],
			})),
		);
	});

	test("报的是截断之前的人数，不是那一页有多长", async () => {
		const { results, total } = await run("深海潜航");
		assert.equal(results.length, RESULT_PAGE, "结果本身仍然截断");
		assert.equal(total, 55, "总数必须说真话");
	});

	test("分面和总数是同一个口径，不会一个 55 一个 50", async () => {
		const { total, facets } = await run("深海潜航");
		const seq = facets.seq.find((s) => s.value.l2 === "深海潜航");
		assert.equal(seq?.n, total);
	});

	/**
	 * 翻页。
	 *
	 * 这里要测的不是「第二页能不能拉到」，而是**第二页是第一页的延长，不是
	 * 另一次排序**：分页靠把 limit 调大重查，所以前 50 名必须逐位不变。
	 * 一旦哪天改成 offset 续拉，这条会红——那正是它存在的理由。
	 */
	test("翻页只是把同一次排序拉得更长，不是重排", async () => {
		const first = await run("深海潜航", {}, RESULT_PAGE);
		const more = await run("深海潜航", {}, RESULT_PAGE * 2);
		assert.equal(more.results.length, 55, "第二页要把剩下的都带回来");
		assert.equal(more.total, first.total, "总数不因翻页而变");
		assert.deepEqual(
			more.results.slice(0, RESULT_PAGE).map((r) => r.employee.empId),
			first.results.map((r) => r.employee.empId),
			"前一页的人必须逐位不变，否则翻页会漏人或重复",
		);
	});

	test("要多少给多少，但不会超过命中的人数", async () => {
		const { results } = await run("深海潜航", {}, 10);
		assert.equal(results.length, 10);
		assert.equal((await run("深海潜航", {}, 999)).results.length, 55);
	});

	test("太宽的词按人数占比量出来", async () => {
		// 55 个「深海潜航」远超库里两成的人；「考古」只有三个
		const wide = await probeWide(["深海潜航", "考古"]);
		assert.deepEqual([...wide], ["深海潜航"]);
	});
});

describe("证据要求", () => {
	test("打开之后只剩每个词都有受控命中的人", async () => {
		const loose = await run("算法,运营");
		const strict = await run("算法,运营", { strong: true });
		const ids = strict.results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "序列 + 岗位命中，应当留下");
		assert.ok(!ids.includes("T003"), "两个词都只在简历原文里，应当被排除");
		assert.ok(strict.total < loose.total, "收窄之后总数必须变小");
	});

	test("那一项的两头：打开还剩几个、关掉能看到几个", async () => {
		const { facets, total } = await run("算法,运营");
		assert.equal(facets.strong.off, total, "关掉就是当前全部");
		assert.equal(
			facets.strong.on,
			(await run("算法,运营", { strong: true })).total,
			"打开的预告数必须等于真打开之后的结果",
		);
	});

	test("它自己开着的时候，那一项的预告数不受自己影响", async () => {
		const on = await run("算法,运营", { strong: true });
		const off = await run("算法,运营");
		assert.equal(on.facets.strong.off, off.total);
		assert.equal(on.facets.strong.on, off.facets.strong.on);
	});
});

/**
 * 空名单的成因由检索层给出，不由界面反推（论证在 `search/empty.ts`）。
 * 这里测的是「它真的接上了这次检索的事实」——判定本身的分支在
 * `tests/empty.test.ts`，那一层不连库。
 */
describe("为什么没有人", () => {
	test("有人时不给成因", async () => {
		const { empty } = await run("算法");
		assert.equal(empty, null);
	});

	test("AND 没满足和「筛没了」是两种成因，出路正好不同", async () => {
		assert.deepEqual((await run("量子炼金")).empty, { kind: "unmet" });
		assert.deepEqual((await run("算法", { level: ["P0"] })).empty, {
			kind: "filtered",
		});
	});

	test("证据要求滤空时，带上关掉之后能看到几个", async () => {
		// W001 的唯一证据在简历原文里，打开证据要求就一个人不剩——而「关掉能
		// 看到 1 个」正是这条成因要带出去的数。
		await seed([
			{
				empId: "W001",
				name: "只在简历里提过",
				segments: [
					{
						kind: "external",
						org: "某厂",
						description: "幽蓝抄写",
						months: 24,
					},
				],
			},
		]);
		const loose = await run("幽蓝抄写");
		assert.equal(loose.total, 1);
		const strict = await run("幽蓝抄写", { strong: true });
		assert.equal(strict.total, 0);
		assert.deepEqual(strict.empty, { kind: "strongEmpty", without: 1 });
		assert.equal(
			strict.facets.strong.off,
			1,
			"报的就是关掉之后真能看到的那个数",
		);
	});
});

describe("加分词", () => {
	test("不命中也留在结果里——这正是它和必须词的区别", async () => {
		// 「算法」必须，「运营」加分：T002 只有算法，必须留下
		const { results } = await run("算法,+运营");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只命中必须词的人不该被加分词淘汰");
		assert.ok(ids.includes("T001"), "两个都命中的人当然也在");
	});

	test("命中了就往上抬，抬到只命中必须词的人前面", async () => {
		const { results } = await run("算法,+运营");
		const rank = results.map((r) => r.employee.empId);
		// T001 的「算法」是相似 1.0 的序列命中，T002 是相似 0.63 的岗位命中，
		// T001 本就靠前；这里要测的是命中加分词的人不会掉到后面
		assert.ok(rank.indexOf("T001") < rank.indexOf("T002"));
	});

	test("加分只抬不压：命中的词越少，分不会反而越高", async () => {
		const { results } = await run("算法,+运营");
		const t001 = results.find((r) => r.employee.empId === "T001");
		const t005 = results.find((r) => r.employee.empId === "T005");
		assert.ok(t001 && t005);
		const only = await run("算法");
		const t001Only = only.results.find((r) => r.employee.empId === "T001");
		assert.ok(
			t001Only && t001.score > t001Only.score,
			"命中加分词分数必须上升",
		);
	});

	test("整句都是加分词时退化成 OR：命中任意一个就算数", async () => {
		const { results } = await run("+算法,+运营");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只有算法");
		// 「渠道运营」对「运营」是 0.71，过线；对「算法」是 0——只命中第二个加分词
		assert.ok(ids.includes("T006"), "只有运营");
	});

	test("分面口径跟着走：加分词不参与「还剩几人」的计算", async () => {
		const { facets, total } = await run("算法,+运营");
		assert.equal(facets.strong.off, total, "关掉证据要求就是当前全部");
	});
});

describe("排除词：否决证据段，不否决人", () => {
	before(async () => {
		await seed([
			{
				empId: "X001",
				name: "唯一证据被否决",
				// 「算法」只在简历描述里；这一段的岗位正是「运营」
				segments: [
					{
						kind: "external",
						org: "某厂",
						title: "运营",
						description: "算法",
						months: 36,
					},
				],
			},
			{
				empId: "X002",
				name: "入职前只实习过",
				segments: [
					{ kind: "external", org: "某厂", title: "机甲实习", months: 6 },
				],
			},
			{
				empId: "X003",
				name: "实习起步，后来真干过",
				segments: [
					{ kind: "external", org: "某厂", title: "机甲实习", months: 6 },
					{ kind: "external", org: "另一厂", title: "深海造船", months: 24 },
				],
			},
		]);
	});

	test("否决的阈值比正向要求高", () => {
		assert.ok(RELEVANCE_MIN_EXCLUDE > RELEVANCE_MIN);
	});

	test("命中排除词的段丧失作证资格；只有这类证据的人自然出局", async () => {
		const loose = await run("算法");
		const tight = await run("算法,-运营");
		assert.ok(loose.results.some((r) => r.employee.empId === "X001"));
		assert.ok(!tight.results.some((r) => r.employee.empId === "X001"));
	});

	test("别的段还有证据的人留下——排除砍的是证据，不是人", async () => {
		// T001 的「算法」证据在序列段上，被否决的是他那段「运营」经历。
		// 人级排除会把这种人整个剔掉，违背「排除只否决证据段」的语义。
		const { results } = await run("算法,-运营");
		const t001 = results.find((r) => r.employee.empId === "T001");
		assert.ok(t001, "有独立算法证据的人不因一段运营经历被整个排掉");
		assert.ok(
			t001.hits.every((h) => h.title !== "运营"),
			"被否决的段也不能再出现在证据行里",
		);
	});

	test("相似但没到否决阈值的段不被否决", async () => {
		// T003 的描述「算法运营」对「运营」是 0.71，过判定线、不过否决线
		assert.ok(fakeSimilarity("运营", "算法运营") < RELEVANCE_MIN_EXCLUDE);
		const { results } = await run("算法,-运营");
		assert.ok(results.some((r) => r.employee.empId === "T003"));
	});

	test("总数与分面跟着一起减", async () => {
		const tight = await run("算法,-运营");
		assert.equal(tight.facets.strong.off, tight.total);
		assert.equal(tight.total, tight.results.length);
	});

	test("排除词不占列：它不产出证据，表格里没有它的位置", async () => {
		const { terms } = await run("算法,-运营");
		assert.deepEqual(
			terms.map((t) => t.term),
			["算法"],
		);
	});

	/**
	 * 结构化范围也是一份候选定义，排除词在它上面同样只否决**段**。
	 *
	 * 两条路径共用一套否决（`search.ts` 的 keepUnvetoed）：各写一份的话，
	 * 「只看入职前经历，不要实习」会安静地当那个排除词不存在——屏幕上那枚
	 * chip 好端端画着，名单里却全是实习生。
	 */
	test("只有范围加一个排除词时，被否决的段照样不算数", async () => {
		const scoped = await search({
			requirements: parseQuery("-机甲实习"),
			scope: { kind: "external" },
			notices: [],
		});
		const ids = scoped.results.map((r) => r.employee.empId);
		assert.ok(!ids.includes("X002"), "只有这一段的人失去全部凭据，出局");
		assert.ok(ids.includes("X003"), "还有别的段的人留下——砍的是段不是人");
		const loose = await search({
			requirements: parseQuery(""),
			scope: { kind: "external" },
			notices: [],
		});
		assert.ok(
			loose.results.map((r) => r.employee.empId).includes("X002"),
			"不写排除词时他本来在名单上",
		);
	});

	test("范围跑过了就报范围的结果，不报「你只写了排除词」", async () => {
		const outcome = await search({
			requirements: parseQuery("-机甲实习"),
			scope: { kind: "external", minMonths: 999 },
			notices: [],
		});
		assert.equal(outcome.total, 0);
		assert.deepEqual(outcome.empty, { kind: "scopeEmpty" });
	});

	test("整句只有排除词时不返回任何人——它只会剔人，不会加人", async () => {
		const { terms, results } = await run("-算法");
		assert.equal(terms.length, 0);
		assert.equal(results.length, 0);
	});

	test("语料里没有的排除词谁都排不掉", async () => {
		const plain = await run("算法");
		const withExclude = await run("算法,-量子炼金");
		assert.equal(withExclude.total, plain.total);
	});
});

/**
 * 停用的词。
 *
 * 语义上它必须**彻底不存在**：不收窄、不排人、不占列、不进分面。任何一处
 * 漏掉都不会报错，只会让「我把这个条件关掉了」和实际结果对不上——而这正是
 * 停用这个功能存在的意义（关掉它看看还剩谁），对不上就等于没有这个功能。
 */
describe("停用的词", () => {
	test("停用一个必须词，结果和根本没写它一样", async () => {
		const only = await run("算法");
		const withOff = await run("算法,~运营");
		assert.equal(withOff.total, only.total);
		assert.deepEqual(
			withOff.results.map((r) => r.employee.empId),
			only.results.map((r) => r.employee.empId),
		);
	});

	test("停用的词不占列：表格里没有它的位置", async () => {
		const { terms } = await run("算法,~运营");
		assert.deepEqual(
			terms.map((t) => t.term),
			["算法"],
		);
	});

	test("停用一个排除词，被它排掉的人回来了", async () => {
		const excluded = await run("算法,-运营");
		const off = await run("算法,~-运营");
		assert.ok(off.total > excluded.total, "停用排除词必须放人回来");
		assert.equal(off.total, (await run("算法")).total);
	});

	test("分面跟着走：停用的词不参与「还剩几人」", async () => {
		const off = await run("算法,~运营");
		const only = await run("算法");
		assert.deepEqual(off.facets.seq, only.facets.seq);
		assert.equal(off.facets.strong.off, only.facets.strong.off);
	});

	test("全停用了就没有可排的人——和空查询同一个结果", async () => {
		const { terms, results, total } = await run("~算法,~运营");
		assert.deepEqual(terms, []);
		assert.deepEqual(results, []);
		assert.equal(total, 0);
	});
});

/**
 * 一条要求的多个说法：说法之间是 OR、要求之间仍是 AND。每个说法各自嵌、
 * 各自比，「命中的是哪个说法」原样到达证据行。
 */
describe("一条要求的多个说法", () => {
	before(async () => {
		await seed([
			{
				empId: "M001",
				name: "第二个说法命中",
				segments: [{ seqL2: "深度学习", months: 36 }],
			},
			{
				empId: "M002",
				name: "主词命中",
				segments: [{ seqL2: "机甲算法", months: 36 }],
			},
			{
				empId: "M003",
				name: "另一段命中排除的第二个说法",
				segments: [
					{ seqL2: "机甲算法", months: 36 },
					{ seqL2: "下棋", months: 12 },
				],
			},
			{
				empId: "M004",
				name: "同一段命中两个说法",
				segments: [{ seqL2: "机甲算法与深度学习", months: 12 }],
			},
		]);
	});

	test("并列说法满足其一即满足要求，不会拆成两条都要", async () => {
		const { terms, results } = await run("机甲算法/深度学习");
		assert.equal(terms.length, 1, "一条要求，不是两条");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("M001") && ids.includes("M002"));
	});

	test("证据行归的是这条要求，哪个说法命中的不占一行标签", async () => {
		const { results } = await run("机甲算法/深度学习");
		const m1 = results.find((r) => r.employee.empId === "M001");
		// 命中的是第二个说法「深度学习」，但一行证据答的是「这条要求怎么满足的」，
		// 而这条要求的名字是它的主词——说法只是它的几种写法之一。
		assert.equal(m1?.hits[0]?.term, "机甲算法");
		assert.equal(m1?.hits[0]?.route, "seq");
	});

	test("同一段命中同一要求的两个说法，只贡献一次", async () => {
		// 说法之间是 OR，不是两条证据：不去重的话 termValue 会把这 12 个月
		// 累加成 24，分数、展示的累计月数、证据行全跟着说谎。
		const { results } = await run("机甲算法/深度学习");
		const m4 = results.find((r) => r.employee.empId === "M004");
		assert.equal(m4?.basis[0]?.months, 12, "月份只能计一次");
		assert.equal(m4?.hits.length, 1, "证据行只列这一段一次");
	});

	test("排除组的说法取并集，但仍然只否决段", async () => {
		const { results } = await run("机甲算法,-机甲拳击/下棋");
		const ids = results.map((r) => r.employee.empId);
		// M003 的「下棋」段被第二个说法否决，但他的「机甲算法」证据无恙
		assert.ok(ids.includes("M003"), "无关段被否决不影响这个人");
		const m3 = results.find((r) => r.employee.empId === "M003");
		assert.ok(m3?.hits.every((h) => h.seq !== "下棋"));
	});
});

/**
 * 模型补的变体。用户用词不一定准，只按原话找会漏人；但补来的词分数低于原话，
 * 证据行要说出「拿去比的是哪个词」。分数怎么折在 rank.test.ts 用纯事实测，
 * 这里测它们真的走到了取数、命中标记和名次上。
 */
describe("变体", () => {
	before(async () => {
		await seed([
			{
				empId: "V001",
				name: "原话命中",
				segments: [{ seqL2: "星舰算法", months: 36 }],
			},
			{
				empId: "V004",
				name: "原话命中但又短又旧",
				segments: [{ seqL2: "星舰算法", months: 3, endDate: "2015-01-01" }],
			},
			{
				empId: "V002",
				name: "只有变体命中",
				segments: [{ seqL2: "星舰推演", months: 36 }],
			},
			{
				empId: "V003",
				name: "变体上干了很久",
				segments: [{ seqL2: "星舰推演", months: 120 }],
			},
		]);
	});

	test("只靠变体找到的人也在名单上，排在同等条件下靠原话找到的人后面", async () => {
		const { results } = await run("星舰算法/~星舰推演");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("V002"), "变体把用户没说准的人找了回来");
		assert.ok(
			ids.indexOf("V001") < ids.indexOf("V002"),
			"同样 36 个月，原话命中的在前",
		);
	});

	test("证据行说出命中的是哪个说法，相关度仍是那段原文对那个说法的数", async () => {
		const { results } = await run("星舰算法/~星舰推演");
		const v2 = results.find((r) => r.employee.empId === "V002");
		assert.deepEqual(v2?.hits[0]?.member, { text: "星舰推演", tier: "near" });
		assert.equal(v2?.basis[0]?.member.tier, "near");
		// 折扣进的是分数，不是相关度：屏幕上那个百分比对着的是「这段原文像不像
		// 那个说法」，折一遍之后它就不再是任何一个能核对的数了。
		assert.equal(v2?.hits[0]?.relevance, 1);
		const v1 = results.find((r) => r.employee.empId === "V001");
		assert.deepEqual(v1?.hits[0]?.member, { text: "星舰算法", tier: "said" });
	});

	test("变体的折扣是翻译损耗，不是证据档位：又久又新的变体命中能反超又短又旧的原话命中", async () => {
		const { results } = await run("星舰算法/~星舰推演");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(
			ids.indexOf("V003") < ids.indexOf("V004"),
			"十年且仍在做的「星舰推演」压过十年前做了三个月的「星舰算法」",
		);
		assert.ok(
			ids.indexOf("V001") < ids.indexOf("V003"),
			"但压不过同样仍在做、三年的「星舰算法」：时长与近因各自的下限让折扣只在这个范围里翻盘",
		);
	});

	test("排除词按说法取并集，变体一样否决段", async () => {
		const { results } = await run("星舰算法/~星舰推演,-星舰推演");
		// 排除组自己带的说法和正向要求里的变体撞了词：跨要求去重，先出现的赢，
		// 排除组因此是空的——名单和不写排除时一样。
		assert.ok(results.some((r) => r.employee.empId === "V002"));
	});
});
