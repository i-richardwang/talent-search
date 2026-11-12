/**
 * 检索语义的集成测试：真实 SQL，合成端点和经历。条件用关键词链的写法，经历词按字面包含匹配。
 * 验证捞说法、事实、约束、排除与排序输入的传递；纯打分规则由 rank.test.ts 验证，
 * 写了判据的条件怎样听确认过的结论在 execute.test.ts。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { claimLines } from "#/routes/s/$turnId/-lib/claim-lines";
import { evidenceText } from "#/routes/s/$turnId/-lib/evidence";
import { compileConditions } from "#/search/compile";
import { NOT_A_VALUE, VOCAB_KEYS } from "#/search/dimensions";
import type { SearchFilters } from "#/search/params";
import { parseQuery } from "#/search/query-syntax";
import type { SearchSpec } from "#/search/spec";
import { conclude, judged, openSearch, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 在模块求值时就绑死了环境变量
const { search: find, vocabulary } = await import("#/search/search");
/** 本文件的查询都在同一次找人任务里：结论记在它名下，也只认它名下的。 */
const SEARCH = await openSearch();
const search = (spec: SearchSpec, filters?: SearchFilters, limit?: number) =>
	find(spec, SEARCH, filters, limit);
const { overflowContributors } = await import("#/search/execute");
const run = async (query: string, filters = {}, limit?: number) => {
	const outcome = await search(
		{ conditions: parseQuery(query) },
		filters,
		limit,
	);
	if (outcome.order === "employee")
		throw new Error("要求查询得有经历主张，只有人的条件排不出名次");
	return outcome;
};
const { RESULT_PAGE } = await import("#/search/weights");

before(async () => {
	await seed([
		{
			empId: "T001",
			name: "两条主张都在任职记录或岗位上",
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
			name: "两条主张都只是简历里提过",
			segments: [
				{
					kind: "external",
					months: 36,
					company: "某公司",
					description: "算法运营",
				},
			],
		},
		{
			empId: "T004",
			name: "同段既在岗位名又在简历里",
			segments: [{ title: "安全员", description: "安全巡检", months: 36 }],
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
			name: "入职前岗位写着渠道运营",
			segments: [{ kind: "external", title: "渠道运营", months: 36 }],
		},
		{
			empId: "T007",
			name: "岗位名里含着算法",
			segments: [{ title: "算法平台运维工程师", months: 36 }],
		},
		{
			empId: "T008",
			name: "序列和岗位都写着算法",
			segments: [{ seqL2: "算法", title: "算法", months: 36 }],
		},
		{
			empId: "T009",
			name: "能力词和投入档是从简历里抽出来的",
			segments: [
				{
					kind: "external",
					months: 36,
					company: "某公司",
					description: "负责服务端",
					extracted: {
						skills: [
							{ text: "Python", engagement: "做过" },
							"Spark",
							{ text: "推荐系统", engagement: "主导" },
						],
					},
				},
			],
		},
		{
			empId: "T010",
			name: "岗位名恰好和别人的能力词是同一串字",
			segments: [{ kind: "external", title: "Python", months: 36 }],
		},
	]);
});

describe("抽取的能力", () => {
	test("能力词命中时证据行带上命中的那条说法", async () => {
		const { results } = await run("Python");
		const evidence = results
			.find((r) => r.employee.empId === "T009")
			?.evidence.find((e) => e.claim === 0);
		assert.equal(evidence?.route, "skill");
		assert.equal(evidence?.phrase, "Python");
	});

	test("同一段可以有多条能力词，各自独立算作证据", async () => {
		// 主键是（段、路、说法）三列：两条能力词在同一段上，AND 要两个都命中
		const { results } = await run("Python,Spark");
		assert.ok(results.some((r) => r.employee.empId === "T009"));
	});

	test("投入档随命中一起返回", async () => {
		const { results } = await run("推荐系统");
		const evidence = results
			.find((r) => r.employee.empId === "T009")
			?.evidence.find((e) => e.claim === 0);
		assert.equal(evidence?.route, "skill");
		assert.equal(evidence?.phrase, "推荐系统");
		assert.equal(evidence?.engagement, "主导");
	});

	test("投入档不进说法的文字：查它捞不到能力", async () => {
		const { results } = await run("主导");
		const evidence = results
			.find((r) => r.employee.empId === "T009")
			?.evidence.find((e) => e.route === "skill");
		assert.equal(evidence, undefined);
	});

	test("同一串字既是岗位名又是能力词时各归各的路，原文路不带说法文本", async () => {
		const { results } = await run("Python");
		const evidence = results
			.find((r) => r.employee.empId === "T010")
			?.evidence.find((e) => e.claim === 0);
		assert.equal(evidence?.route, "title");
		assert.equal(evidence?.phrase, null);
		assert.equal(evidence?.engagement, null);
	});
});

describe("事实行数量上限", () => {
	test("按事实贡献选择最少数量的主要条件，不借用人数覆盖率", () => {
		assert.deepEqual(
			overflowContributors(
				[
					{ claim: 0, facts: 40 },
					{ claim: 1, facts: 120 },
					{ claim: 2, facts: 90 },
				],
				100,
			),
			[1, 2],
		);
	});

	test("没有超过上限时不返回贡献者", () => {
		assert.deepEqual(
			overflowContributors(
				[
					{ claim: 0, facts: 40 },
					{ claim: 1, facts: 60 },
				],
				100,
			),
			[],
		);
	});
});

describe("按字面捞", () => {
	before(async () => {
		const skilled = (empId: string, skill: string) => ({
			empId,
			name: `合成${empId}`,
			segments: [{ months: 12, extracted: { skills: [skill] } }],
		});
		await seed([skilled("J001", "Java"), skilled("J002", "JavaScript")]);
	});
	const found = async (query: string) =>
		(await run(query)).results.map((r) => r.employee.empId).sort();

	test("说法里含这个词才算，不分大小写；意思相近、字面不含的不算", async () => {
		assert.deepEqual(await found("渠道运营"), ["T006"]);
		assert.deepEqual(await found("线下渠道运营"), []);
		assert.deepEqual(await found("python"), ["T009", "T010"]);
		assert.ok((await found("算法")).includes("T007"), "长岗位名里含着也算");
	});

	test("词的两头是英文或数字时不接别的英文数字：搜 Java 不带出 JavaScript", async () => {
		assert.deepEqual(await found("Java"), ["J001"]);
		assert.deepEqual(await found("JavaScript"), ["J002"]);
	});

	test("人才库里没人写过的词一个人都找不到", async () => {
		const { results } = await run("量子炼金");
		assert.equal(results.length, 0);
	});

	test("关键词捞到的都算数：不用谁确认，名单是完整的", async () => {
		const outcome = await run("算法");
		assert.ok(outcome.results.some((r) => r.employee.empId === "T002"));
		assert.equal(outcome.incomplete, undefined);
	});
});

describe("AND 语义", () => {
	test("每条条件都要命中，缺一个就被淘汰", async () => {
		const { results } = await run("算法,运营");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "两条主张都命中的人应当在结果里");
		assert.ok(!ids.includes("T002"), "只命中「算法」的人必须被淘汰");
	});

	test("两个词可以命中不同的经历段", async () => {
		const { results } = await run("算法,运营");
		const t001 = results.find((r) => r.employee.empId === "T001");
		const segs = new Set(t001?.evidence.map((e) => e.experienceId));
		assert.equal(segs.size, 2, "两个词应当来自两段不同的经历");
	});
});

/**
 * 背景（「只看入职前的经历」「待过字节」）：没说做过什么，只定去留。它和人的
 * 条件一样按人过滤——不产出事实、不进名次、不上证据行。
 */
describe("背景只定去留", () => {
	const ids = (outcome: { results: { employee: { empId: string } }[] }) =>
		outcome.results.map((r) => r.employee.empId).sort();

	test("只有背景：过了门槛的人按人排，没有分数也没有证据", async () => {
		const outcome = await search({ conditions: parseQuery("kind:external") });
		assert.equal(outcome.order, "employee");
		assert.deepEqual(ids(outcome), ["T001", "T003", "T006", "T009", "T010"]);
	});

	test("视图筛选改的是看哪些经历，不改谁过了门槛", async () => {
		// 五人都有入职前经历；只看公司内的经历时，留下有公司内经历的那个
		const outcome = await search(
			{ conditions: parseQuery("kind:external") },
			{ kind: "internal" },
		);
		assert.deepEqual(ids(outcome), ["T001"]);
	});

	test("背景加排除：在排除的那家公司待过的人不在名单上", async () => {
		// T003、T009 的入职前经历都在某公司
		const outcome = await search({
			conditions: parseQuery("kind:external,-company:某公司"),
		});
		assert.deepEqual(ids(outcome), ["T001", "T006", "T010"]);
	});

	test("主张里的各项说的是同一段：经历词和来源写在一条上，约束的是作为证据的那段", async () => {
		const outcome = await run("算法 kind:external");
		assert.deepEqual(
			outcome.results.map((result) => result.employee.empId),
			["T003"],
		);
	});

	test("分开写成两条：做过算法、另外有过入职前经历的人，名次只由算法定", async () => {
		const gated = await run("算法,kind:external");
		assert.deepEqual(ids(gated), ["T001", "T003"]);
		assert.deepEqual(
			gated.claims.map((c) => c.label),
			["算法"],
			"背景不是一条主张，证据行上没有它",
		);
		const plain = await run("算法");
		const depth = new Map(
			plain.results.map((r) => [r.employee.empId, r.depth]),
		);
		for (const r of gated.results) {
			assert.equal(r.depth, depth.get(r.employee.empId), "背景不改深度");
			assert.ok(r.evidence.every((e) => e.claim === 0));
		}
	});
});

/**
 * 只有门槛（人的条件、背景）的查询与带经历主张的查询的分面是**同一份实现**：值域只随
 * 查询变，计数随筛选变。两条路各写一份求值器的话，同一栏筛选在只有门槛的查询下
 * 会变成「点一项，别的维度里凑不出人的行当场消失」——而那正是筛选栏不能被信任的样子。
 */
describe("只有门槛时的分面计数", () => {
	before(async () => {
		await seed([
			{
				empId: "S001",
				name: "范围甲",
				curLevel: "P4",
				recruitment: "校招",
				schoolTier: "985",
				overseasEducated: true,
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
				schoolTier: "普通高校",
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
		const scope = { conditions: parseQuery("companyTag:星域联盟") };
		const base = await search(scope);
		assert.equal(base.total, 2);
		assert.deepEqual(base.facets.recruitment, [
			{ value: "社招", n: 1 },
			{ value: "校招", n: 1 },
		]);

		const picked = await search(scope, { level: ["P4"] });
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

	test("学校档和海外学历按人筛，没有记录的人不算「否」", async () => {
		const scope = { conditions: parseQuery("companyTag:星域联盟") };
		const base = await search(scope);
		assert.deepEqual(base.facets.schoolTier, [
			{ value: "985", n: 1 },
			{ value: "普通高校", n: 1 },
		]);
		assert.deepEqual(base.facets.overseas, [{ value: "是", n: 1 }]);

		const abroad = await search({
			conditions: parseQuery("companyTag:星域联盟,overseas:是"),
		});
		assert.deepEqual(
			abroad.results.map((r) => r.employee.empId),
			["S001"],
		);
		const tier = await search({
			conditions: parseQuery("companyTag:星域联盟,schoolTier:普通高校/211"),
		});
		assert.deepEqual(
			tier.results.map((r) => r.employee.empId),
			["S002"],
		);
	});
});

describe("命中路径判定", () => {
	const routes = (outcome: Awaited<ReturnType<typeof search>>) => {
		if (outcome.order !== "evidence") throw new Error("该是按证据排的名单");
		return outcome.results
			.find((r) => r.employee.empId === "T004")
			?.evidence.map((e) => e.route);
	};

	test("一段同时有几类命中时只留一行：短说法在没读过的原文前面", async () => {
		// 任职记录「安全员」和没读过的原文「安全巡检」字面都对得上；没写判据，都算数
		assert.deepEqual(routes(await search({ conditions: parseQuery("安全") })), [
			"role",
		]);
	});

	test("写了判据时结论是整段的：几类命中一起算数，仍只留一行", async () => {
		const criterion = "本人做安全管理";
		const safety = {
			query: { conditions: [judged("安全", ["安全"], criterion)] },
		};
		assert.equal(routes(await search(safety)), undefined, "还没确认，不上名单");
		await conclude(SEARCH, criterion, true, ["T004"]);
		assert.deepEqual(routes(await search(safety)), ["role"]);
	});
});

/**
 * 打分公式在 rank.test.ts 里测，这里只验一件事：**月数和结束日期确实
 * 原样穿过了 SQL 到达打分层**。这两个字段任何一个在取数那一层丢掉或者写错列名，
 * 纯函数测试都照样全绿，而界面上的表现是「排序看起来有点怪」——不会有任何断言失败。
 */
describe("月数与结束日期能传到打分层", () => {
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
		const depths = new Set(results.map((r) => r.depth));
		assert.equal(depths.size, 3, "三个人三个深度，排序才有分辨率");
	});
});

describe("筛选条件", () => {
	test("只看入职前经历会排除仅有在职命中的人", async () => {
		const { results } = await run("算法", { kind: "external" });
		assert.ok(!results.some((r) => r.employee.empId === "T001"));
	});

	test("主张上的时长判的是累计：两段加起来够就算", async () => {
		// T005 算法 3 + 36 个月，T001 只有 36 个月
		const ids = (await run("算法 minMonths:38")).results.map(
			(r) => r.employee.empId,
		);
		assert.ok(ids.includes("T005"));
		assert.ok(!ids.includes("T001"));
		const basis = (await run("算法 minMonths:38")).results.find(
			(r) => r.employee.empId === "T005",
		)?.basis[0];
		assert.equal(basis?.months, 39, "证据行上写的就是判过的那个数");
	});

	test("视图上的最短时长滤的是单段", async () => {
		const { results } = await run("算法", { minMonths: 30 });
		assert.ok(results.some((r) => r.employee.empId === "T005"));
		const basis = results.find((r) => r.employee.empId === "T005")?.basis[0];
		assert.equal(basis?.months, 36);
	});

	test("多加筛选只会让人变少，不会变多", async () => {
		const plain = await run("算法");
		const narrowed = await run("算法", { kind: "external" });
		assert.ok(narrowed.total < plain.total, "这个筛选真的筛掉了人");
	});
});

/**
 * 跟人走的筛选：职级、招聘渠道、学历是分面，公司名、学校名是按名字包含的文本条件。
 * 后两者是专有名词，不进说法。
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
					{
						kind: "external",
						company: "字节跳动",
						title: "产品经理",
						months: 24,
					},
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

	test("三个分面数的都是人，职级和学历按档从低到高排", async () => {
		const { facets, total } = await run("潜水");
		assert.equal(total, 3);
		assert.deepEqual(facets.level, [
			{ value: "P6", n: 1, rank: 6 },
			{ value: "P7", n: 2, rank: 7 },
		]);
		assert.deepEqual(facets.recruitment, [
			{ value: "校招", n: 2 },
			{ value: "社招", n: 1 },
		]);
		assert.deepEqual(facets.education, [
			{ value: "本科", n: 1, rank: 3 },
			{ value: "硕士", n: 2, rank: 4 },
		]);
	});

	test("「某档及以上」比的是档高，不是列举的档名", async () => {
		const ids = async (query: string) =>
			(await run(query)).results.map((r) => r.employee.empId).sort();
		assert.deepEqual(await ids("潜水,level:>=P7"), ["P002", "P003"]);
		assert.deepEqual(await ids("潜水,education:>=本科"), [
			"P001",
			"P002",
			"P003",
		]);
		assert.deepEqual(await ids("潜水,education:>=硕士"), ["P001", "P003"]);
		// 加分的「及以上」不过滤人，满足的排前面
		const boosted = await run("潜水,+education:>=硕士");
		assert.equal(boosted.total, 3);
		assert.equal(boosted.results[2]?.employee.empId, "P002");
	});

	test("档高查档位表，和教给 AI 的写法是同一句：人才库里没人在的档也比得出", async () => {
		const [condition] = compileConditions(
			parseQuery("education:>=大专"),
		).conditions;
		assert.match(
			condition?.where ?? "",
			/^p\.education_rank >= \(select s\.rank from scale s where s\.stream = 'education' and s\.value = :\w+\)$/,
		);
		const ids = async (query: string) =>
			(await run(query)).results.map((r) => r.employee.empId).sort();
		assert.deepEqual(await ids("潜水,education:>=大专"), [
			"P001",
			"P002",
			"P003",
		]);
	});

	test("职级筛选缩小人群，且这一维自己的候选不受自己影响", async () => {
		const { facets, total } = await run("潜水", {
			level: "P7",
		});
		assert.equal(total, 2);
		assert.equal(facets.level.find((l) => l.value === "P6")?.n, 1);
		// 别的维度按筛过的人群数
		assert.deepEqual(facets.education, [
			{ value: "本科", n: 1, rank: 3 },
			{ value: "硕士", n: 1, rank: 4 },
		]);
	});

	test("公司名是按人过滤的文本条件，分面随之只数剩下的人", async () => {
		const { results, facets } = await run("潜水", { company: ["字节"] });
		assert.deepEqual(
			results.map((r) => r.employee.empId),
			["P002"],
		);
		assert.deepEqual(facets.level, [{ value: "P7", n: 1, rank: 7 }]);
	});

	test("偏好的公司名不过滤人，只把满足的人排到前面", async () => {
		const preferred = await search({
			conditions: parseQuery("潜水,+company:字节"),
		});
		const plain = await search({ conditions: parseQuery("潜水") });
		assert.equal(preferred.total, 3);
		assert.equal(preferred.results[0]?.employee.empId, "P002");
		assert.equal(preferred.order, "evidence");
		assert.equal(plain.order, "evidence");
		// 只有满足偏好的那个人的深度变了，其余原样
		const by = (o: typeof plain) =>
			new Map(o.results.map((r) => [r.employee.empId, r.depth]));
		const a = by(preferred);
		const b = by(plain);
		assert.ok((a.get("P002") ?? 0) > (b.get("P002") ?? 0));
		assert.equal(a.get("P001"), b.get("P001"));
		assert.equal(a.get("P003"), b.get("P003"));
	});

	test("只有人的偏好的查询是「所有人，满足的在前」", async () => {
		const outcome = await search({ conditions: parseQuery("+level:P7") });
		assert.equal(outcome.order, "employee");
		// 没有主张就是全库的人，不止这一组的三个
		assert.ok(outcome.total > 3);
		assert.equal(outcome.results[0]?.employee.empId, "P002");
	});

	test("只有人的必须条件：过了条件的人按工号，没有分数可排", async () => {
		const outcome = await search({ conditions: parseQuery("level:P7") });
		assert.equal(outcome.order, "employee");
		assert.deepEqual(
			outcome.results.map((r) => r.employee.empId),
			["P002", "P003"],
		);
	});

	test("人的偏好每条独立：满足两条的排在只满足一条的前面", async () => {
		const outcome = await run("潜水,+education:硕士,+recruitment:校招");
		// P001 硕士且校招，P003 硕士且校招，P002 都不是
		const ids = outcome.results.map((r) => r.employee.empId);
		assert.equal(ids[2], "P002");
		const depth = (id: string) =>
			outcome.results.find((r) => r.employee.empId === id)?.depth ?? 0;
		const one = await run("潜水,+education:硕士");
		const oneDepth = (id: string) =>
			one.results.find((r) => r.employee.empId === id)?.depth ?? 0;
		assert.ok(depth("P001") > oneDepth("P001"), "多满足一条就多一份分");
		assert.equal(depth("P002"), oneDepth("P002"), "一条都不满足的分不变");
	});

	test("「在字节做过潜水」和「做过潜水，也待过字节」是两份查询", async () => {
		// P002 的潜水在公司内，字节那段是产品经理：同一段满足不了
		assert.equal((await run("潜水 company:字节")).total, 0);
		assert.deepEqual(
			(await run("潜水,company:字节")).results.map((r) => r.employee.empId),
			["P002"],
		);
	});

	test("学校名同理", async () => {
		const { results } = await run("潜水", { school: ["明德"] });
		assert.deepEqual(results.map((r) => r.employee.empId).sort(), [
			"P001",
			"P003",
		]);
	});

	test("文本条件里的通配符只能是字面量", async () => {
		// 不转义的话「%%」就让每一行恒真，这个条件等于没筛
		assert.equal((await run("潜水", { company: ["%%"] })).total, 0);
		assert.equal((await run("潜水", { school: ["明_大学"] })).total, 0);
	});

	/**
	 * 词表是模型挑筛选值时唯一能看的东西。逐维手写断言的话，加一维就会有一维
	 * 没人验，而症状是模型对那一维永远挑不出值——不报错，只是少认一维。
	 */
	test("每一维都有词表，取值都是语料里真有的", async () => {
		const v = await vocabulary();
		assert.deepEqual(Object.keys(v).sort(), [...VOCAB_KEYS].sort());
		for (const key of VOCAB_KEYS) {
			const names = v[key].map((x) => x.name);
			assert.ok(names.length > 0, `${key} 一个取值都没数出来`);
			assert.ok(!names.includes(""), `${key} 把空串当成了取值`);
			for (const notValue of NOT_A_VALUE)
				assert.ok(
					!names.includes(notValue),
					`${key} 把「${notValue}」当成了取值`,
				);
			assert.ok(
				v[key].every((x) => x.people > 0),
				`${key} 的取值都至少有一个人`,
			);
		}
		const names = (key: (typeof VOCAB_KEYS)[number]) =>
			v[key].map((x) => x.name);
		assert.ok(names("level").includes("P6") && names("level").includes("P7"));
		assert.ok(
			names("recruitment").includes("校招") &&
				names("recruitment").includes("社招"),
		);
		assert.ok(
			names("education").includes("硕士") &&
				names("education").includes("本科"),
		);
		assert.ok(names("companyTag").includes("星域联盟"));
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
						company: "某公司",
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
						company: "某公司",
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

	test("分面里对齐的序列和登记的序列按同一套规则计数", async () => {
		const { facets } = await run("深海算法工程师");
		const seq = facets.seq.find((s) => s.value.l2 === "深海算法");
		assert.deepEqual(seq, { value: { l1: "技术", l2: "深海算法" }, n: 1 });
	});

	test("对齐的序列不做证据，只有岗位名算命中", async () => {
		const { results } = await run("深海算法");
		const person = results.find((r) => r.employee.empId === "A001");
		assert.ok(person);
		assert.ok(person.evidence.every((e) => e.route === "title"));
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
		assert.equal(results.length, RESULT_PAGE, "结果仍然截断");
		assert.equal(total, 55, "总数必须说真话");
	});

	test("分面和总数是同一个计数方法，不会一个 55 一个 50", async () => {
		const { total, facets } = await run("深海潜航");
		const seq = facets.seq.find((s) => s.value.l2 === "深海潜航");
		assert.equal(seq?.n, total);
	});

	/**
	 * 这里要测的不是「第二页能不能拉到」，而是**第二页是第一页的延长，不是
	 * 另一次排序**：分页靠把 limit 调大重查，所以前 50 名必须逐位不变。
	 * 一旦哪天改成 offset 续拉，这条会失败——那正是它存在的理由。
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
});

describe("证据来源不决定去留", () => {
	test("只在简历里提过的人也在名单里", async () => {
		const ids = (await run("算法,运营")).results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "任职记录 + 岗位命中");
		assert.ok(ids.includes("T003"), "两个词都只在简历原文里，照样算命中");
	});
});

/**
 * 空名单的成因由检索层给出，不由界面反推（论证在 `search/empty.ts`）。
 * 这里测的是「用的正是这次检索的事实」——判定的分支在
 * `tests/empty.test.ts`，那一层不连库。
 */
describe("为什么没有人", () => {
	test("有结果时不给空态成因", async () => {
		const { empty } = await run("算法");
		assert.equal(empty, null);
	});

	test("AND 没满足和「筛没了」是两种成因，下一步正好不同", async () => {
		assert.deepEqual((await run("量子炼金")).empty, { kind: "unmet" });
		assert.deepEqual((await run("算法", { level: ["P0"] })).empty, {
			kind: "filtered",
		});
	});

	test("唯一证据在简历原文里的人照样进名单", async () => {
		await seed([
			{
				empId: "W001",
				name: "只在简历里提过",
				segments: [
					{
						kind: "external",
						company: "某厂",
						description: "幽蓝抄写",
						months: 24,
					},
				],
			},
		]);
		const { total, empty, results } = await run("幽蓝抄写");
		assert.equal(total, 1);
		assert.equal(empty, null);
		assert.equal(results[0]?.evidence[0]?.route, "description");
	});
});

describe("加分的主张", () => {
	test("不命中也留在结果里——这正是它和必须的主张的区别", async () => {
		// 「算法」必须，「运营」加分：T002 只有算法，必须留下
		const { results } = await run("算法,+运营");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只满足必须的主张的人不该被加分的主张淘汰");
		assert.ok(ids.includes("T001"), "两个都命中的人当然也在");
	});

	test("命中了就往上抬，抬到只满足必须的主张的人前面", async () => {
		const { results } = await run("算法,+运营");
		const rank = results.map((r) => r.employee.empId);
		// 两人的「算法」都是 36 个月且仍在做，T001 多满足一条加分
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
			t001Only && t001.depth > t001Only.depth,
			"满足加分的主张深度必须上升",
		);
	});

	test("整句都是加分时，命中任意一条的人获得相应加分", async () => {
		const { results } = await run("+算法,+运营");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只有算法");
		// 「渠道运营」只含「运营」：只命中第二条加分的主张
		assert.ok(ids.includes("T006"), "只有运营");
	});

	test("分面计数跟着变：加分的主张不参与「还剩几人」的计算", async () => {
		const boosted = await run("算法,+运营");
		const plain = await run("算法");
		assert.equal(boosted.total, plain.total);
		assert.deepEqual(boosted.facets.seq, plain.facets.seq);
	});
});

describe("排除：这个人没有任何一段这样的经历", () => {
	before(async () => {
		await seed([
			{
				empId: "X001",
				name: "唯一证据就是被排除的那种",
				// 「算法」只在简历描述里；这一段的岗位正是「运营」
				segments: [
					{
						kind: "external",
						company: "某厂",
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
					{ kind: "external", company: "某厂", title: "机甲实习", months: 6 },
				],
			},
			{
				empId: "X003",
				name: "实习起步，后来真干过",
				segments: [
					{ kind: "external", company: "某厂", title: "机甲实习", months: 6 },
					{
						kind: "external",
						company: "另一厂",
						title: "深海造船",
						months: 24,
					},
				],
			},
		]);
	});

	test("有排除的那种经历的人不在名单上", async () => {
		const loose = await run("算法");
		const tight = await run("算法,-运营");
		assert.ok(loose.results.some((r) => r.employee.empId === "X001"));
		assert.ok(!tight.results.some((r) => r.employee.empId === "X001"));
	});

	test("别的段再合格也一样：排除说的是人，不是那一段", async () => {
		// T001 的「算法」证据在序列段上，他另有一段「运营」经历
		const loose = await run("算法");
		const tight = await run("算法,-运营");
		assert.ok(loose.results.some((r) => r.employee.empId === "T001"));
		assert.ok(!tight.results.some((r) => r.employee.empId === "T001"));
	});

	test("总数与分面跟着一起减", async () => {
		const tight = await run("算法,-运营");
		const loose = await run("算法");
		assert.equal(tight.total, tight.results.length);
		assert.ok(tight.total < loose.total);
	});

	test("排除条件不产出证据列", async () => {
		const { claims } = await run("算法,-运营");
		assert.deepEqual(
			claims.map((c) => c.label),
			["算法"],
		);
	});

	/** 没有经历主张时候选来自人员，排除照样按人生效。 */
	test("只有背景加一条排除时，有那种经历的人同样不在名单上", async () => {
		const scoped = await search({
			conditions: parseQuery("-机甲实习,kind:external"),
		});
		const ids = scoped.results.map((r) => r.employee.empId);
		assert.ok(!ids.includes("X002"));
		assert.ok(!ids.includes("X003"), "后来真干过也一样：他有一段机甲实习");
		assert.ok(ids.includes("T003"), "没实习过的人照常在");
		const loose = await search({ conditions: parseQuery("kind:external") });
		assert.ok(
			loose.results.map((r) => r.employee.empId).includes("X002"),
			"不写排除时他本来在名单上",
		);
	});

	test("排除加一条没人满足的门槛：报门槛没满足", async () => {
		const outcome = await search({
			conditions: parseQuery("-机甲实习,kind:external minMonths:999"),
		});
		assert.equal(outcome.total, 0);
		assert.deepEqual(outcome.empty, { kind: "gatesUnmet" });
	});

	test("排除也是「同一段满足每一项」：只认同时满足的段", async () => {
		// 「不要入职前的机甲实习」：X002 那段是入职前的，他被排除；
		// 写成「不要公司内的机甲实习」就排除不到他
		const external = await search({
			conditions: parseQuery("-机甲实习 kind:external,kind:external"),
		});
		assert.ok(!external.results.map((r) => r.employee.empId).includes("X002"));
		const internal = await search({
			conditions: parseQuery("-机甲实习 kind:internal,kind:external"),
		});
		assert.ok(internal.results.map((r) => r.employee.empId).includes("X002"));
	});

	test("整句只有排除时候选是全体人员：没有那种经历的人都在", async () => {
		const outcome = await search({ conditions: parseQuery("-算法") }, {}, 500);
		assert.equal(outcome.order, "employee");
		const ids = outcome.results.map((r) => r.employee.empId);
		assert.ok(!ids.includes("T001"), "做过算法");
		assert.ok(ids.includes("T006"), "只做过运营");
		assert.equal(outcome.total, ids.length);
	});

	test("语料里没有的排除词谁都排不掉", async () => {
		const plain = await run("算法");
		const withExclude = await run("算法,-量子炼金");
		assert.equal(withExclude.total, plain.total);
	});
});

/**
 * 语义上它必须**彻底不存在**：不缩小人群、不排人、不产出列、不进分面。任何一处
 * 漏掉都不会报错，只会让「我把这个条件关掉了」和实际结果对不上——而这正是
 * 停用这个功能存在的意义（关掉它看看还剩谁），对不上就等于没有这个功能。
 */
describe("停用的词", () => {
	test("停用一条必须的主张，结果和根本没写它一样", async () => {
		const only = await run("算法");
		const withOff = await run("算法,~运营");
		assert.equal(withOff.total, only.total);
		assert.deepEqual(
			withOff.results.map((r) => r.employee.empId),
			only.results.map((r) => r.employee.empId),
		);
	});

	test("停用的词不产出证据列", async () => {
		const { claims } = await run("算法,~运营");
		assert.deepEqual(
			claims.map((c) => c.label),
			["算法"],
		);
	});

	test("停用一条排除的主张，被它排掉的人回来了", async () => {
		const excluded = await run("算法,-运营");
		const off = await run("算法,~-运营");
		assert.ok(off.total > excluded.total, "停用排除的主张必须放人回来");
		assert.equal(off.total, (await run("算法")).total);
	});

	test("分面跟着走：停用的词不参与「还剩几人」", async () => {
		const off = await run("算法,~运营");
		const only = await run("算法");
		assert.deepEqual(off.facets.seq, only.facets.seq);
		assert.equal(off.total, only.total);
	});

	test("全停用了就没有可排的人——和空查询同一个结果", async () => {
		const { claims, results, total } = await run("~算法,~运营");
		assert.deepEqual(claims, []);
		assert.deepEqual(results, []);
		assert.equal(total, 0);
	});
});

/**
 * 一条条件的几个词：任一个捞到即可（OR），条件之间仍是 AND。
 */
describe("一条条件的几个词", () => {
	before(async () => {
		await seed([
			{
				empId: "M001",
				name: "第二个词命中",
				segments: [{ seqL2: "深度学习", months: 36 }],
			},
			{
				empId: "M002",
				name: "第一个词命中",
				segments: [{ seqL2: "机甲算法", months: 36 }],
			},
			{
				empId: "M003",
				name: "另一段命中排除的第二个词",
				segments: [
					{ seqL2: "机甲算法", months: 36 },
					{ seqL2: "下棋", months: 12 },
				],
			},
			{
				empId: "M004",
				name: "同一段命中两个词",
				segments: [{ seqL2: "机甲算法与深度学习", months: 12 }],
			},
		]);
	});

	test("并列的词满足其一即满足条件，不会拆成两条都要", async () => {
		const { claims, results } = await run("机甲算法/深度学习");
		assert.equal(claims.length, 1, "一条条件，不是两条");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("M001") && ids.includes("M002"));
	});

	test("同一段命中同一条件的两个词，只贡献一次", async () => {
		// 词之间是 OR，不是两条证据：不去重的话 claimValue 会把这 12 个月
		// 累加成 24，分数、展示的累计月数、证据行全跟着出错。
		const { results } = await run("机甲算法/深度学习");
		const m4 = results.find((r) => r.employee.empId === "M004");
		assert.equal(m4?.basis[0]?.months, 12, "月份只能计一次");
		assert.equal(m4?.evidence.length, 1, "证据行只列这一段一次");
	});

	test("排除条件的词取并集：有任一个词的经历的人都不在名单上", async () => {
		const loose = await run("机甲算法");
		const { results } = await run("机甲算法,-机甲拳击/下棋");
		const ids = results.map((r) => r.employee.empId);
		// M003 另有一段「下棋」，被第二个词排除
		assert.ok(loose.results.some((r) => r.employee.empId === "M003"));
		assert.ok(!ids.includes("M003"));
		assert.ok(ids.length > 0, "没有这两种经历的人照常在");
	});
});

describe("主张和排除用了同一个词", () => {
	before(async () => {
		await seed([
			{
				empId: "V001",
				name: "第一个词命中",
				segments: [{ seqL2: "星舰算法", months: 36 }],
			},
			{
				empId: "V002",
				name: "只有第二个词命中",
				segments: [{ seqL2: "星舰推演", months: 36 }],
			},
		]);
	});

	test("排除和正向用了同一个词：各自生效，写了什么就搜什么", async () => {
		const { results } = await run("星舰算法/星舰推演,-星舰推演");
		// 有「星舰推演」经历的人被排除；只靠「星舰算法」命中的人留下。
		// 不替用户猜他想要哪一头：两枚 chip 都在屏幕上，改哪个由他定。
		const ids = results.map((r) => r.employee.empId);
		assert.ok(!ids.includes("V002"));
		assert.ok(ids.includes("V001"));
	});
});

describe("待业只属于时间线", () => {
	test("待业不进命中、不满足背景年限，也不提供公司名；岗位文字不是判据", async () => {
		await seed([
			{
				empId: "IDLE001",
				name: "合成空档",
				segments: [
					{
						kind: "external",
						unemployed: true,
						title: "空档判据验证",
						company: "只在待业里的合成公司",
						companyTag: "大厂",
						months: 36,
					},
				],
			},
			{
				empId: "IDLE002",
				name: "合成工作",
				segments: [{ kind: "external", title: "空档判据验证", months: 12 }],
			},
		]);
		const result = await run("空档判据验证");
		assert.ok(result.results.some((r) => r.employee.empId === "IDLE002"));
		assert.ok(!result.results.some((r) => r.employee.empId === "IDLE001"));
		const gate = await search({
			conditions: parseQuery(
				"company:只在待业里的合成公司 kind:external minMonths:36",
			),
		});
		assert.equal(gate.total, 0);
		const { lookupNames } = await import("#/search/search");
		assert.equal(
			(await lookupNames("company", ["只在待业里的合成公司"]))[0]?.people,
			0,
		);
	});
});

test("同段按投入选择证据：主导的技能压过提到的，岗位不打折", async () => {
	const what = "跨境支付风控";
	await seed([
		{
			empId: "DEPTH_A",
			name: "合成主导与提到",
			segments: [
				{
					months: 24,
					extracted: {
						skills: [
							{ text: `${what}甲`, engagement: "主导" },
							{ text: what, engagement: "提到" },
						],
					},
				},
			],
		},
		{
			empId: "DEPTH_B",
			name: "合成主导",
			segments: [
				{
					months: 24,
					extracted: {
						skills: [{ text: `${what}乙丙`, engagement: "主导" }],
					},
				},
			],
		},
		{
			empId: "DEPTH_C",
			name: "合成未判投入",
			segments: [{ months: 24, extracted: { skills: [what] } }],
		},
		{
			empId: "DEPTH_D",
			name: "合成岗位与提到",
			segments: [
				{
					kind: "external",
					title: what,
					months: 24,
					extracted: { skills: [{ text: what, engagement: "提到" }] },
				},
			],
		},
	]);
	const { results } = await run(what);
	// 深度相同的按工号；没判出档的技能按「做过」打折，排在最后
	assert.deepEqual(
		results.map((r) => r.employee.empId),
		["DEPTH_A", "DEPTH_B", "DEPTH_D", "DEPTH_C"],
	);
	// 全部仍在做且只有 24 个月，时长因子为 24/(24+48) = 1/3。
	for (const [i, strength] of [1, 1, 1, 0.85].entries()) {
		const result = results[i];
		assert.ok(result);
		assert.ok(Math.abs(result.depth - strength / 3) < 1e-6);
		assert.equal(result.evidence.length, 1);
		assert.equal(result.basis[0]?.months, 24);
	}
	assert.equal(results[0]?.evidence[0]?.phrase, `${what}甲`);
	assert.equal(results[0]?.evidence[0]?.engagement, "主导");
	assert.equal(results[2]?.evidence[0]?.route, "title");
});

test("跨公司内与入职前的依据保留每段来源，累计月份与段数传到导出", async () => {
	const title = "合成累计核对工程师";
	await seed([
		{
			empId: "BASIS_MIXED",
			name: "合成累计样例",
			segments: [
				{
					kind: "external",
					title,
					company: "合成外部公司",
					months: 24,
					endDate: "2020-01-01",
				},
				{ kind: "internal", title, department: "合成部门", months: 12 },
			],
		},
	]);
	const outcome = await run(title);
	const result = outcome.results[0];
	assert.ok(result);
	assert.equal(outcome.total, 1);
	assert.deepEqual(result.basis, [{ months: 36, endDate: null, segments: 2 }]);
	assert.deepEqual(result.evidence.map((e) => e.kind).toSorted(), [
		"external",
		"internal",
	]);
	const found = claimLines(result, outcome.claims)[0]?.found;
	assert.ok(found);
	assert.equal(
		evidenceText(found.evidence, found.basis),
		`岗位 ${title} · 合成外部公司 · 累计 3.0 年`,
	);
});
