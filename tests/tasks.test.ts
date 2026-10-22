/**
 * 语料侧三种任务连起来跑：同步读仓库自带的合成样例、解析给段算说法与向量、
 * 任务的记录与活性。
 *
 * 端点是进程内那三台假的，所以这里量的是**机制**，不是抽得准不准。
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, mock, test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { CorpusCounts, TaskOutcome } from "#/server/tasks";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { runTask, tasksState, taskLog, deriveProgress } = await import(
	"#/server/tasks"
);
const { phrasePlan } = await import("#/corpus/derive");
const { SYSTEM: EXTRACT_SYSTEM } = await import("#/corpus/extract");

/** 还没有当前标准结果的段数。 */
async function underived() {
	const { done, total } = await deriveProgress();
	return total - done;
}
const { groupIdentity } = await import("#/corpus/vocabulary");
const { formatDuration, LANE_FACTS } = await import(
	"#/routes/tasks/-lib/labels"
);
const { acquireCorpusSession, corpusSessionOwner } = await import(
	"#/corpus/session"
);
const { db, pool } = await import("#/db");
const { taskRun } = await import("#/db/schema");
const { sql } = await import("drizzle-orm");

/**
 * 三处语料侧调用各自认出自己的提示词。
 *
 * 对齐照抄提示词里列出的第一行序列——那份列表是从这批样例数据生成的，
 * 所以不必在这里再写一遍它有哪些序列。
 */
function answers() {
	return answerChat((system, _prompt) => {
		if (system === EXTRACT_SYSTEM)
			return {
				items: [
					{ text: "数据分析", depth: "做过" },
					{ text: "推荐系统", depth: "主导" },
				],
			};
		if (system.includes("属于哪个序列")) {
			return { seq: /^- (.+)$/m.exec(system)?.[1] ?? "" };
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

/** 这一栏最近的一次运行。翻到第几页都是它，卡片正面说的就是这一次。 */
function latest(state: Awaited<ReturnType<typeof tasksState>>, kind: string) {
	return lane(state, kind).latest;
}

/** 那一次输出的每一行。状态里不带日志，要单取。 */
async function logText(runId: number | undefined): Promise<string> {
	return runId === undefined ? "" : (await taskLog(runId)).join("\n");
}

describe("同步与解析", () => {
	let restore = () => {};
	before(() => {
		restore = answers();
	});
	after(() => restore());

	test("已经有写者的时候后台任务当场放弃，而活性问的是锁", async () => {
		const held = await acquireCorpusSession();
		assert.ok(held);
		assert.notEqual(await corpusSessionOwner(), null);
		assert.equal(await runTask("derive"), null);
		await held.release();
		// 拿到锁的连接一断，这件事当场就不成立了——不需要谁来打扫
		assert.equal(await corpusSessionOwner(), null);
	});

	test("同步只搬原始的一半：人和段进来了，说法一条都没有", async () => {
		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);

		// 样例里是编出来的二十个人
		assert.equal(await count("employee"), 20);
		assert.ok((await count("experience")) > 20);
		assert.equal(await count("phrase"), 0);
		assert.equal(await underived(), await count("experience"));

		const state = await tasksState();
		const sync = latest(state, "sync");
		assert.equal(sync?.outcome, "done");
		assert.equal(sync?.source, "csv-dir");
		assert.match(await logText(sync?.id), /人群 20 人/);
		assert.equal(state.corpus.derived, 0);
	});

	test("解析给每一段算说法、连边、对齐序列，做完一段不剩", async () => {
		const run = await runTask("derive");
		assert.ok(run);
		assert.equal(run.failure, null);

		assert.ok((await count("phrase")) > 0);
		assert.ok((await count("experience_phrase")) > 0);
		// 抽取的能力确实指回了经历段
		assert.ok((await count("experience_phrase", "route = 'skill'")) > 0);
		// 对齐只写推断的两列，登记的三列不动
		assert.ok(
			(await count(
				"experience",
				"kind = 'external' and seq_inferred_l1 <> '' and seq_l1 = ''",
			)) > 0,
		);
		assert.equal(await underived(), 0);
		assert.equal(latest(await tasksState(), "derive")?.outcome, "done");
	});

	test("开放段再次同步会刷新时长并保留身份、说法边与解析版本", async () => {
		const before = await db.execute<{
			id: number;
			content_key: string;
			months: number;
			version: string;
			edges: number;
		}>(sql`
			select id, content_key, months, derived_identity as version,
			(select count(*)::int from experience_phrase ep where ep.experience_id = e.id) as edges
			from experience e where end_date is null and months > 12 order by id limit 1`);
		const original = before.rows[0];
		assert.ok(original);
		await db.execute(
			sql`update experience set months = 1 where id = ${original.id}`,
		);
		const run = await runTask("sync");
		assert.equal(run?.failure, null);
		const after = await db.execute<{
			id: number;
			content_key: string;
			months: number;
			version: string;
			edges: number;
		}>(sql`
			select id, content_key, months, derived_identity as version,
			(select count(*)::int from experience_phrase ep where ep.experience_id = e.id) as edges
			from experience e where id = ${original.id}`);
		assert.deepEqual(after.rows[0], original);
	});

	test("数据页看得到每一段的解析结果", async () => {
		const { listEmployees, employeeData } = await import("#/server/data");
		const list = await listEmployees("", 1);
		assert.equal(list.total, 20);
		assert.equal(list.rows.length, 20);
		// 20 个人装得下一页，所以只有一页，第一个人排第一
		assert.equal(list.pages, 1);
		assert.equal(list.from, 1);
		assert.ok(list.rows.every((row) => row.pending === 0));
		const one = list.rows.find((row) => row.segments > 0);
		assert.ok(one);
		assert.deepEqual(
			(await listEmployees(one.name, 1)).rows.map((row) => row.empId),
			[one.empId],
		);
		await db.execute(
			sql`update employee set name = ${`含%号`} where emp_id = ${one.empId}`,
		);
		assert.deepEqual(
			(await listEmployees("%", 1)).rows.map((row) => row.empId),
			[one.empId],
		);

		const person = await employeeData(one.empId);
		assert.ok(person);
		assert.equal(person.segments.length, one.segments);
		assert.ok(person.segments.every((segment) => segment.derived));
		// 假端点给每一段入职前描述都抽出「做过 · 数据分析」和「主导 · 推荐系统」
		const described = person.segments.find(
			(segment) => segment.kind === "external" && segment.description,
		);
		if (described) {
			assert.deepEqual(described.skills, [
				{ text: "推荐系统", engagement: "主导" },
				{ text: "数据分析", engagement: "做过" },
			]);
		}
		assert.equal(await employeeData("没有这个人"), null);
	});

	test("再同步一次是幂等的：段按内容认，解析结果原样留下", async () => {
		const edges = await count("experience_phrase");
		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.equal(await count("employee"), 20);
		assert.equal(await count("experience_phrase"), edges);
		assert.equal(await underived(), 0);
	});

	/*
	 * 说法只有作为边的终点才有意义。没有边指向的行留着，召回照样把它交给重排判断，
	 * 却一条命中都产生不了。
	 */
	test("没有边指向的说法不留在表里", async () => {
		const orphans = async () =>
			count(
				"phrase",
				"not exists (select 1 from experience_phrase ep where ep.phrase_id = phrase.id)",
			);
		assert.equal(await orphans(), 0);

		// 造一条没有边指向的：换过一次抽取提示词之后，失去所有边的旧说法就是这个样子
		await db.execute(sql`
			insert into phrase (text, embedding)
			values ('没人会指的说法', (select embedding from phrase limit 1))`);
		assert.equal(await orphans(), 1);

		const run = await runTask("sync");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.equal(await orphans(), 0);
	});

	test("一段的内容变了就是新段：旧段连边一起走，新段待解析", async () => {
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
		assert.equal(await underived(), 1);
		assert.match(
			await logText(latest(await tasksState(), "sync")?.id),
			/新增 1 段、离开 1 段/,
		);
	});

	test("抽取答不出的长描述整段当说法，长过 btree 一行也照样写进去", async () => {
		// 一万字节没有重复片段的文字：压缩不下来，超过 btree 一行 2704 字节的上限
		const long = Array.from({ length: 160 }, (_, i) =>
			createHash("sha256").update(String(i)).digest("hex"),
		).join("");
		// 同步会照样例重写这一段，所以直接在库里改，并让它回到待解析
		await db.execute(sql`
			update experience set description = ${long}, derived_identity = null
			where id = (select min(id) from experience where kind = 'external' and not unemployed)`);

		const restoreLong = answerChat((system, prompt) =>
			system === EXTRACT_SYSTEM && prompt.includes(long)
				? {}
				: system.includes("属于哪个序列")
					? { seq: "" }
					: { items: [] },
		);
		try {
			const run = await runTask("derive");
			assert.ok(run);
			assert.equal(run.failure, null);
		} finally {
			restoreLong();
			restore = answers();
		}
		assert.equal(await underived(), 0);
		const { rows } = await db.execute<{ n: number }>(sql`
			select count(*)::int as n from experience_phrase ep
			join phrase p on p.id = ep.phrase_id
			where ep.route = 'description' and p.text = ${long}`);
		assert.equal(rows[0]?.n, 1);
	});

	/*
	 * 任务台那条路：后台开一轮，过程记录在那一行上，页面隔一会儿看一眼。
	 * 从「正在跑」到「成功」之间不能读作「中断」：读取期间保护记录，确认锁在谁手里
	 * 标记的运行 id，结束记录先于释放锁。
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
		assert.equal(await underived(), 0);
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

		const starting = await acquireCorpusSession();
		assert.ok(starting);
		try {
			const states = await Promise.all(
				Array.from({ length: 12 }, () => tasksState()),
			);
			assert.ok(states.every((state) => state.running));
			assert.ok(
				states.every(
					(state) => latest(state, "review")?.outcome === "interrupted",
				),
			);
		} finally {
			await starting.release();
		}

		const run = await runTask("review");
		assert.ok(run);
		assert.equal(run.failure, null);

		const runs = lane(await tasksState(), "review").runs.rows;
		assert.equal(runs[0]?.outcome, "done");
		assert.equal(
			runs.find((one) => one.id === stale.id)?.outcome,
			"interrupted",
		);
	});

	/*
	 * 失败是这张表存在的理由之一：看任务台的人看不到服务器的标准输出。
	 * 数据源读不出来时，最外层那句话说的是「哪一步出的事」，实际发生了什么在
	 * `cause` 里——两句都得在。
	 */
	test("跑失败时，那一行说得出为什么，连它的来由", async () => {
		const configured = process.env.TALENT_SOURCE;
		process.env.TALENT_SOURCE = "/__talent_search_missing__/没有这个适配器.ts";
		let failure: string | null = null;
		try {
			const run = await runTask("sync");
			assert.ok(run);
			failure = run.failure;
		} finally {
			if (configured === undefined) delete process.env.TALENT_SOURCE;
			else process.env.TALENT_SOURCE = configured;
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

	test("向量模型更换：说法整张作废，所有段重新解析，空间记录重写", async () => {
		await db.execute(sql`update embedding_space set space_id = 'old-space'`);
		const run = await runTask("derive");
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.match(
			await logText(latest(await tasksState(), "derive")?.id),
			/向量模型已更换/,
		);
		const { rows } = await db.execute<{ space_id: string }>(
			sql`select space_id from embedding_space`,
		);
		assert.deepEqual(
			rows.map((row) => row.space_id),
			["fake-v1"],
		);
		assert.equal(await underived(), 0);
		assert.ok((await count("experience_phrase")) > 0);
	});
});

test("词表跨嵌入空间保留，生效一条技能边都不动", async () => {
	const previous = process.env.REVIEW_JUDGE;
	process.env.REVIEW_JUDGE = "external";
	const restore = answers();
	try {
		await db.execute(sql`delete from review_group`);
		await db.execute(sql`insert into review_group (kind, guide_identity, words, judge, judgment) values (
			'group', ${groupIdentity()}, '[{"word":"数据分析","people":3}]'::jsonb, 'agent:test',
			'{"judgments":[{"word":"数据分析","sameAs":"","parent":"业务分析"}]}'::jsonb)`);
		assert.equal((await runTask("review"))?.failure, null);
		await db.execute(sql`update embedding_space set space_id = 'reset-space'`);
		assert.equal((await runTask("derive"))?.failure, null);
		assert.equal(await count("term", "word = '业务分析'"), 1);
		const edges = sql`select array_agg(ep.experience_id || ':' || p.text order by ep.experience_id, p.text)::text as all
			from experience_phrase ep join phrase p on p.id = ep.phrase_id where ep.route = 'skill'`;
		const before = (await db.execute<{ all: string }>(edges)).rows[0]?.all;
		assert.ok(before);
		await db.execute(sql`delete from review_group`);
		await db.execute(sql`insert into review_group (kind, guide_identity, words, judge, judgment) values (
			'group', ${groupIdentity()}, '[{"word":"业务分析","people":100},{"word":"数据分析","people":3}]'::jsonb, 'agent:test',
			'{"judgments":[{"word":"业务分析","sameAs":"","parent":""},{"word":"数据分析","sameAs":"业务分析","parent":""}]}'::jsonb)`);
		assert.equal((await runTask("review"))?.failure, null);
		assert.equal(
			await count("term", "word = '数据分析' and canonical = '业务分析'"),
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

/*
 * 运行记录一直往前翻得到底：一栏跑过几百次，「上一次之前那次是不是也失败了」
 * 正是出事时要问的，而那个问题问的是历史，不是最近六次。
 */
test("运行记录一页一页地给，最近那一次不随翻页走", async () => {
	const kind = "sync" as const;
	await db.execute(sql`delete from task_run where kind = 'sync'`);
	await db.insert(taskRun).values(
		Array.from({ length: 8 }, (_, i) => ({
			kind,
			source: "test",
			log: [`第 ${i + 1} 次`],
			finishedAt: new Date(),
		})),
	);

	const first = lane(await tasksState(), kind);
	assert.equal(first.runs.total, 8);
	assert.equal(first.runs.pages, 2);
	assert.equal(first.runs.page, 1);
	assert.equal(first.runs.rows.length, 6);
	assert.equal(first.latest?.id, first.runs.rows[0]?.id);

	const second = lane(await tasksState({ sync: 2 }), kind);
	assert.equal(second.runs.page, 2);
	assert.equal(second.runs.from, 7);
	assert.equal(second.runs.rows.length, 2);
	// 第二页接着第一页往前走，两页不重样，加起来就是全部
	const both = [...first.runs.rows, ...second.runs.rows].map((one) => one.id);
	assert.deepEqual(
		both,
		[...both].sort((a, b) => b - a),
	);
	assert.equal(new Set(both).size, 8);
	// 卡片正面说的还是最近这一次
	assert.equal(second.latest?.id, first.latest?.id);

	// 越界收回最后一页，翻过头不该是一张空表
	const beyond = lane(await tasksState({ sync: 999 }), kind);
	assert.equal(beyond.runs.page, 2);
	assert.equal(beyond.runs.rows.length, 2);
	// 翻一栏，别的两栏停在第一页
	assert.equal(lane(await tasksState({ sync: 2 }), "review").runs.page, 1);
});

describe("说法规划", () => {
	const segment = (row: Partial<Parameters<typeof phrasePlan>[0][number]>) => ({
		id: 1,
		emp_id: "E1",
		kind: "internal" as const,
		unemployed: false,
		start_date: "2020-01-01",
		end_date: null,
		company: "",
		department: "平台技术部",
		department_path: "示例科技/技术中心/平台技术部",
		company_meta: null,
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
		unemployed: false,
		company: "云枢智能",
		department: "",
		department_path: "",
		seq_l1: "",
		seq_l2: "",
		description: "负责推荐系统召回",
	});

	test("公司内一段序列和岗位一句，入职前岗位一条，部门名和公司名不进；没读过的段把整段原文当说法", () => {
		const { texts, links } = phrasePlan([segment({}), outside], [null, null]);
		const role = "技术 · 算法｜算法工程师";
		assert.deepEqual(texts, [role, "算法工程师", "负责推荐系统召回"]);
		assert.deepEqual(
			links.map((l) => [l.experienceId, l.route, l.text]),
			[
				[1, "role", role],
				[7, "title", "算法工程师"],
				[7, "description", "负责推荐系统召回"],
			],
		);
	});

	test("空语料不产出说法和边", () => {
		assert.deepEqual(phrasePlan([], []), { texts: [], links: [] });
	});

	test("抽出来的能力和岗位共用同一张说法表；读过的段原文不再是说法", () => {
		// 能力词「算法工程师」和第 7 段的岗位名是同一串字：只嵌一次，两条边各指向它
		const { texts, links } = phrasePlan(
			[segment({}), outside],
			[
				null,
				{
					items: [
						{ text: "算法工程师", engagement: "做过" },
						{ text: "召回", engagement: null },
						{ text: "推荐系统", engagement: "主导" },
					],
				},
			],
		);
		assert.equal(texts.filter((t) => t === "算法工程师").length, 1);
		// 说法只是词，投入档存在边上
		assert.deepEqual(texts.slice(-2), ["召回", "推荐系统"]);
		assert.deepEqual(
			links.filter((l) => l.experienceId === 7 && l.route === "skill"),
			[
				{
					experienceId: 7,
					route: "skill",
					text: "算法工程师",
					engagement: "做过",
				},
				{ experienceId: 7, route: "skill", text: "召回", engagement: null },
				{
					experienceId: 7,
					route: "skill",
					text: "推荐系统",
					engagement: "主导",
				},
			],
		);
		// 自述每一段只取一种来源：读过的段，整段原文不再是说法
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
		derived: 10,
		merged: 2,
		phrases: 30,
		segments: 10,
		staging: false,
		unanswered: 0,
		words: 9,
		...over,
	});

	/** 一组现状读成一句，方便比对。 */
	const read = ({ progress, counts }: ReturnType<typeof LANE_FACTS.sync>) => {
		const line = counts
			.map((c) => {
				const parts = c.parts
					?.map((part) => `${part.label} ${part.value}`)
					.join(" / ");
				return `${c.value} ${c.label}${parts ? `（${parts}）` : ""}`;
			})
			.join("、");
		return progress
			? `${progress.done} / ${progress.total} ${progress.label}；${line}`
			: line;
	};

	test("解析那一组说经历解析到哪了、有多少说法和几段没能作答", () => {
		assert.equal(
			read(LANE_FACTS.derive(corpus({ derived: 7, unanswered: 1 }))),
			"7 / 10 段经历已解析；30 条说法、1 段 AI 未能作答",
		);
	});
	test("标准更新期间解析那一组说检索还在用上一版", () => {
		assert.equal(
			read(LANE_FACTS.derive(corpus({ derived: 4, staging: true }))),
			"4 / 10 段已按新标准解析，解析完之前检索沿用上一版；30 条说法、0 段 AI 未能作答",
		);
	});
	test("同步说构成，整理说释义写到哪了和词表", () => {
		assert.equal(
			read(LANE_FACTS.sync(corpus())),
			"8 人、10 段经历（公司内 6 / 入职前 4）",
		);
		assert.equal(
			read(LANE_FACTS.review(corpus())),
			"12 / 30 条说法已写释义；9 个标签、2 种写法已归并",
		);
	});
	test("用时一小时以内到秒，以上到分，满一天进位成天", () => {
		assert.equal(formatDuration(0), "0s");
		assert.equal(formatDuration(42), "42s");
		assert.equal(formatDuration(72), "1m 12s");
		assert.equal(formatDuration(3_600 + 23 * 60 + 5), "1h 23m");
		assert.equal(formatDuration(86_400 + 2 * 3_600 + 5 * 60), "1d 2h 5m");
	});
});

/**
 * 销毁连接后锁由服务端随会话退出释放，会话退出不与 `release(true)` 同步：等它走完，
 * 两秒还没放就是没放。
 */
async function lockReleased() {
	for (const started = Date.now(); Date.now() - started < 2_000; ) {
		if ((await corpusSessionOwner()) === null) return true;
		await sleep(20);
	}
	return false;
}

/** 写者连接在锁请求或收尾失败时销毁，未知的会话状态不进入连接池。 */
for (const wait of [false, true]) {
	test(`锁请求结果未知时销毁连接（wait=${wait}）`, async () => {
		const client = await pool.connect();
		const query = client.query.bind(client);
		const failure = new Error("合成锁响应失败");
		const release = mock.method(client, "release");
		const connect = mock.method(pool, "connect", async () => client);
		const broken = mock.method(client, "query", async (text: string) => {
			await query(text);
			throw failure;
		});
		try {
			await assert.rejects(
				acquireCorpusSession(wait),
				(error) => error === failure,
			);
		} finally {
			connect.mock.restore();
			broken.mock.restore();
			release.mock.restore();
		}
		const returned = await pool.connect();
		try {
			assert.equal(release.mock.calls.length, 1);
			assert.equal(release.mock.calls[0]?.arguments[0], true);
			assert.notEqual(returned, client);
			assert.ok(await lockReleased());
		} finally {
			await returned.query("select pg_advisory_unlock_all()");
			returned.release();
		}
	});
}

test("收尾失败时销毁拿到锁的连接", async () => {
	const held = await acquireCorpusSession();
	assert.ok(held);
	const release = mock.method(held.client, "release");
	const broken = mock.method(held.client, "query", async () => {
		throw new Error("合成收尾失败");
	});
	try {
		await held.release();
		assert.equal(release.mock.calls[0]?.arguments[0], true);
	} finally {
		broken.mock.restore();
		release.mock.restore();
	}
	const returned = await pool.connect();
	try {
		assert.notEqual(returned, held.client);
		assert.ok(await lockReleased());
	} finally {
		returned.release();
	}
});

test("停在事务里的写者连接不还回池里", async () => {
	const held = await acquireCorpusSession();
	assert.ok(held);
	await held.client.query("begin");
	const release = mock.method(held.client, "release");
	try {
		await held.release();
		assert.equal(release.mock.calls[0]?.arguments[0], true);
	} finally {
		release.mock.restore();
	}
	const returned = await pool.connect();
	try {
		assert.notEqual(returned, held.client);
		assert.equal(returned.getTransactionStatus(), "I");
		assert.ok(await lockReleased());
	} finally {
		returned.release();
	}
});
