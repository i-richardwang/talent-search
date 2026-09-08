/**
 * 语料侧三种任务连起来跑：同步读仓库自带的合成样例、派生给段算说法与向量、
 * 任务的记录与活性。
 *
 * 这是唯一一处把整条语料链路连起来跑的测试。链路上的每一段单独看都对得上、
 * 连起来却可能对不上：暂存表的列、`unnest` 每一列的类型、段的内容键有没有让
 * 派生结果跨同步活下来、说法和边有没有指对。这些错一旦发生，屏幕上的表现是
 * 「搜什么都搜不到」，而没有任何一个单元测试会红。
 *
 * 端点是进程内那三台假的，所以这里量的是**机制**，不是抽得准不准。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { TaskOutcome } from "#/server/tasks";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { runTask, tasksState, derivePending } = await import("#/server/tasks");
const { phrasePlan } = await import("#/corpus/derive");
const { summary } = await import("#/routes/tasks");
const { acquireCorpusSession, corpusSessionActive } = await import(
	"#/corpus/session"
);
const { EMPTY } = await import("#/corpus/extract");
const { db } = await import("#/db");
const { taskRun } = await import("#/db/schema");
const { sql } = await import("drizzle-orm");

/**
 * 三处语料侧调用各自认出自己的提示词。
 *
 * 对齐照抄提示词里列出的第一对序列——那份列表是从这批样例数据自己长出来的，
 * 所以不必在这里再写一遍它有哪些序列。
 */
function answers() {
	return answerChat((system, _prompt) => {
		if (system.includes("两类短说法"))
			return {
				skills: ["数据分析"],
				did: [{ involvement: "负责建设", domain: "推荐系统" }],
			};
		if (system.includes("属于哪个序列")) {
			const first = /^- (.+) · (.+)$/m.exec(system);
			return { l1: first?.[1] ?? "", l2: first?.[2] ?? "" };
		}
		return { judgments: [] };
	});
}

async function count(table: string, where = "true"): Promise<number> {
	const { rows } = await db.execute<{ n: number }>(
		sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.raw(where)}`,
	);
	return rows[0]?.n ?? 0;
}

function lane(state: Awaited<ReturnType<typeof tasksState>>, kind: string) {
	const found = state.lanes.find((one) => one.kind === kind);
	assert.ok(found);
	return found;
}

describe("同步与派生", () => {
	let restore = () => {};
	before(() => {
		restore = answers();
	});
	after(() => restore());

	test("已经有写者的时候后台任务当场放弃，而活性问的是锁", async () => {
		const held = await acquireCorpusSession();
		assert.ok(held);
		assert.equal(await corpusSessionActive(), true);
		assert.equal(await runTask("derive"), null);
		await held.release();
		// 持锁的连接一断，这件事当场就不成立了——不需要谁来打扫
		assert.equal(await corpusSessionActive(), false);
	});

	test("同步只搬原始的一半：人和段进来了，说法一条都没有", async () => {
		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);

		// 样例里是编出来的二十个人
		assert.equal(await count("employee"), 20);
		assert.ok((await count("experience")) > 20);
		assert.equal(await count("phrase"), 0);
		assert.equal(await derivePending(), await count("experience"));

		const state = await tasksState();
		const sync = lane(state, "sync");
		assert.equal(sync.latest?.outcome, "done");
		assert.equal(sync.latest?.source, "csv-dir");
		assert.match(sync.latest?.log.join("\n") ?? "", /人群 20 人/);
		assert.equal(state.derive.pending, state.derive.total);
	});

	test("派生给每一段算说法、连边、对齐序列，做完一段不剩", async () => {
		const run = await runTask("derive");
		assert.ok(run);
		assert.equal(run.failure, null);

		assert.ok((await count("phrase")) > 0);
		assert.ok((await count("experience_phrase")) > 0);
		// 抽取的两路确实指回了经历段
		assert.ok((await count("experience_phrase", "route = 'skill'")) > 0);
		// 对齐只写推断的两列，登记的三列不动
		assert.ok(
			(await count(
				"experience",
				"kind = 'external' and seq_inferred_l1 <> '' and seq_l1 = ''",
			)) > 0,
		);
		assert.equal(await derivePending(), 0);
		assert.equal(lane(await tasksState(), "derive").latest?.outcome, "done");
	});

	test("数据页看得到每一段的派生结果", async () => {
		const { listEmployees, employeeData } = await import("#/server/data");
		const list = await listEmployees("");
		assert.equal(list.total, 20);
		assert.equal(list.rows.length, 20);
		assert.ok(list.rows.every((row) => row.pending === 0));
		const one = list.rows.find((row) => row.segments > 0);
		assert.ok(one);
		assert.deepEqual(
			(await listEmployees(one.name)).rows.map((row) => row.empId),
			[one.empId],
		);

		const person = await employeeData(one.empId);
		assert.ok(person);
		assert.equal(person.segments.length, one.segments);
		assert.ok(person.segments.every((segment) => segment.derived));
		// 假端点给每一段入职前描述都抽出「数据分析」和「负责建设 · 推荐系统」
		const described = person.segments.find(
			(segment) => segment.kind === "external" && segment.description,
		);
		if (described) {
			assert.deepEqual(described.skills, ["数据分析"]);
			assert.deepEqual(described.did, [
				{ involvement: "负责建设", domain: "推荐系统" },
			]);
		}
		assert.equal(await employeeData("没有这个人"), null);
	});

	test("再同步一次是幂等的：段按内容认，派生结果原样留下", async () => {
		const edges = await count("experience_phrase");
		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.equal(await count("employee"), 20);
		assert.equal(await count("experience_phrase"), edges);
		assert.equal(await derivePending(), 0);
	});

	test("一段的内容变了就是新段：旧段连边一起走，新段待派生", async () => {
		// 直接改库里一段的描述：键由库算，跟着变；下一次同步认不出它，当它走了
		const { rows } = await db.execute<{ id: number }>(sql`
			update experience set description = description || '（改过）'
			where id = (select min(id) from experience where kind = 'external')
			returning id`);
		const changed = rows[0]?.id;
		assert.ok(changed);

		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.equal(await count("experience", `id = ${changed}`), 0);
		assert.equal(await derivePending(), 1);
		assert.match(
			lane(await tasksState(), "sync").latest?.log.join("\n") ?? "",
			/新来 1 段、离开 1 段/,
		);
	});

	/*
	 * 任务台那条路：后台开一轮，过程长在那一行上，页面隔一会儿看一眼。
	 * 从「正在跑」到「成功」之间不许有一刻读作「中断」——判据是先看锁、再看行，
	 * 而行是写完了才放锁的；这两条哪一条反了，页面就会在收尾那一瞬停掉轮询。
	 */
	test("后台跑的那一轮：一路轮询到成功，中间没有一刻像中断", async () => {
		const running = runTask("derive");
		const seen = new Set<TaskOutcome>();
		let state = await tasksState();
		while (lane(state, "derive").latest?.outcome === "running") {
			seen.add("running");
			await new Promise((resolve) => setTimeout(resolve, 20));
			state = await tasksState();
		}
		const run = await running;
		assert.ok(run);
		const latest = lane(await tasksState(), "derive").latest;
		assert.equal(latest?.id, run.runId);
		seen.add(latest?.outcome ?? "interrupted");

		assert.ok(!seen.has("interrupted"), "没有一刻读作中断");
		assert.equal(latest?.outcome, "done");
		assert.equal(await derivePending(), 0);
	});

	/*
	 * 进程跑到一半没了，留下一行没有结束时间的记录。它读作「中断」而不是
	 * 「正在跑」——判据是锁，而锁随着那个进程一起没了。
	 */
	test("中断的那一行读作中断，不挡住下一次", async () => {
		const [stale] = await db
			.insert(taskRun)
			.values({ kind: "review", log: ["跑到一半进程没了"] })
			.returning({ id: taskRun.id });
		assert.ok(stale);

		const before = lane(await tasksState(), "review");
		assert.equal(before.latest?.id, stale.id);
		assert.equal(before.latest?.outcome, "interrupted");
		assert.equal(before.latest?.seconds, null);

		const run = await runTask("review");
		assert.ok(run);
		assert.equal(run.failure, null);

		const after = lane(await tasksState(), "review");
		assert.equal(after.latest?.outcome, "done");
		assert.equal(
			after.history.find((one) => one.id === stale.id)?.outcome,
			"interrupted",
		);
	});

	/*
	 * 失败是这张表存在的理由之一：看任务台的人看不到服务器的标准输出。
	 * 数据源读不出来时，最外层那句话说的是「哪一步出的事」，真正发生了什么挂在
	 * `cause` 上——两句都得在。
	 */
	test("跑失败时，那一行说得出为什么，连它的来由", async () => {
		const configured = process.env.TALENT_SOURCE;
		process.env.TALENT_SOURCE = "没有这个适配器";
		let failure: string | null = null;
		try {
			const run = await runTask("sync");
			assert.ok(run);
			failure = run.failure;
		} finally {
			process.env.TALENT_SOURCE = configured;
		}
		assert.match(failure ?? "", /读取数据源 没有这个适配器 失败/);

		const latest = lane(await tasksState(), "sync").latest;
		assert.equal(latest?.outcome, "failed");
		assert.equal(latest?.error, failure);
		const log = latest?.log.join("\n") ?? "";
		assert.match(log, /✖ 读取数据源/);
		// 来由那一层：模块加载自己报的话，不是我们替它编的
		assert.match(log, /↳/);
		// 失败的同步一行都没动
		assert.equal(await count("employee"), 20);
	});

	test("换了嵌入空间：说法整张作废，所有段重新派生，身份证重写", async () => {
		await db.execute(sql`update embedding_space set space_id = 'old-space'`);
		const run = await runTask("derive");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.match(
			lane(await tasksState(), "derive").latest?.log.join("\n") ?? "",
			/嵌入空间从 old-space/,
		);
		const { rows } = await db.execute<{ space_id: string }>(
			sql`select space_id from embedding_space`,
		);
		assert.deepEqual(
			rows.map((row) => row.space_id),
			["fake-v1"],
		);
		assert.equal(await derivePending(), 0);
		assert.ok((await count("experience_phrase")) > 0);
	});
});

describe("说法规划", () => {
	const segment = (row: Partial<Parameters<typeof phrasePlan>[0][number]>) => ({
		id: 1,
		emp_id: "E1",
		kind: "internal" as const,
		start_date: "2020-01-01",
		end_date: null,
		org: "平台技术部",
		org_path: "示例科技/技术中心/平台技术部",
		org_meta: null,
		title: "算法工程师",
		seq_l1: "技术",
		seq_l2: "算法",
		seq_l3: "",
		seq_inferred_l1: "",
		seq_inferred_l2: "",
		level: "",
		description: "",
		months: 12,
		...row,
	});
	const outside = segment({
		id: 7,
		kind: "external",
		org: "云枢智能",
		org_path: "",
		seq_l1: "",
		seq_l2: "",
		description: "负责推荐系统召回",
	});

	test("同一串字只嵌一次，几条边各指向它", () => {
		const { texts, links } = phrasePlan([segment({}), outside], [EMPTY, EMPTY]);
		assert.deepEqual(texts, [
			"技术 · 算法",
			"算法工程师",
			"示例科技/技术中心/平台技术部",
			"云枢智能",
			"负责推荐系统召回",
		]);
		assert.deepEqual(
			links.map((l) => [l.experienceId, l.route, l.text]),
			[
				[1, "seq", "技术 · 算法"],
				[1, "title", "算法工程师"],
				[1, "org", "示例科技/技术中心/平台技术部"],
				[7, "title", "算法工程师"],
				[7, "org", "云枢智能"],
				[7, "description", "负责推荐系统召回"],
			],
		);
	});

	test("空语料没有说法也没有边", () => {
		assert.deepEqual(phrasePlan([], []), { texts: [], links: [] });
	});

	test("抽出来的两路和原文四路共用同一张说法表", () => {
		// 能力词「算法工程师」和第 1 段的岗位名是同一串字：只嵌一次，两条边各成一条边
		const { texts, links } = phrasePlan(
			[segment({}), outside],
			[
				EMPTY,
				{
					skills: ["算法工程师", "召回"],
					did: [{ involvement: "负责建设", domain: "推荐系统" }],
				},
			],
		);
		assert.equal(texts.filter((t) => t === "算法工程师").length, 1);
		// 做过的事的说法只是领域，参与方式落在边上；原文路的边那一列是空
		assert.deepEqual(texts.slice(-2), ["召回", "推荐系统"]);
		assert.deepEqual(
			links.filter(
				(l) =>
					l.experienceId === 7 && (l.route === "skill" || l.route === "did"),
			),
			[
				{
					experienceId: 7,
					route: "skill",
					text: "算法工程师",
					involvement: null,
				},
				{ experienceId: 7, route: "skill", text: "召回", involvement: null },
				{
					experienceId: 7,
					route: "did",
					text: "推荐系统",
					involvement: "负责建设",
				},
			],
		);
	});
});

describe("页面上那几句话", () => {
	const lanes = () => [];
	test("语料是空的时候，抬头说两种任务各做什么", () => {
		assert.match(
			summary({ lanes: lanes(), derive: { pending: 0, total: 0 } }),
			/语料是空的/,
		);
	});
	test("有活的时候说还剩几段，没活的时候说全部派生到了当前版本", () => {
		assert.match(
			summary({ lanes: lanes(), derive: { pending: 3, total: 10 } }),
			/10 段里还有 3 段待派生/,
		);
		assert.match(
			summary({ lanes: lanes(), derive: { pending: 0, total: 10 } }),
			/全部派生到了当前版本/,
		);
	});
});
