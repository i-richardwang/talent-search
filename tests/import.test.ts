/**
 * 一次完整导入：读仓库自带的合成样例 → 切段校验 → 抽取与对齐 → 嵌入 → 原子发布。
 *
 * 这是唯一一处把整条语料链路连起来跑的测试。它值得在这里跑，因为链路上的每一段
 * 单独看都对得上、连起来却可能对不上：暂存表的列顺序、`unnest` 每一列的类型、
 * 发布之后序列有没有跟上、说法和边有没有指对。这些错一旦发生，屏幕上的表现是
 * 「搜什么都搜不到」，而没有任何一个单元测试会红。
 *
 * 端点是进程内那三台假的，所以这里量的是**机制**，不是抽得准不准。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { ExperienceRow } from "#/corpus/pipeline";
import type { ImportOutcome } from "#/server/import";
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { startImport, runImport, importState } = await import("#/server/import");
const { phrasePlan } = await import("#/corpus/load");
const { summary } = await import("#/routes/imports");
const { acquireCorpusSession, importRunning } = await import(
	"#/corpus/session"
);
const { EMPTY } = await import("#/corpus/extract");
const { db } = await import("#/db");
const { importRun } = await import("#/db/schema");
const { sql } = await import("drizzle-orm");

/** 一次导入说过的话，测试里没人看。 */
const quiet = () => {};

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

async function count(table: string): Promise<number> {
	const { rows } = await db.execute<{ n: number }>(
		sql`select count(*)::int as n from ${sql.identifier(table)}`,
	);
	return rows[0]?.n ?? 0;
}

describe("导入", () => {
	let restore = () => {};
	before(() => {
		restore = answers();
	});
	after(() => restore());

	test("已经有一次在跑的时候开不了第二次，而活性问的是锁", async () => {
		const held = await acquireCorpusSession();
		assert.ok(held);
		assert.equal(await importRunning(), true);
		assert.equal(await startImport(), null);
		await held.release();
		// 持锁的连接一断，这件事当场就不成立了——不需要谁来打扫
		assert.equal(await importRunning(), false);
	});

	test("一整轮跑下来，语料换成了样例里那批人", async () => {
		const run = await runImport(quiet);
		assert.ok(run);
		assert.equal(run.failure, null);

		// 样例里是编出来的二十个人
		assert.equal(await count("employee"), 20);
		assert.ok((await count("experience")) > 20);
		assert.ok((await count("phrase")) > 0);
		assert.ok((await count("experience_phrase")) > 0);

		// 发布之后序列要跟上，否则下一次写入立刻撞主键。直接问它下一个发什么号。
		const { rows } = await db.execute<{ ok: boolean }>(sql`
			select nextval(pg_get_serial_sequence('experience', 'id'))
				> (select max(id) from experience) as ok`);
		assert.equal(rows[0]?.ok, true);

		// 抽取的两路确实指回了经历段
		const skills = await db.execute<{ n: number }>(
			sql`select count(*)::int as n from experience_phrase where route = 'skill'`,
		);
		assert.ok((skills.rows[0]?.n ?? 0) > 0);

		// 对齐只写推断的两列，登记的三列不动
		const inferred = await db.execute<{ n: number }>(sql`
			select count(*)::int as n from experience
			where kind = 'external' and seq_inferred_l1 <> '' and seq_l1 = ''`);
		assert.ok((inferred.rows[0]?.n ?? 0) > 0);
	});

	test("那一行记录说得出这次跑了什么", async () => {
		const state = await importState();
		assert.ok(state.latest);
		assert.equal(state.latest.error, null);
		assert.equal(state.latest.source, "csv-dir");
		assert.ok((state.latest.seconds ?? -1) >= 0);
		const log = state.latest.log.join("\n");
		assert.match(log, /人群 20 人/);
		assert.match(log, /employee 20 行/);
	});

	/*
	 * 网页那条路：按钮按下去立刻返回，过程长在那一行上，页面隔一会儿看一眼。
	 * 从「正在跑」到「成功」之间不许有一刻读作「中断」——判据是先看锁、再看行，
	 * 而行是写完了才放锁的；这两条哪一条反了，页面就会在收尾那一瞬停掉轮询。
	 */
	test("网页开的那一次：立刻返回，一路轮询到成功，中间没有一刻像中断", async () => {
		const begun = await startImport();
		assert.ok(begun);

		const seen = new Set<ImportOutcome>();
		let latest = await importState();
		while (
			latest.latest?.id === begun.runId &&
			latest.latest.outcome === "running"
		) {
			seen.add("running");
			await new Promise((resolve) => setTimeout(resolve, 20));
			latest = await importState();
		}
		assert.equal(latest.latest?.id, begun.runId);
		seen.add(latest.latest?.outcome ?? "interrupted");

		assert.ok(seen.has("running"), "至少看到一次正在跑");
		assert.ok(!seen.has("interrupted"), "没有一刻读作中断");
		assert.equal(latest.latest?.outcome, "done");
		assert.equal(await importRunning(), false);
	});

	test("再跑一次是幂等的，人数不变", async () => {
		const run = await runImport(quiet);
		assert.ok(run);
		assert.equal(run.failure, null);
		assert.equal(await count("employee"), 20);
	});

	/*
	 * 进程跑到一半没了，留下一行没有结束时间的记录。它读作「中断」而不是
	 * 「正在跑」——判据是锁，而锁随着那个进程一起没了。读成「正在跑」的话页面上
	 * 那个按钮会一直禁着，而唯一能解开它的正是按一下那个按钮。
	 */
	test("中断的那一行读作中断，不挡住下一次导入", async () => {
		const [stale] = await db
			.insert(importRun)
			.values({ source: "csv-dir", log: ["跑到一半进程没了"] })
			.returning({ id: importRun.id });
		assert.ok(stale);

		const before = await importState();
		assert.equal(before.latest?.id, stale.id);
		assert.equal(before.latest?.outcome, "interrupted");
		assert.equal(before.latest?.seconds, null);

		const run = await runImport(quiet);
		assert.ok(run);
		assert.equal(run.failure, null);

		const after = await importState();
		assert.equal(after.latest?.outcome, "done");
		assert.equal(
			after.history.find((one) => one.id === stale.id)?.outcome,
			"interrupted",
		);
	});

	/*
	 * 失败是这张表存在的理由之一：从网页按下按钮的人看不到服务器的标准输出。
	 * 数据源读不出来时，最外层那句话说的是「哪一步出的事」，真正发生了什么挂在
	 * `cause` 上——两句都得在。
	 */
	test("跑失败时，那一行说得出为什么，连它的来由", async () => {
		const configured = process.env.TALENT_SOURCE;
		process.env.TALENT_SOURCE = "没有这个适配器";
		let failure: string | null = null;
		try {
			const run = await runImport(quiet);
			assert.ok(run);
			failure = run.failure;
		} finally {
			process.env.TALENT_SOURCE = configured;
		}
		assert.match(failure ?? "", /读取数据源 没有这个适配器 失败/);

		const state = await importState();
		assert.equal(state.latest?.outcome, "failed");
		assert.equal(state.latest?.error, failure);
		const log = state.latest?.log.join("\n") ?? "";
		assert.match(log, /✖ 读取数据源/);
		// 来由那一层：模块加载自己报的话，不是我们替它编的
		assert.match(log, /↳/);
	});
});

describe("说法规划", () => {
	const segment = (row: Partial<ExperienceRow>): ExperienceRow => ({
		emp_id: "E1",
		kind: "internal",
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
		assert.deepEqual(links, [
			{ experienceId: 1, route: "seq", phraseId: 1, involvement: null },
			{ experienceId: 1, route: "title", phraseId: 2, involvement: null },
			{ experienceId: 1, route: "org", phraseId: 3, involvement: null },
			{ experienceId: 2, route: "title", phraseId: 2, involvement: null },
			{ experienceId: 2, route: "org", phraseId: 4, involvement: null },
			{ experienceId: 2, route: "description", phraseId: 5, involvement: null },
		]);
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
					l.experienceId === 2 && (l.route === "skill" || l.route === "did"),
			),
			[
				{ experienceId: 2, route: "skill", phraseId: 2, involvement: null },
				{ experienceId: 2, route: "skill", phraseId: 6, involvement: null },
				{ experienceId: 2, route: "did", phraseId: 7, involvement: "负责建设" },
			],
		);
	});
});

describe("页面上那几句话", () => {
	const run = {
		id: 1,
		source: "csv-dir",
		startedAt: "09-08 14:32",
		seconds: null as number | null,
		error: null as string | null,
		outcome: "running" as ImportOutcome,
		log: [] as string[],
	};

	test("一次都没跑过时，抬头说的是导入本身是什么", () => {
		assert.match(summary({ latest: null, history: [] }), /语料由导入建立/);
	});

	test("跑过之后，抬头说最近一次是什么时候、读的哪个源、跑成什么样", () => {
		const said = summary({
			latest: { ...run, seconds: 42, outcome: "done" },
			history: [],
		});
		assert.match(said, /09-08 14:32/);
		assert.match(said, /csv-dir/);
		assert.match(said, /42s/);
	});

	test("四种样子各说各的", () => {
		const said = (outcome: ImportOutcome) =>
			summary({ latest: { ...run, outcome }, history: [] });
		assert.match(said("running"), /正在跑/);
		assert.match(said("interrupted"), /中断/);
		assert.match(said("failed"), /失败/);
	});
});
