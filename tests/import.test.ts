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
import { answerChat, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { startImport, importState } = await import("#/server/import");
const { phrasePlan } = await import("#/corpus/load");
const { runOutcome, summary } = await import("#/routes/imports");
const { acquireCorpusSession } = await import("#/corpus/session");
const { EMPTY } = await import("#/corpus/extract");
const { db } = await import("#/db");
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

	test("已经有一次在跑的时候开不了第二次", async () => {
		const held = await acquireCorpusSession();
		assert.ok(held);
		assert.equal(await startImport(), null);
		await held.release();
	});

	test("一整轮跑下来，语料换成了样例里那批人", async () => {
		const run = await startImport();
		assert.ok(run);
		const failure = await run.finished;
		assert.equal(failure, null);

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

	test("再跑一次是幂等的，人数不变", async () => {
		const run = await startImport();
		assert.ok(run);
		assert.equal(await run.finished, null);
		assert.equal(await count("employee"), 20);
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
	};

	test("三种样子各说各的", () => {
		assert.equal(runOutcome(run), "running");
		assert.equal(runOutcome({ ...run, seconds: 12 }), "done");
		assert.equal(
			runOutcome({ ...run, seconds: 12, error: "端点没了" }),
			"failed",
		);
	});

	test("一次都没跑过时，抬头说的是导入本身是什么", () => {
		assert.match(summary({ latest: null, history: [] }), /语料由导入建立/);
	});

	test("跑过之后，抬头说最近一次是什么时候、读的哪个源、跑成什么样", () => {
		const said = summary({
			latest: { ...run, seconds: 42, log: [] },
			history: [],
		});
		assert.match(said, /09-08 14:32/);
		assert.match(said, /csv-dir/);
		assert.match(said, /42s/);
	});
});
