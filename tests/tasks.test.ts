/**
 * 语料侧三种任务连起来跑：同步读仓库自带的合成样例、派生给段算说法与向量、
 * 任务的记录与活性。
 *
 * 这是唯一一处把整条语料链路连起来跑的测试。链路上的每一段单独看都对得上、
 * 连起来却可能对不上：暂存表的列、`unnest` 每一列的类型、段的内容键有没有让
 * 派生结果跨同步活下来、说法和边有没有指对。这些错一旦发生，屏幕上的表现是
 * 「搜什么都搜不到」，而不会有任何单元测试失败。
 *
 * 端点是进程内那三台假的，所以这里量的是**机制**，不是抽得准不准。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { CorpusCounts, TaskOutcome } from "#/server/tasks";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { runTask, tasksState, taskLog, derivePending } = await import(
	"#/server/tasks"
);
const { phrasePlan } = await import("#/corpus/derive");
const { facts } = await import("#/routes/tasks");
const { acquireCorpusSession, corpusSessionActive } = await import(
	"#/corpus/session"
);
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

/** 这一栏最近的一次运行。记录按时间倒着排，最新的那一行在最前面。 */
function latest(state: Awaited<ReturnType<typeof tasksState>>, kind: string) {
	return lane(state, kind).runs[0];
}

/** 那一次说过的每一行。状态里不带日志，要单取。 */
async function logText(runId: number | undefined): Promise<string> {
	return runId === undefined ? "" : (await taskLog(runId)).join("\n");
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
		const sync = latest(state, "sync");
		assert.equal(sync?.outcome, "done");
		assert.equal(sync?.source, "csv-dir");
		assert.match(await logText(sync?.id), /人群 20 人/);
		assert.equal(state.corpus.pending, state.corpus.segments);
	});

	test("派生给每一段算说法、连边、对齐序列，做完一段不剩", async () => {
		const run = await runTask("derive");
		assert.ok(run);
		assert.equal(run.failure, null);

		assert.ok((await count("phrase")) > 0);
		assert.ok((await count("experience_phrase")) > 0);
		// 抽取的两类确实指回了经历段
		assert.ok((await count("experience_phrase", "route = 'skill'")) > 0);
		// 对齐只写推断的两列，登记的三列不动
		assert.ok(
			(await count(
				"experience",
				"kind = 'external' and seq_inferred_l1 <> '' and seq_l1 = ''",
			)) > 0,
		);
		assert.equal(await derivePending(), 0);
		assert.equal(latest(await tasksState(), "derive")?.outcome, "done");
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

	/*
	 * 说法只有作为边的终点才有意义。没人指的行留着会把召回的账算错：它一条命中
	 * 都产生不了，却照样占 `RECALL_TOP` 的名额，挤掉真能找到人的说法。
	 */
	test("没有边指向的说法不留在表里", async () => {
		const orphans = async () =>
			count(
				"phrase",
				"not exists (select 1 from experience_phrase ep where ep.phrase_id = phrase.id)",
			);
		assert.equal(await orphans(), 0);

		// 造一条没人指的：换过一次抽取提示词之后，掉线的旧说法就是这个样子
		await db.execute(sql`
			insert into phrase (text, embedding)
			values ('没人会指的说法', (select embedding from phrase limit 1))`);
		assert.equal(await orphans(), 1);

		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.equal(await orphans(), 0);
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
			await logText(latest(await tasksState(), "sync")?.id),
			/新来 1 段、离开 1 段/,
		);
	});

	/*
	 * 任务台那条路：后台开一轮，过程记录在那一行上，页面隔一会儿看一眼。
	 * 从「正在跑」到「成功」之间不能有一刻读作「中断」——判据是先看锁、再看行，
	 * 而行是写完了才放锁的；这两条哪一条反了，页面就会在收尾那一瞬停掉轮询。
	 */
	test("后台跑的那一轮：一路轮询到成功，中间没有一刻像中断", async () => {
		const running = runTask("derive");
		const seen = new Set<TaskOutcome>();
		let state = await tasksState();
		while (latest(state, "derive")?.outcome === "running") {
			seen.add("running");
			await new Promise((resolve) => setTimeout(resolve, 20));
			state = await tasksState();
		}
		const run = await running;
		assert.ok(run);
		const final = latest(await tasksState(), "derive");
		assert.equal(final?.id, run.runId);
		seen.add(final?.outcome ?? "interrupted");

		assert.ok(!seen.has("interrupted"), "没有一刻读作中断");
		assert.equal(final?.outcome, "done");
		assert.equal(await derivePending(), 0);
	});

	/*
	 * 进程跑到一半没了，留下一行没有结束时间的记录。它读作「中断」而不是
	 * 「正在跑」——判据是锁，而锁随着那个进程一起没了。
	 */
	test("中断的记录标记为中断，不影响下一次触发", async () => {
		const [stale] = await db
			.insert(taskRun)
			.values({ kind: "review", log: ["跑到一半进程没了"] })
			.returning({ id: taskRun.id });
		assert.ok(stale);

		const stopped = latest(await tasksState(), "review");
		assert.equal(stopped?.id, stale.id);
		assert.equal(stopped?.outcome, "interrupted");
		assert.equal(stopped?.seconds, null);

		const run = await runTask("review");
		assert.ok(run);
		assert.equal(run.failure, null);

		const runs = lane(await tasksState(), "review").runs;
		assert.equal(runs[0]?.outcome, "done");
		assert.equal(
			runs.find((one) => one.id === stale.id)?.outcome,
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

		const broken = latest(await tasksState(), "sync");
		assert.equal(broken?.outcome, "failed");
		assert.equal(broken?.error, failure);
		const log = await logText(broken?.id);
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
			await logText(latest(await tasksState(), "derive")?.id),
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

test("词表跨嵌入空间保留，结算一条技能边都不动", async () => {
	const previous = process.env.REVIEW_JUDGE;
	process.env.REVIEW_JUDGE = "external";
	const restore = answers();
	try {
		await db.execute(sql`delete from review_question`);
		await db.execute(sql`insert into review_question (kind, words, judge, answer) values (
			'group', '[{"word":"数据分析","people":3}]'::jsonb, 'agent:test',
			'{"judgments":[{"word":"数据分析","sameAs":"","parent":"业务分析"}]}'::jsonb)`);
		assert.equal((await runTask("review"))?.failure, null);
		await db.execute(sql`update embedding_space set space_id = 'reset-space'`);
		assert.equal((await runTask("derive"))?.failure, null);
		assert.equal(await count("skill_term", "word = '业务分析'"), 1);
		const edges = sql`select array_agg(ep.experience_id || ':' || p.text order by ep.experience_id, p.text)::text as all
			from experience_phrase ep join phrase p on p.id = ep.phrase_id where ep.route = 'skill'`;
		const before = (await db.execute<{ all: string }>(edges)).rows[0]?.all;
		assert.ok(before);
		await db.execute(sql`delete from review_question`);
		await db.execute(sql`insert into review_question (kind, words, judge, answer) values (
			'group', '[{"word":"业务分析","people":100},{"word":"数据分析","people":3}]'::jsonb, 'agent:test',
			'{"judgments":[{"word":"业务分析","sameAs":"","parent":""},{"word":"数据分析","sameAs":"业务分析","parent":""}]}'::jsonb)`);
		assert.equal((await runTask("review"))?.failure, null);
		assert.equal(
			await count("skill_term", "word = '数据分析' and canonical = '业务分析'"),
			1,
		);
		// 词表只决定筛选栏怎么摆：人身上仍是简历里的原话
		assert.equal(
			(await db.execute<{ all: string }>(edges)).rows[0]?.all,
			before,
		);
	} finally {
		restore();
		if (previous === undefined) delete process.env.REVIEW_JUDGE;
		else process.env.REVIEW_JUDGE = previous;
	}
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

	test("同一串字只嵌一次，几条边各指向它；没读过的段把整段原文当说法", () => {
		const { texts, links } = phrasePlan([segment({}), outside], [null, null]);
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

	test("空语料不产出说法和边", () => {
		assert.deepEqual(phrasePlan([], []), { texts: [], links: [] });
	});

	test("抽出来的两类和登记的三类共用同一张说法表；读过的段原文不再是说法", () => {
		// 能力词「算法工程师」和第 1 段的岗位名是同一串字：只嵌一次，两条边各成一条边
		const { texts, links } = phrasePlan(
			[segment({}), outside],
			[
				null,
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
		// 自述只有一份读法：读过的段，整段原文不再是说法
		assert.ok(!texts.includes("负责推荐系统召回"));
		assert.ok(!links.some((l) => l.route === "description"));
	});
});

describe("页面文案", () => {
	const corpus = (over: Partial<CorpusCounts> = {}): CorpusCounts => ({
		employees: 8,
		external: 4,
		glossable: 30,
		glossed: 12,
		internal: 6,
		merged: 2,
		pending: 0,
		phrases: 30,
		segments: 10,
		words: 9,
		...over,
	});

	test("解析那张卡片：有活的时候说还剩几条，没活的时候说已经全部解析", () => {
		assert.match(facts.derive(corpus({ pending: 3 })), /还有 3 条经历待解析/);
		assert.match(facts.derive(corpus()), /经历已全部解析/);
	});
	test("同步与整理那两张卡片说的是构成和结果", () => {
		assert.match(
			facts.sync(corpus()),
			/8 人 · 10 条经历（公司内 6、入职前 4）/,
		);
		assert.match(facts.review(corpus()), /技能 9 个，其中 2 个已合并写法/);
	});
});
