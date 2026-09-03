/**
 * 检索语义的集成测试。跑在临时 schema 上的真 SQL、真 pgvector。
 *
 * 打分本身不在这里——它是纯函数，钉在 `tests/rank.test.ts`，不必起数据库。
 * 这里管的是打分**够得着的事实**：哪一路过了阈值、相关度、月数和结束日期
 * 有没有原样传到打分那一层。列名或日期序列化错误只有走真 SQL 才看得见，
 * 而纯函数测试对它完全无感。
 *
 * 嵌入是假的（见 fixture.ts 的 `fakeEmbedding`）：相关度 = 共有字数 / √(字数×字数)，
 * 所以每条断言旁边都算得出那个数。「算法」对「算法工程师」是 0.63，过 0.6 的
 * 阈值；对「算法平台运维工程师」是 0.47，不过。种子里的文本都按这把尺挑过，
 * 它们钉的是机制，不是语义。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { parseChips } from "#/search/parse";
import { fakeSimilarity, holdNextRerank, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 与 #/server/embed 在模块求值时就绑死了环境变量
const { overflowContributors, probeWide, search, vocabulary } = await import(
	"#/search/search"
);
const { db } = await import("#/db");
const { pool } = await import("#/db");
const run = async (
	evidence: ReturnType<typeof parseChips>,
	filters = {},
	limit?: number,
) => {
	const outcome = await search(
		{ evidence, scope: {}, notices: [] },
		filters,
		limit,
	);
	assert.equal(outcome.order, "relevance");
	if (outcome.order !== "relevance")
		throw new Error("概念词查询未进入相关度路径");
	return outcome;
};
const { RESULT_PAGE, RECALL_MIN, RELEVANCE_MIN, RELEVANCE_MIN_EXCLUDE } =
	await import("#/search/weights");

describe("语料快照", () => {
	test("整库重灌会等待正在检索的旧语料，不在一次结果里混代", async () => {
		await seed([
			{
				empId: "SNAP001",
				name: "快照测试",
				segments: [{ title: "快照一致性专用", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pendingSearch = run(parseChips("快照一致性专用"));
		await gate.entered;

		const writer = await pool.connect();
		let reload: Promise<unknown> | null = null;
		try {
			await writer.query("begin");
			const pid = (
				await writer.query<{ pid: number }>("select pg_backend_pid() as pid")
			).rows[0]?.pid;
			if (!pid) throw new Error("无法取得测试写连接的 pid");
			reload = (async () => {
				await writer.query(
					"lock table embedding_space in access exclusive mode",
				);
				await writer.query(
					"truncate experience, employee, phrase, embedding_space restart identity cascade",
				);
			})();

			let waiting = false;
			for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
				const state = await db.execute<{ waiting: boolean }>(sql`
					select wait_event_type = 'Lock' as waiting
					from pg_stat_activity where pid = ${pid}`);
				waiting = state.rows[0]?.waiting ?? false;
				if (!waiting) await new Promise((resolve) => setTimeout(resolve, 5));
			}
			assert.ok(waiting, "整库重灌应等待检索释放语料快照");

			gate.release();
			const result = await pendingSearch;
			assert.equal(result.results[0]?.employee.empId, "SNAP001");
			await reload;
			await writer.query("rollback");
			reload = null;
		} finally {
			gate.release();
			if (reload) await reload;
			await writer.query("rollback").catch(() => {});
			writer.release();
		}
	});

	test("同一新词并发检索共享确定性缓存，不因写入竞争失败", async () => {
		await seed([
			{
				empId: "CACHE001",
				name: "缓存并发测试",
				segments: [{ title: "缓存并发专用", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const first = run(parseChips("缓存并发专用"));
		await gate.entered;
		let secondError: unknown;
		try {
			const second = await run(parseChips("缓存并发专用"));
			assert.equal(second.results[0]?.employee.empId, "CACHE001");
		} catch (error) {
			secondError = error;
		} finally {
			gate.release();
		}
		const result = await first;
		if (secondError) throw secondError;
		assert.equal(result.results[0]?.employee.empId, "CACHE001");
	});
});

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
	]);
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

describe("检索数据约束", () => {
	const insert = (
		kind: string,
		start: string,
		end: string | null,
		months: number,
	) =>
		db.execute(sql`
			insert into experience (emp_id, kind, start_date, end_date, months)
			values ('T001', ${kind}, ${start}, ${end}, ${months})`);
	const violates = (constraint: string) => (error: unknown) =>
		error instanceof Error &&
		error.cause instanceof Error &&
		error.cause.message.includes(constraint);

	test("经历来源只能是公司内或入职前", async () => {
		await assert.rejects(
			insert("contractor", "2020-01-01", null, 1),
			violates("experience_kind_valid"),
		);
	});

	test("经历时长必须为正数", async () => {
		await assert.rejects(
			insert("internal", "2020-01-01", null, 0),
			violates("experience_months_positive"),
		);
	});

	test("结束日期不能早于开始日期", async () => {
		await assert.rejects(
			insert("external", "2020-02-01", "2020-01-01", 1),
			violates("experience_dates_ordered"),
		);
	});

	test("经历必须属于已存在的员工", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into experience (emp_id, kind, start_date, months)
				values ('不存在', 'internal', '2020-01-01', 1)`),
			violates("experience_emp_id_employee_emp_id_fk"),
		);
	});

	test("说法只能挂在四路之一上", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into experience_phrase (experience_id, route, phrase_id)
				values (1, 'summary', (select min(id) from phrase))`),
			violates("experience_phrase_route_valid"),
		);
	});

	test("同一串字只存一次：说法表按原文唯一", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into phrase (text, embedding)
				select text, embedding from phrase limit 1`),
			violates("phrase_text_unique"),
		);
	});

	test("重排相关度只能落在零到一之间", async () => {
		await assert.rejects(
			db.execute(sql`
				insert into phrase_relevance (space, query, phrase_id, relevance)
				select 'fake-v1', '非法分数', min(id), 1.1 from phrase`),
			violates("phrase_relevance_range"),
		);
	});
});

describe("语义命中", () => {
	test("假端点下进门线只有一个数：召回地板不高于判定线", () => {
		// 假重排分数就是假余弦。召回地板必须覆盖判定线，下面每条断言才由
		// RELEVANCE_MIN 这一个成员门槛决定。
		assert.ok(RECALL_MIN <= RELEVANCE_MIN);
	});

	test("整词不必出现在原文里：相关度过阈值就是命中", async () => {
		// 「线下渠道运营」对序列「渠道运营」是 4/√(6×4) ≈ 0.82
		assert.ok(fakeSimilarity("线下渠道运营", "渠道运营") >= RELEVANCE_MIN);
		const { results } = await run(parseChips("线下渠道运营"));
		assert.ok(results.some((r) => r.employee.empId === "T006"));
	});

	test("相关度不过阈值的段不算命中", async () => {
		// 「算法」对「算法平台运维工程师」是 2/√(2×9) ≈ 0.47
		assert.ok(fakeSimilarity("算法", "算法平台运维工程师") < RELEVANCE_MIN);
		const { results } = await run(parseChips("算法"));
		assert.ok(!results.some((r) => r.employee.empId === "T007"));
	});

	test("语料里完全不相干的词一个人都捞不到", async () => {
		const { results } = await run(parseChips("量子炼金"));
		assert.equal(results.length, 0);
	});

	test("相关度原样到达打分层与证据行", async () => {
		const { results } = await run(parseChips("算法"));
		const t2 = results.find((r) => r.employee.empId === "T002");
		const expected = fakeSimilarity("算法", "算法工程师");
		assert.ok(Math.abs((t2?.basis[0]?.relevance ?? 0) - expected) < 0.01);
		assert.ok(Math.abs((t2?.hits[0]?.relevance ?? 0) - expected) < 0.01);
		const t1 = results.find((r) => r.employee.empId === "T001");
		assert.equal(t1?.basis[0]?.relevance, 1, "原文和条件一字不差就是 1");
	});
});

describe("AND 语义", () => {
	test("每个概念词都要命中，缺一个就被淘汰", async () => {
		const { results } = await run(parseChips("算法 运营"));
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "两词都命中的人应当在结果里");
		assert.ok(!ids.includes("T002"), "只命中「算法」的人必须被淘汰");
	});

	test("两个词可以落在不同的经历段上", async () => {
		const { results } = await run(parseChips("算法 运营"));
		const t001 = results.find((r) => r.employee.empId === "T001");
		const segs = new Set(t001?.hits.map((h) => h.experienceId));
		assert.equal(segs.size, 2, "两个词应当来自两段不同的经历");
	});

	test("没有可检索概念词时不返回任何人", async () => {
		const { terms, results } = await run(parseChips("帮我找一下的人"));
		assert.equal(terms.length, 0);
		assert.equal(results.length, 0);
	});
});

describe("结构化范围是独立的候选定义", () => {
	test("没有语义要求也能按范围找到人，不调用向量词伪造候选", async () => {
		const outcome = await search({
			evidence: [],
			scope: { kind: "external" },
			notices: [],
		});
		assert.equal(outcome.order, "employee");
		assert.deepEqual(
			outcome.results.map((result) => result.employee.empId),
			["T001", "T003"],
		);
		assert.ok(outcome.results.every((result) => !("hits" in result)));
		assert.deepEqual(outcome.facets.kind, [{ value: "external", n: 2 }]);
	});

	test("查询范围是硬约束，视图只能继续收窄，不能换掉它", async () => {
		const outcome = await search(
			{ evidence: [], scope: { kind: "external" }, notices: [] },
			{ kind: "internal" },
		);
		assert.equal(outcome.total, 0);
	});

	test("有语义要求时，范围约束的是能够作证的经历段", async () => {
		const outcome = await search({
			evidence: parseChips("算法"),
			scope: { kind: "external" },
			notices: [],
		});
		assert.deepEqual(
			outcome.results.map((result) => result.employee.empId),
			["T003"],
		);
	});
});

describe("命中路径判定", () => {
	test("一段同时几路过阈值时取加权相关度最高的那一路", async () => {
		// 「安全」对部门「安全部」0.82 × 0.5，对描述「安全巡检」0.71 × 0.25：
		// 必须判成 org。
		const { results } = await run(parseChips("安全"));
		const hit = results
			.find((r) => r.employee.empId === "T004")
			?.hits.find((h) => h.term === "安全");
		assert.equal(hit?.route, "org");
	});

	test("加权强度相同时按全站路径顺序稳定选择", async () => {
		const { results } = await run(parseChips("算法"));
		const hit = results
			.find((result) => result.employee.empId === "T008")
			?.hits.find((item) => item.term === "算法");
		assert.equal(hit?.route, "seq");
	});

	test("受控字段命中排在仅简历自述之前", async () => {
		const { results } = await run(parseChips("算法 运营"));
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
 * 打分公式本身在 rank.test.ts 里钉死，这里只验一件事：**月数和结束日期确实
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
		const { results } = await run(parseChips("考古"));
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("R001") < rank.indexOf("R002"),
			"近因因子没生效：end_date 没传到打分层",
		);
	});

	test("累计时长合并同一路径的全部经历段", async () => {
		const { results } = await run(parseChips("考古"));
		const rank = results.map((r) => r.employee.empId);
		assert.ok(
			rank.indexOf("R003") < rank.indexOf("R001"),
			"两段 24 个月应当胜过一段 24 个月",
		);
	});

	test("同一批人不会再挤成一个分数", async () => {
		const { results } = await run(parseChips("考古"));
		const scores = new Set(results.map((r) => r.score));
		assert.equal(scores.size, 3, "三个人三个分数，排序才有分辨率");
	});
});

describe("筛选条件", () => {
	test("只看入职前经历会排除仅有在职命中的人", async () => {
		const { results } = await run(parseChips("算法"), { kind: "external" });
		assert.ok(!results.some((r) => r.employee.empId === "T001"));
	});

	test("最短时长会滤掉短段", async () => {
		const { results } = await run(parseChips("算法"), { minMonths: 30 });
		assert.ok(results.some((r) => r.employee.empId === "T005"));
		const hit = results
			.find((r) => r.employee.empId === "T005")
			?.hits.find((h) => h.term === "算法");
		assert.equal(hit?.months, 36);
	});

	test("收窄筛选只会让人变少，不会变多", async () => {
		const plain = await run(parseChips("算法"));
		const narrowed = await run(parseChips("算法"), { kind: "external" });
		assert.ok(narrowed.total <= plain.total);
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
		const { facets, total } = await run(parseChips("潜水"));
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
		const { facets, total } = await run(parseChips("潜水"), {
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
		const { results, facets } = await run(parseChips("潜水"), {
			org: "字节",
		});
		assert.deepEqual(
			results.map((r) => r.employee.empId),
			["P002"],
		);
		assert.deepEqual(facets.level, [{ value: "P7", n: 1 }]);
	});

	test("学校名同理", async () => {
		const { results } = await run(parseChips("潜水"), { school: "明德" });
		assert.deepEqual(results.map((r) => r.employee.empId).sort(), [
			"P001",
			"P003",
		]);
	});

	test("文本条件里的通配符只能是字面量", async () => {
		// 不转义的话「%%」就让每一行恒真，这个条件等于没筛
		assert.equal((await run(parseChips("潜水"), { org: "%%" })).total, 0);
		assert.equal(
			(await run(parseChips("潜水"), { school: "明_大学" })).total,
			0,
		);
	});

	test("词汇表只给语料里真有的取值", async () => {
		const v = await vocabulary();
		assert.deepEqual(v.levels, ["P7", "P6"]);
		assert.deepEqual(v.recruitments, ["校招", "社招"]);
		assert.deepEqual(v.educations, ["硕士", "本科"]);
	});
});

/**
 * 筛选面板的候选与计数。
 *
 * 这组测试钉的是口径：每一项后面的数是「选了它之后还剩多少**人**」，
 * 和表头那句「N 人」同一个单位，所以它必须和主检索用同一套 AND 语义。
 * 如果误计为经历段，分面会远大于结果人数，两个数字互相拆台。
 */
describe("分面", () => {
	before(async () => {
		await seed([
			{
				empId: "F001",
				name: "分面甲",
				segments: [{ seqL1: "技术", seqL2: "算法", months: 36 }],
			},
			{
				empId: "F002",
				name: "分面乙",
				segments: [{ seqL1: "技术", seqL2: "算法", months: 36 }],
			},
			{
				empId: "F003",
				name: "分面丙",
				segments: [
					{ seqL1: "运营", seqL2: "渠道", title: "算法运维", months: 36 },
				],
			},
			{
				empId: "F004",
				name: "分面丁",
				segments: [
					{
						kind: "external",
						seqL1: "技术",
						seqL2: "算法",
						months: 36,
						companyTag: "头部互联网T1",
					},
				],
			},
		]);
	});

	const seqOf = (facets: Awaited<ReturnType<typeof search>>["facets"]) =>
		new Map(facets.seq.map((s) => [`${s.seqL1}/${s.seqL2}`, s.n]));

	test("数的是人，而且只数这一次检索里的人", async () => {
		const { facets } = await run(parseChips("算法"));
		// 全库还有别的人序列里写着算法，但他们没有 seq_l1，进不了这一维；
		// 关键是这个数不可能超过命中总人数
		assert.equal(seqOf(facets).get("技术/算法"), 3);
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
	});

	test("口径和主检索一致：一个人要在这一项里凑齐全部概念词才算数", async () => {
		// F003 一段之内既有岗位「算法运维」又有序列「渠道」，两个词都落在「运营/渠道」里
		const { facets } = await run(parseChips("算法 渠道"));
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
		// F001/F002 在「技术/算法」里凑不齐「渠道」，这一项一个人都不剩
		assert.equal(seqOf(facets).get("技术/算法"), undefined);
	});

	test("算某一维时要摘掉这一维自己的筛选，否则选中之后就切不动了", async () => {
		const { facets, results } = await run(parseChips("算法"), {
			seqL1: "技术",
			seqL2: "算法",
		});
		assert.equal(results.length, 3, "结果本身是被筛过的");
		// 但序列这一维的候选不受它自己影响，别的序列还看得见、点得动
		assert.equal(seqOf(facets).get("运营/渠道"), 1);
		assert.equal(seqOf(facets).get("技术/算法"), 3);
	});

	test("别的维度的筛选照常收窄计数，但不让选项消失", async () => {
		// 只看入职前时，三位只有内部事实的人不能为任何序列贡献计数；
		// 「运营/渠道」因此归零，但它留在列表里（界面上是禁用的那一行）——
		// 列表只随查询变形，不随筛选变形，见 rank.ts 的 facetCount
		const { facets } = await run(parseChips("算法"), { kind: "external" });
		assert.equal(seqOf(facets).get("技术/算法"), 1);
		assert.equal(seqOf(facets).get("运营/渠道"), 0);
	});

	test("和这次查询无关的值不进列表——分面比全站短靠的是这个", async () => {
		// 没有筛选时值域和计数是同一个口径，所以这里一个 0 都不该有
		const { facets } = await run(parseChips("算法"));
		assert.ok(
			facets.seq.every((s) => s.n > 0),
			"没筛任何东西时不该出现计数为 0 的选项",
		);
		assert.ok(
			facets.companyTag.every((t) => t.value !== "" && t.value !== "未知"),
			"空档和未知档不是可点的筛选项",
		);
	});

	test("公司档与经历类型同样跟着查询走", async () => {
		const { facets } = await run(parseChips("算法"));
		assert.deepEqual(facets.companyTag, [{ value: "头部互联网T1", n: 1 }]);
		// F004 的入职前经历，加上 T003 那段简历原文里提到算法的入职前经历
		assert.equal(facets.kind.find((k) => k.value === "external")?.n, 2);
	});

	test("没有概念词就没有候选，不拿全库的数字充数", async () => {
		const { facets } = await run(parseChips("帮我找一下的人"));
		assert.deepEqual(facets.seq, []);
		assert.deepEqual(facets.minMonths, []);
	});
});

/**
 * 命中总数与「证据要求」。
 *
 * 这两件事同源，所以放在一起钉：顶上那句「N 人」报的必须是截断**之前**
 * 的人数，不能是 `results.length`（那是已经翻出来的那几页有多长），
 * 否则同一屏上分面 416、名单 50，两个数互相拆台。同样地，「证据要求」
 * 必须落在服务端，放到客户端它就只能筛那被截断的 50 个人。
 */
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
		const { results, total } = await run(parseChips("深海潜航"));
		assert.equal(results.length, RESULT_PAGE, "结果本身仍然截断");
		assert.equal(total, 55, "总数必须说真话");
	});

	test("分面和总数是同一个口径，不会一个 55 一个 50", async () => {
		const { total, facets } = await run(parseChips("深海潜航"));
		const seq = facets.seq.find((s) => s.seqL2 === "深海潜航");
		assert.equal(seq?.n, total);
	});

	/**
	 * 翻页。
	 *
	 * 这里要钉住的不是「第二页能不能拉到」，而是**第二页是第一页的延长，不是
	 * 另一次排序**：分页靠把 limit 调大重查，所以前 50 名必须逐位不变。
	 * 一旦哪天改成 offset 续拉，这条会红——那正是它存在的理由。
	 */
	test("翻页只是把同一次排序拉得更长，不是重排", async () => {
		const first = await run(parseChips("深海潜航"), {}, RESULT_PAGE);
		const more = await run(parseChips("深海潜航"), {}, RESULT_PAGE * 2);
		assert.equal(more.results.length, 55, "第二页要把剩下的都带回来");
		assert.equal(more.total, first.total, "总数不因翻页而变");
		assert.deepEqual(
			more.results.slice(0, RESULT_PAGE).map((r) => r.employee.empId),
			first.results.map((r) => r.employee.empId),
			"前一页的人必须逐位不变，否则翻页会漏人或重复",
		);
	});

	test("要多少给多少，但不会超过命中的人数", async () => {
		const { results } = await run(parseChips("深海潜航"), {}, 10);
		assert.equal(results.length, 10);
		assert.equal(
			(await run(parseChips("深海潜航"), {}, 999)).results.length,
			55,
		);
	});

	test("太宽的词按人数占比量出来", async () => {
		// 55 个「深海潜航」远超库里两成的人；「考古」只有三个
		const wide = await probeWide(["深海潜航", "考古"]);
		assert.deepEqual([...wide], ["深海潜航"]);
	});
});

describe("证据要求", () => {
	test("打开之后只剩每个词都有受控命中的人", async () => {
		const loose = await run(parseChips("算法 运营"));
		const strict = await run(parseChips("算法 运营"), { strong: true });
		const ids = strict.results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T001"), "序列 + 岗位命中，应当留下");
		assert.ok(!ids.includes("T003"), "两个词都只在简历原文里，应当被排除");
		assert.ok(strict.total < loose.total, "收窄之后总数必须变小");
	});

	test("那一项的两头：打开还剩几个、关掉能看到几个", async () => {
		const { facets, total } = await run(parseChips("算法 运营"));
		assert.equal(facets.strong.off, total, "关掉就是当前全部");
		assert.equal(
			facets.strong.on,
			(await run(parseChips("算法 运营"), { strong: true })).total,
			"打开的预告数必须等于真打开之后的结果",
		);
	});

	test("它自己开着的时候，那一项的预告数不受自己影响", async () => {
		const on = await run(parseChips("算法 运营"), { strong: true });
		const off = await run(parseChips("算法 运营"));
		assert.equal(on.facets.strong.off, off.total);
		assert.equal(on.facets.strong.on, off.facets.strong.on);
	});
});

describe("加分词", () => {
	test("不命中也留在结果里——这正是它和必须词的区别", async () => {
		// 「算法」必须，「运营」加分：T002 只有算法，必须留下
		const { results } = await run(parseChips("算法,+运营"));
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只命中必须词的人不该被加分词淘汰");
		assert.ok(ids.includes("T001"), "两个都命中的人当然也在");
	});

	test("命中了就往上抬，抬到只命中必须词的人前面", async () => {
		const { results } = await run(parseChips("算法,+运营"));
		const rank = results.map((r) => r.employee.empId);
		// T001 的「算法」是相似 1.0 的序列命中，T002 是相似 0.63 的岗位命中，
		// T001 本就靠前；这里要钉的是命中加分词的人不会掉到后面
		assert.ok(rank.indexOf("T001") < rank.indexOf("T002"));
	});

	test("加分只抬不压：命中的词越少，分不会反而越高", async () => {
		const { results } = await run(parseChips("算法,+运营"));
		const t001 = results.find((r) => r.employee.empId === "T001");
		const t005 = results.find((r) => r.employee.empId === "T005");
		assert.ok(t001 && t005);
		const only = await run(parseChips("算法"));
		const t001Only = only.results.find((r) => r.employee.empId === "T001");
		assert.ok(
			t001Only && t001.score > t001Only.score,
			"命中加分词分数必须上升",
		);
	});

	test("整句都是加分词时退化成 OR：命中任意一个就算数", async () => {
		const { results } = await run(parseChips("+算法,+运营"));
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("T002"), "只有算法");
		// 「渠道运营」对「运营」是 0.71，过线；对「算法」是 0——只命中第二个加分词
		assert.ok(ids.includes("T006"), "只有运营");
	});

	test("分面口径跟着走：加分词不参与「还剩几人」的计算", async () => {
		const { facets, total } = await run(parseChips("算法,+运营"));
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
		]);
	});

	test("否决的阈值比进门高", () => {
		assert.ok(RELEVANCE_MIN_EXCLUDE > RELEVANCE_MIN);
	});

	test("命中排除词的段丧失作证资格；只有这类证据的人自然出局", async () => {
		const loose = await run(parseChips("算法"));
		const tight = await run(parseChips("算法,-运营"));
		assert.ok(loose.results.some((r) => r.employee.empId === "X001"));
		assert.ok(!tight.results.some((r) => r.employee.empId === "X001"));
	});

	test("别的段还有证据的人留下——排除砍的是证据，不是人", async () => {
		// T001 的「算法」证据在序列段上，被否决的是他那段「运营」经历。
		// 人级排除会把这种人整个剔掉，违背「排除只否决证据段」的语义。
		const { results } = await run(parseChips("算法,-运营"));
		const t001 = results.find((r) => r.employee.empId === "T001");
		assert.ok(t001, "有独立算法证据的人不因一段运营经历被整个排掉");
		assert.ok(
			t001.hits.every((h) => h.title !== "运营"),
			"被否决的段也不能再出现在证据行里",
		);
	});

	test("相似但没到否决阈值的段不被否决", async () => {
		// T003 的描述「算法运营」对「运营」是 0.71，过进门线、不过否决线
		assert.ok(fakeSimilarity("运营", "算法运营") < RELEVANCE_MIN_EXCLUDE);
		const { results } = await run(parseChips("算法,-运营"));
		assert.ok(results.some((r) => r.employee.empId === "T003"));
	});

	test("总数与分面跟着一起减", async () => {
		const tight = await run(parseChips("算法,-运营"));
		assert.equal(tight.facets.strong.off, tight.total);
		assert.equal(tight.total, tight.results.length);
	});

	test("排除词不占列：它不产出证据，表格里没有它的位置", async () => {
		const { terms } = await run(parseChips("算法,-运营"));
		assert.deepEqual(
			terms.map((t) => t.term),
			["算法"],
		);
	});

	test("整句只有排除词时不返回任何人——它只会剔人，不会捞人", async () => {
		const { terms, results } = await run(parseChips("-算法"));
		assert.equal(terms.length, 0);
		assert.equal(results.length, 0);
	});

	test("语料里没有的排除词谁都排不掉", async () => {
		const plain = await run(parseChips("算法"));
		const withExclude = await run(parseChips("算法,-量子炼金"));
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
		const only = await run(parseChips("算法"));
		const withOff = await run(parseChips("算法,~运营"));
		assert.equal(withOff.total, only.total);
		assert.deepEqual(
			withOff.results.map((r) => r.employee.empId),
			only.results.map((r) => r.employee.empId),
		);
	});

	test("停用的词不占列：表格里没有它的位置", async () => {
		const { terms } = await run(parseChips("算法,~运营"));
		assert.deepEqual(
			terms.map((t) => t.term),
			["算法"],
		);
	});

	test("停用一个排除词，被它排掉的人回来了", async () => {
		const excluded = await run(parseChips("算法,-运营"));
		const off = await run(parseChips("算法,~-运营"));
		assert.ok(off.total > excluded.total, "停用排除词必须放人回来");
		assert.equal(off.total, (await run(parseChips("算法"))).total);
	});

	test("分面跟着走：停用的词不参与「还剩几人」", async () => {
		const off = await run(parseChips("算法,~运营"));
		const only = await run(parseChips("算法"));
		assert.deepEqual(off.facets.seq, only.facets.seq);
		assert.equal(off.facets.strong.off, only.facets.strong.off);
	});

	test("全停用了就没有可排的人——和空查询同一个结果", async () => {
		const { terms, results, total } = await run(parseChips("~算法,~运营"));
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
		const { terms, results } = await run(parseChips("机甲算法/深度学习"));
		assert.equal(terms.length, 1, "一条要求，不是两条");
		const ids = results.map((r) => r.employee.empId);
		assert.ok(ids.includes("M001") && ids.includes("M002"));
	});

	test("证据行说出实际命中的说法，而不是要求的主词", async () => {
		const { results } = await run(parseChips("机甲算法/深度学习"));
		const m1 = results.find((r) => r.employee.empId === "M001");
		assert.equal(m1?.hits[0]?.term, "机甲算法", "行归属仍是这条要求");
		assert.equal(m1?.hits[0]?.member, "深度学习", "但命中的说法必须如实说");
	});

	test("同一段命中同一要求的两个说法，只贡献一次", async () => {
		// 说法之间是 OR，不是两条证据：不去重的话 termValue 会把这 12 个月
		// 累加成 24，分数、展示的累计月数、证据行全跟着说谎。
		const { results } = await run(parseChips("机甲算法/深度学习"));
		const m4 = results.find((r) => r.employee.empId === "M004");
		assert.equal(m4?.basis[0]?.months, 12, "月份只能计一次");
		assert.equal(m4?.hits.length, 1, "证据行只列这一段一次");
	});

	test("排除组的说法取并集，但仍然只否决段", async () => {
		const { results } = await run(parseChips("机甲算法,-机甲拳击/下棋"));
		const ids = results.map((r) => r.employee.empId);
		// M003 的「下棋」段被第二个说法否决，但他的「机甲算法」证据无恙
		assert.ok(ids.includes("M003"), "无关段被否决不影响这个人");
		const m3 = results.find((r) => r.employee.empId === "M003");
		assert.ok(m3?.hits.every((h) => h.seq !== "下棋"));
	});
});
