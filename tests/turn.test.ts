/**
 * 查询记录怎么长出来。跑在临时 schema 上的真 SQL，理解走夹具里的假模型端点
 * （按一行查询语法读那句话、经历词带上判据、放在当前条件后面，提交前把候选人的经历读完，
 * 见 `fixture.ts` 的 `fakeIntent`）。提交时服务端不等理解就返回；这里等它跑完（`settle`）再看
 * 记录。除了「理解时把候选人的经历看完」那一组，人才库是空的。
 *
 * 一条链是一次找人任务，新轮次有两种：**补充需求**（一句话作用在正看着的条件上）
 * 和**改条件**（直接交一整张表）。两者都记在同一条链的最后——「最近搜索」一次
 * 找人任务只占一行、线程从头读到尾、后退键能回到上一步，靠的都是链是一条线。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { type QueryCondition, withOff } from "#/search/query";
import { parseQuery } from "#/search/query-syntax";
import { queryOfSpec, type SearchSpec } from "#/search/spec";
import { lately, sleeper } from "./conditions";
import {
	answering,
	answeringScores,
	bracesAfterSubmit,
	breakUnderstanding,
	drafted,
	OWNER,
	seed,
	setup,
	violates,
} from "./fixture";

const teardown = await setup();
after(teardown);

const {
	createTurn,
	deleteSearch,
	listRecent,
	loadThread,
	processTurn,
	loadAttempt,
	restartTurn,
} = await import("#/server/turn");
const { search } = await import("#/search/search");
const { db, pool } = await import("#/db");
const { searchTurn } = await import("#/db/schema");
const { eq, sql } = await import("drizzle-orm");

/** 从生产接口返回的完整线程中取得断言所需的一轮。 */
async function loadTurn(id: string) {
	return (await loadThread(OWNER, id))?.find((turn) => turn.id === id) ?? null;
}

/** 这一轮现在这一次理解的编号。 */
async function attemptOf(turnId: string) {
	const [row] = await db
		.select({ attempt: searchTurn.attempt })
		.from(searchTurn)
		.where(eq(searchTurn.id, turnId));
	assert.ok(row?.attempt, "说了一句话的一轮带着这一次理解的编号");
	return row.attempt;
}

/** 跑完这一轮现在这一次理解，和提交后服务端做的一样；没写下条件就抛出失败原因。 */
async function settle(turnId: string) {
	await processTurn(turnId, await attemptOf(turnId));
	const spec = (await loadTurn(turnId))?.spec;
	if (!spec) throw new Error((await loadAttempt(OWNER, turnId))?.fault ?? "");
	return spec;
}

/** 人点了重试：换一次理解，跑完。 */
async function retried(turnId: string) {
	assert.ok(await restartTurn(OWNER, turnId), "上一次失败了，可以重试");
	return settle(turnId);
}

/** 最近搜索的第一页，取得够多，这个文件建的链都在里面。 */
const recent = async () => (await listRecent(OWNER, 50)).rows;

/** 每条条件的标签：一个经历词编出来的条件，标签就是那个词。 */
const wordsOf = (spec: SearchSpec) =>
	queryOfSpec(spec).conditions.map((c) => c.label);

/** 一份条件按内容比：服务端给新写的条件发的 id 每次不同。 */
const contentOf = (list: readonly QueryCondition[]) =>
	list.map(({ id: _id, ...rest }) => rest);
const shapeOf = (spec: SearchSpec) => contentOf(queryOfSpec(spec).conditions);
/** 对话记录里的条件：假模型按这行语法写下的内容（`drafted`），`~` 是用户后来停用的。 */
const expected = (syntax: string) => {
	const asked = parseQuery(syntax);
	return drafted(syntax).map((c, i) =>
		asked[i]?.off ? { ...c, off: "user" } : c,
	);
};

async function sentence(text: string, from?: string) {
	const { turnId } = await createTurn(OWNER, { kind: "sentence", text }, from);
	const spec = await settle(turnId);
	return { turnId, spec, words: wordsOf(spec) };
}

/**
 * 一次对话任务，停在这份条件上：先说一句，再在 chip 上改成它（比如停用一条）。
 * 停用只能是用户在 chip 上做的事，模型写不出来。
 */
async function talkedTo(query: string) {
	const root = await sentence(query.replaceAll("~", ""));
	const asked = parseQuery(query);
	const conditions = queryOfSpec(root.spec).conditions.map((c, i) =>
		withOff(c, asked[i]?.off ? "user" : null),
	);
	const { turnId } = await createTurn(
		OWNER,
		{ kind: "spec", spec: { query: { conditions } } },
		root.turnId,
	);
	return turnId;
}

describe("补充需求", () => {
	test("追加等待链尾补全后保留已完成的一轮，不按等待前的状态删除", async () => {
		const root = await sentence("算法");
		const pending = await createTurn(
			OWNER,
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		const completed = { conditions: parseQuery("算法, 渠道运营") };
		const writer = await pool.connect();
		let appended: ReturnType<typeof createTurn> | undefined;
		try {
			await writer.query("begin");
			await writer.query(
				"update search_turn set spec = $2, attempt_done = true where id = $1",
				[pending.turnId, JSON.stringify(completed)],
			);
			const { rows: owners } = await writer.query<{ pid: number }>(
				"select pg_backend_pid() as pid",
			);
			appended = createTurn(
				OWNER,
				{ kind: "spec", spec: root.spec },
				root.turnId,
			);
			const deadline = Date.now() + 3000;
			let blocked = false;
			while (Date.now() < deadline) {
				const { rows } = await writer.query<{ blocked: boolean }>(
					"select exists (select 1 from pg_stat_activity where $1 = any(pg_blocking_pids(pid))) as blocked",
					[owners[0]?.pid],
				);
				if (rows[0]?.blocked) {
					blocked = true;
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 5));
			}
			assert.ok(blocked, "追加已经等待补全事务的行锁");
			await writer.query("commit");
			const next = await appended;
			const thread = await loadThread(OWNER, next.turnId);
			assert.deepEqual(
				thread?.map((turn) => turn.id),
				[root.turnId, pending.turnId, next.turnId],
			);
			assert.deepEqual(thread?.[1]?.spec, completed);
		} finally {
			await writer.query("rollback");
			writer.release();
			await appended;
		}
	});
	test("最近搜索一次任务一行，指向链上最后一轮：待理解的末轮带着处理中的状态和上一轮的条件，同刻记录不改变链序", async () => {
		const first = { conditions: parseQuery("算法") };
		const last = { conditions: parseQuery("算法, 渠道运营") };
		await db.execute(sql`insert into search_turn
			(owner_id, id, root_turn_id, parent_turn_id, raw_text, spec, created_at,
				attempt, attempt_started_at, trace, attempt_done) values
			(${OWNER}, 'recent-Z', 'recent-Z', null, '合成同刻任务', ${JSON.stringify(first)}::jsonb,
				'2020-01-01', 'a-Z', '2020-01-01', '[]', true),
			(${OWNER}, 'recent-Y', 'recent-Z', 'recent-Z', null, ${JSON.stringify(first)}::jsonb,
				'2020-01-01', null, null, null, false),
			(${OWNER}, 'recent-A', 'recent-Z', 'recent-Y', '再加渠道运营', null,
				'2020-01-01', 'a-A', '2020-01-01', '[]', false)`);
		const inChain = async () =>
			(await recent()).find((row) => row.title === "合成同刻任务");
		assert.equal((await inChain())?.turnId, "recent-A");
		assert.deepEqual((await inChain())?.spec, first);
		// 开始的时刻是很久以前、之后再没有下文：这一次处理的进程没了
		assert.equal((await inChain())?.status, "failed");
		await db.execute(sql`update search_turn
			set spec = ${JSON.stringify(last)}::jsonb, attempt_done = true
			where id = 'recent-A' and spec is null`);
		assert.equal((await inChain())?.turnId, "recent-A");
		assert.deepEqual((await inChain())?.spec, last);
		assert.equal((await inChain())?.status, null);
	});

	test("第一句话一提交就在最近搜索里：还没理解出来时没有条件、状态是处理中，理解完带上条件", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "合成新任务",
		});
		const row = async () => (await recent()).find((r) => r.turnId === turnId);
		assert.deepEqual(
			[(await row())?.title, (await row())?.spec, (await row())?.status],
			["合成新任务", null, "working"],
		);
		await settle(turnId);
		assert.equal((await row())?.status, null);
		assert.ok((await row())?.spec);
	});

	test("一句话作用在上一轮的条件上，链上仍是同一次找人任务", async () => {
		const root = await sentence("算法");
		const child = await sentence("渠道运营", root.turnId);
		assert.deepEqual(child.words, ["算法", "渠道运营"]);
		const thread = await loadThread(OWNER, child.turnId);
		assert.deepEqual(
			thread?.map((t) => t.id),
			[root.turnId, child.turnId],
			"补充需求不开新链：线程是整条链，链头在前",
		);
		assert.deepEqual(
			thread?.[0]?.spec,
			root.spec,
			"上一轮的条件就是这一轮的基线",
		);
	});

	test("理解随这一轮写下开始：步骤和开始的时刻记在记录上，写入后能读回", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		const started = await loadAttempt(OWNER, turnId);
		assert.deepEqual(
			{ ...started, startedAt: typeof started?.startedAt },
			{
				trace: [],
				startedAt: "number",
				fault: null,
				settled: false,
			},
		);
		await settle(turnId);
		// 人才库是空的，假模型去取经历没有可读的：记下一步空的读和没通过的提交；别的步在 agent-tools.test.ts 里
		const done = await loadAttempt(OWNER, turnId);
		assert.deepEqual(
			done?.trace.map((step) => step.tool),
			["read", "submit"],
			JSON.stringify(done?.trace),
		);
		assert.equal(done?.settled, true);
		assert.equal(done?.startedAt, started?.startedAt);
		const turn = await loadTurn(turnId);
		assert.deepEqual(turn?.trace, done?.trace);
		assert.equal(turn?.startedAt, done?.startedAt);
		assert.equal(await loadAttempt(OWNER, "nope"), null);
	});

	test("从哪一轮取线程都是整条链；不存在的记录没有线程", async () => {
		const root = await sentence("算法");
		const next = await sentence("渠道运营", root.turnId);
		for (const id of [root.turnId, next.turnId])
			assert.deepEqual(
				(await loadThread(OWNER, id))?.map((t) => t.id),
				[root.turnId, next.turnId],
			);
		assert.equal(await loadThread(OWNER, "nope"), null);
	});

	test("在早先一轮上补充一句：先记一轮恢复那时的条件，话接在最后", async () => {
		const root = await sentence("算法");
		const later = await sentence("渠道运营", root.turnId);
		const { turnId } = await createTurn(
			OWNER,
			{ kind: "sentence", text: "带团队" },
			root.turnId,
		);
		const thread = (await loadThread(OWNER, turnId)) ?? [];
		assert.deepEqual(
			thread.slice(0, 2).map((t) => t.id),
			[root.turnId, later.turnId],
			"后面那一轮还在，没有分出去",
		);
		const [restored, said] = thread.slice(2);
		assert.equal(restored?.said, null, "恢复是一次直接改条件");
		assert.deepEqual(restored?.spec, root.spec);
		assert.equal(said?.id, turnId);
		assert.deepEqual(wordsOf(await settle(turnId)), ["算法", "带团队"]);
	});

	test("同时追加两轮：排队继续，链仍是一条线", async () => {
		const root = await sentence("算法");
		const spec = (q: string) => ({
			kind: "spec" as const,
			spec: { conditions: parseQuery(q) },
		});
		const [a, b] = await Promise.all([
			createTurn(OWNER, spec("+算法"), root.turnId),
			createTurn(OWNER, spec("算法, 后端"), root.turnId),
		]);
		const ids = (await loadThread(OWNER, root.turnId))?.map((t) => t.id);
		assert.equal(ids?.length, 3);
		assert.deepEqual(new Set(ids?.slice(1)), new Set([a.turnId, b.turnId]));
	});

	test("在早先一轮上直接改条件：整张表接在最后，不另记恢复", async () => {
		const root = await sentence("算法");
		const later = await sentence("渠道运营", root.turnId);
		const { turnId } = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("+算法") } },
			root.turnId,
		);
		assert.deepEqual(
			(await loadThread(OWNER, turnId))?.map((t) => t.id),
			[root.turnId, later.turnId, turnId],
		);
	});

	test("模型拿到的是上一轮的整张表，停用的也在里面", async () => {
		const at = await talkedTo("~算法, 渠道运营");
		let seen: QueryCondition[] = [];
		await answering(
			(_text, base) => {
				seen = base as QueryCondition[];
				return { conditions: base, note: null };
			},
			async () => {
				const { turnId } = await createTurn(
					OWNER,
					{ kind: "sentence", text: "就这样" },
					at,
				);
				await settle(turnId);
			},
		);
		// 发给模型的表不带停用：停用只是用户在 chip 上的开关，模型照抄 id 就会原样带回
		assert.deepEqual(contentOf(seen), expected("算法, 渠道运营"));
	});

	test("用户停掉的条件不会因为又说了一句话就复活", async () => {
		const child = await sentence("渠道运营", await talkedTo("~算法"));
		assert.deepEqual(shapeOf(child.spec), expected("~算法, 渠道运营"));
	});

	test("模型按这句话重写了整张表：新表就是新表", async () => {
		const root = await sentence("算法");
		const spec = await answering(
			() => ({ conditions: drafted("产品经理"), note: null }),
			async () => {
				const { turnId } = await createTurn(
					OWNER,
					{ kind: "sentence", text: "换成找产品经理" },
					root.turnId,
				);
				return settle(turnId);
			},
		);
		assert.deepEqual(shapeOf(spec), expected("产品经理"));
	});

	test("没理解出来的最后一轮被下一句取代，不留在链上", async () => {
		const root = await sentence("算法");
		const stuck = await createTurn(
			OWNER,
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		const { turnId } = await createTurn(
			OWNER,
			{ kind: "sentence", text: "带团队" },
			stuck.turnId,
		);
		assert.equal(await loadTurn(stuck.turnId), null);
		assert.deepEqual(
			(await loadThread(OWNER, turnId))?.map((t) => t.id),
			[root.turnId, turnId],
		);
		assert.deepEqual(wordsOf(await settle(turnId)), ["算法", "带团队"]);
	});

	test("链头就没理解出来：下一句成了新的链头", async () => {
		const stuck = await createTurn(OWNER, { kind: "sentence", text: "算法" });
		const { turnId } = await createTurn(
			OWNER,
			{ kind: "sentence", text: "渠道运营" },
			stuck.turnId,
		);
		assert.equal(await loadTurn(stuck.turnId), null);
		const turn = await loadTurn(turnId);
		assert.equal(turn?.title, "渠道运营");
		assert.deepEqual(
			(await loadThread(OWNER, turnId))?.map((t) => t.id),
			[turnId],
		);
	});

	test("还没有条件时不能直接改条件", async () => {
		const stuck = await createTurn(OWNER, { kind: "sentence", text: "算法" });
		await assert.rejects(
			createTurn(
				OWNER,
				{ kind: "spec", spec: { conditions: parseQuery("算法") } },
				stuck.turnId,
			),
			/还没有可以修改的搜索条件/,
		);
	});
});

describe("说明", () => {
	test("那句话和可选的回答跟着这一轮写入；回答只是一句话，不带条件", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "北京的算法，有潜力",
		});
		await answering(
			() => ({
				conditions: drafted("算法"),
				note: {
					says: "人才库里没有工作地点，也看不出潜力，要不要先看带过团队的？",
					current: "先不管这两条",
					options: [
						{
							label: "带过团队的优先",
							detail: "写过带团队的有两百多位",
						},
						{ label: "先不管这两条", detail: "和现在一样" },
					],
				},
			}),
			() => settle(turnId),
		);
		assert.deepEqual((await loadTurn(turnId))?.notes, {
			says: "人才库里没有工作地点，也看不出潜力，要不要先看带过团队的？",
			choices: {
				current: "先不管这两条",
				others: [{ label: "带过团队的优先", detail: "写过带团队的有两百多位" }],
			},
		});
	});

	test("选一句回答就是把它当下一句话说：记成新的一轮，再理解一遍", async () => {
		const asked = await answering(
			() => ({
				conditions: drafted("算法"),
				note: {
					says: "要不要先看带过团队的？",
					current: "先不管",
					options: [{ label: "带团队", detail: "" }],
				},
			}),
			() => sentence("算法，有潜力"),
		);
		const [answer] =
			(await loadTurn(asked.turnId))?.notes?.choices?.others ?? [];
		assert.ok(answer);
		const next = await sentence(answer.label, asked.turnId);
		assert.deepEqual(next.words, ["算法", "带团队"]);
		const thread = await loadThread(OWNER, next.turnId);
		assert.deepEqual(
			thread?.map((t) => [t.id, t.said]),
			[
				[asked.turnId, "算法，有潜力"],
				[next.turnId, "带团队"],
			],
		);
		assert.equal(thread?.[1]?.notes, null, "上一轮的问话不带到下一轮");
	});

	test("一条都搜不了的话是一个合法的结果：条件为空，那句话在", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "北京的",
		});
		const spec = await answering(
			() => ({
				conditions: [],
				note: { says: "人才库里没有工作地点", current: null, options: [] },
			}),
			() => settle(turnId),
		);
		assert.deepEqual(shapeOf(spec), []);
		assert.equal((await loadTurn(turnId))?.notes?.says, "人才库里没有工作地点");
	});

	test("没有可说明的就不落说明", async () => {
		const { turnId } = await sentence("算法");
		assert.equal((await loadTurn(turnId))?.notes, null);
	});
});

describe("直接改条件", () => {
	test("这一轮没有说话；任务标题仍是链头那句", async () => {
		const root = await sentence("算法");
		const tuned = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("+算法") } },
			root.turnId,
		);
		const row = await loadTurn(tuned.turnId);
		assert.equal(row?.said, null);
		assert.equal(row?.title, "算法");
	});
});

describe("任务标题", () => {
	test("最近搜索里一次任务只占一行，停在最后的样子，标题是链头那句", async () => {
		const before = await recent();
		const root = await sentence("产品经理");
		const next = await sentence("渠道运营", root.turnId);

		const rows = (await recent()).filter(
			(r) => !before.some((b) => b.turnId === r.turnId),
		);
		assert.equal(rows.length, 1, "一次找人任务只占一行");
		assert.equal(rows[0]?.turnId, next.turnId, "停在最后的样子上");
		assert.equal(rows[0]?.title, "产品经理");
	});

	test("最近搜索按游标读取，删除或新增记录不会使后续记录错位", async () => {
		const first = await sentence("数据分析");
		const second = await sentence("用户研究");
		const page = await listRecent(OWNER, 1);
		assert.equal(page.rows[0]?.turnId, second.turnId);
		assert.ok(page.next);
		await deleteSearch(OWNER, second.turnId);
		const inserted = await sentence("合成新需求");
		const next = await listRecent(OWNER, 1, page.next);
		assert.equal(next.rows[0]?.turnId, first.turnId);
		assert.ok(!next.rows.some((row) => row.turnId === inserted.turnId));
		assert.ok((next.rows[0]?.ageSeconds ?? -1) >= 0);
		await assert.rejects(listRecent(OWNER, 1, "invalid"), /游标无效/);
	});

	test("关键词搜索没有标题", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		const [row] = (await recent()).filter((r) => r.turnId === turnId);
		assert.equal(row?.title, null);
	});
});

describe("两种搜索各走各的链", () => {
	test("AI 搜索直接清空条件时拒绝追加，原条件仍可修改", async () => {
		const root = await sentence("算法");
		for (const spec of [{ query: { conditions: [] } }, { conditions: [] }]) {
			await assert.rejects(
				createTurn(OWNER, { kind: "spec", spec }, root.turnId),
				/至少保留一条搜索条件/,
			);
		}
		const next = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("+算法") } },
			root.turnId,
		);
		const thread = await loadThread(OWNER, next.turnId);
		assert.deepEqual(
			thread?.map((turn) => turn.id),
			[root.turnId, next.turnId],
		);
		assert.deepEqual(thread?.[0]?.spec, root.spec);
	});

	test("关键词清空后仍在同一条链上，可继续填写", async () => {
		const root = await createTurn(OWNER, {
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		const empty = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: [] } },
			root.turnId,
		);
		const next = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("运营") } },
			empty.turnId,
		);
		const thread = await loadThread(OWNER, next.turnId);
		assert.deepEqual(
			thread?.map((turn) => turn.id),
			[root.turnId, empty.turnId, next.turnId],
		);
		assert.deepEqual(thread?.[0]?.spec, { conditions: parseQuery("算法") });
		assert.deepEqual(thread?.[1]?.spec, { conditions: [] });
		assert.equal(thread?.[2]?.mode, "keyword");
	});

	test("链头定下种类：有原话是对话，直接是条件是关键词，整条链不变", async () => {
		const talk = await sentence("算法");
		const tuned = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("+算法") } },
			talk.turnId,
		);
		assert.equal((await loadTurn(tuned.turnId))?.mode, "conversation");

		const typed = await createTurn(OWNER, {
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		const next = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("算法, 渠道运营") } },
			typed.turnId,
		);
		assert.equal((await loadTurn(next.turnId))?.mode, "keyword");
	});

	test("关键词搜索不收一句话的需求", async () => {
		const typed = await createTurn(OWNER, {
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		await assert.rejects(
			createTurn(OWNER, { kind: "sentence", text: "渠道运营" }, typed.turnId),
			/关键词搜索不收一句话/,
		);
	});

	test("关键词搜索只收框里写得出的条件表", async () => {
		// 加分、停用都不是框能写出来的：落了库，结果页就填不回框里
		await assert.rejects(
			createTurn(OWNER, {
				kind: "spec",
				spec: { conditions: parseQuery("+算法") },
			}),
			/关键词框里写得出/,
		);
		const typed = await createTurn(OWNER, {
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		await assert.rejects(
			createTurn(
				OWNER,
				{ kind: "spec", spec: { conditions: parseQuery("~算法") } },
				typed.turnId,
			),
			/关键词框里写得出/,
		);
	});
});

describe("理解失败", () => {
	/**
	 * 模型调用失败时记录必须停在「待理解」：spec 仍是 null，记下是哪个环节出了问题，
	 * 人点重试再跑一遍。写入一份空 spec 的话，这条 `/s/:id` 就永久变成「没有条件」，
	 * 而故障在屏幕上和「没有这样的人」长得一模一样。
	 */
	test("模型报错时不写入，记下原因；重试换一次理解，能成立", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		const restore = breakUnderstanding();
		try {
			await assert.rejects(settle(turnId), /rejected/);
		} finally {
			restore();
		}
		const failed = await loadTurn(turnId);
		assert.equal(failed?.spec, null);
		assert.equal(failed?.fault, "rejected", "刷新页面读到的是同一个失败");

		await new Promise((resolve) => setTimeout(resolve, 5));
		const spec = await retried(turnId);
		assert.deepEqual(wordsOf(spec), ["算法"]);
		assert.ok(
			((await loadTurn(turnId))?.startedAt ?? 0) > (failed?.startedAt ?? 0),
			"重试从这一次开始的时刻重新计时，不接着失败的那一次",
		);
	});

	/**
	 * 模型答得合法却没按约定作答——给了条件，形状却全不合规——校验之后
	 * 一个不剩。这一份空条件走下去，界面画的是「一个条件都没解析出来」，
	 * 也就是把一次故障画成了「你没说条件」。它和端点报错走同一条路。
	 */
	test("模型交的提交在对象后面多了右括号：取那个对象照常检查、写入", async () => {
		const restore = bracesAfterSubmit();
		try {
			const { spec } = await sentence("算法");
			assert.deepEqual(shapeOf(spec), expected("算法"));
		} finally {
			restore();
		}
	});

	test("模型给了条件、校验后一个不剩：也是失败，不写入", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		await assert.rejects(
			answering(
				() => ({
					conditions: [
						{ label: "资深", mode: "exclude", from: "person", where: "true" },
					],
					note: null,
				}),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);

		assert.deepEqual(wordsOf(await retried(turnId)), ["算法"]);
	});

	test("条件和说明都空着：没作答，不写入", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		await assert.rejects(
			answering(
				() => ({ conditions: [], note: null }),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
	});

	test("一部分条件无效也不发布剩余条件，不能静默放宽要求", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		await assert.rejects(
			answering(
				() => ({
					conditions: [
						{ label: "资深", mode: "exclude", from: "person", where: "true" },
						{ label: " ", mode: "must", from: "experience", where: "true" },
						...drafted("算法"),
					],
					note: null,
				}),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
	});
});

describe("写进记录的是提交检查录取的那份", () => {
	test("次数用完仍有跑不了的条件：条件和说明都不发布", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		await assert.rejects(
			answering(
				() => ({
					conditions: [...drafted("算法"), sleeper],
					note: {
						says: "要不要只看带过团队的？",
						current: "不限",
						options: [{ label: "只看带过团队的", detail: "" }],
					},
				}),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
		assert.equal((await loadTurn(turnId))?.notes, null);
	});

	test("执行才报错也不能发布，没通过的提交仍记在步骤里", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		await assert.rejects(
			answering(
				() => ({ conditions: [...drafted("算法"), lately], note: null }),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
		const trace = (await loadTurn(turnId))?.trace ?? [];
		const submits = trace.filter((step) => step.tool === "submit");
		assert.ok(submits.length > 0);
		for (const step of submits)
			assert.deepEqual(
				step.issues,
				// 人才库是空的：除了跑不了的那条，「算法」也一个人都找不到，只在头一次提
				submits.indexOf(step) === 0
					? [
							{ kind: "unrunnable", subject: "最近有过绩效" },
							{ kind: "unfound", subject: "算法" },
						]
					: [{ kind: "unrunnable", subject: "最近有过绩效" }],
			);
	});

	test("AI 新条件缺判据不能退化成字面搜索，即使最后一次也不发布", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "本人做过算法研发",
		});
		await assert.rejects(
			answering(
				() => ({
					conditions: [
						{
							label: "本人做过算法研发",
							mode: "must",
							from: "experience",
							where: "true",
							seek: { patterns: ["算法"], criterion: "" },
						},
					],
					note: null,
				}),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
	});

	test("条件全都跑不了：按没作答失败，不写入", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		await assert.rejects(
			answering(
				() => ({ conditions: [sleeper], note: null }),
				() => settle(turnId),
			),
			/unanswered/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
	});
});

describe("理解时把候选人的经历看完", () => {
	/** 假模型读经历的规矩见 `fixture.ts` 的 `fakeFits`：按判据里列的词在经历的文字里找。 */
	const appraising = {
		label: "做过鉴宝",
		mode: "must",
		from: "experience",
		seek: {
			criterion: "符合：鉴定师、直播；不算：销售",
			patterns: ["鉴宝"],
		},
		where: "true",
	};

	const live = {
		label: "做过直播",
		mode: "must",
		from: "experience",
		seek: { criterion: "符合：直播", patterns: ["直播"] },
		where: "true",
	};

	before(async () => {
		await seed(
			["鉴宝鉴定师", "鉴宝直播运营", "鉴宝销售"].map((title, i) => ({
				empId: `JB0${i + 1}`,
				name: `合成鉴宝${i + 1}`,
				segments: [{ months: 24, title }],
			})),
		);
	});

	test("模型取经历来读、交上结论再提交：步骤记下读了几段、几段符合，名单听这些结论，候选人都确认过", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "鉴宝的",
		});
		const spec = await answering(
			() => ({ conditions: [appraising], note: null }),
			() => settle(turnId),
		);
		assert.deepEqual(wordsOf(spec), ["做过鉴宝"]);
		assert.deepEqual(
			(await loadTurn(turnId))?.trace?.map(({ at: _at, ...step }) => step),
			[
				{ tool: "read", segments: 3, left: 3 },
				{ tool: "judge", fits: 2, unfit: 1 },
				{ tool: "score", segments: 2 },
			],
			"看完再交，提交一次就过，不记没通过的提交",
		);
		const outcome = await search(spec, turnId);
		assert.deepEqual(
			outcome.results.map((r) => r.employee.empId).sort(),
			["JB01", "JB02"],
			"判成不算的那一位不在名单上",
		);
		assert.equal(outcome.incomplete, undefined);
		assert.equal((await loadTurn(turnId))?.settled, true);
	});

	test("评分故障仍发布已确认名单；下一轮只补肯定结论的分数，否决保持无分", async () => {
		const { turnId, spec } = await answeringScores(
			() => ({ scores: [] }),
			() =>
				answering(
					() => ({ conditions: [appraising], note: null }),
					() => sentence("鉴宝"),
				),
		);
		const state = async () =>
			(
				await pool.query(
					"select fits, match_score from experience_verdict where root_turn_id = $1 order by fits, match_score",
					[turnId],
				)
			).rows;
		assert.deepEqual(await state(), [
			{ fits: false, match_score: null },
			{ fits: true, match_score: null },
			{ fits: true, match_score: null },
		]);
		assert.deepEqual(
			(await search(spec, turnId)).results.map((r) => r.employee.empId),
			["JB01", "JB02"],
		);
		assert.equal((await loadTurn(turnId))?.trace?.at(-1)?.tool, "score");
		let scored: string[] = [];
		const next = await answeringScores(
			(segments) => {
				scored = segments.map((s) => s.text);
				return {
					scores: segments.map(({ n, text }) => ({
						n,
						score: text.includes("直播") ? 84 : 83,
					})),
				};
			},
			() =>
				answering(
					(_said, base) => ({ conditions: base, note: null }),
					() => sentence("接着找", turnId),
				),
		);
		assert.equal(scored.length, 2);
		assert.ok(scored.every((s) => !s.includes("销售")));
		assert.ok(
			!(await loadTurn(next.turnId))?.trace?.some(
				(step) => step.tool === "judge",
			),
		);
		assert.deepEqual(await state(), [
			{ fits: false, match_score: null },
			{ fits: true, match_score: 83 },
			{ fits: true, match_score: 84 },
		]);
		assert.deepEqual(
			(await search(next.spec, turnId)).results.map((r) => r.employee.empId),
			["JB02", "JB01"],
		);
		for (const invalid of [0, 101]) {
			await assert.rejects(
				db.execute(
					sql`update experience_verdict set match_score = ${invalid} where root_turn_id = ${turnId} and fits`,
				),
				violates("experience_verdict_positive_score"),
			);
		}
		await assert.rejects(
			db.execute(sql`update experience_verdict set match_score = 1, score_text_key = 'test'
			where root_turn_id = ${turnId} and not fits`),
			violates("experience_verdict_positive_score"),
		);
	});

	test("某一批评分失败时保留已完成的分数，下一轮只读缺分批次", async () => {
		let calls = 0;
		const root = await answeringScores(
			(segments) => ({
				scores:
					++calls === 1 ? segments.map(({ n }) => ({ n, score: 67 })) : [],
			}),
			() =>
				answering(
					() => ({ conditions: [appraising, live], note: null }),
					() => sentence("做过鉴宝和直播"),
				),
		);
		const scores = async () =>
			(
				await pool.query<{ match_score: number }>(
					"select match_score from experience_verdict where root_turn_id = $1 and match_score is not null order by match_score",
					[root.turnId],
				)
			).rows.map((r) => r.match_score);
		assert.deepEqual(await scores(), [67]);
		assert.deepEqual(
			(await search(root.spec, root.turnId)).results.map(
				(r) => r.employee.empId,
			),
			["JB02"],
		);
		calls = 0;
		await answeringScores(
			(segments) => {
				calls++;
				return { scores: segments.map(({ n }) => ({ n, score: 90 })) };
			},
			() =>
				answering(
					(_text, base) => ({ conditions: base, note: null }),
					() => sentence("继续", root.turnId),
				),
		);
		assert.equal(calls, 1);
		assert.deepEqual(await scores(), [67, 90]);
	});

	test("交上来的判据和读的时候不一样：照收，这一轮按交上来的那份把候选人读完，名单是定稿", async () => {
		// 对话里按一条判据读了，交的时候改了判据的字：新判据下的经历一段都还没读
		const reworded = {
			...appraising,
			seek: { ...appraising.seek, criterion: "符合：鉴定师；不算：直播、销售" },
		};
		let asked = 0;
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "鉴宝师",
		});
		const spec = await answering(
			() => ({
				conditions: [asked++ === 0 ? appraising : reworded],
				note: null,
			}),
			() => settle(turnId),
		);
		assert.deepEqual(
			(await loadTurn(turnId))?.trace?.map(({ at: _at, ...step }) => step),
			[
				{ tool: "read", segments: 3, left: 3 },
				{ tool: "judge", fits: 2, unfit: 1 },
				{ tool: "read", segments: 3, left: 3 },
				{ tool: "judge", fits: 1, unfit: 2 },
				{ tool: "score", segments: 1 },
			],
			"提交一次就收，之后按交上来的判据读完",
		);
		const outcome = await search(spec, turnId);
		assert.deepEqual(
			outcome.results.map((r) => r.employee.empId),
			["JB01"],
		);
		assert.equal(outcome.incomplete, undefined);
		assert.equal((await loadTurn(turnId))?.settled, true);
	});

	test("下一轮原样沿用的条件，看过的经历不用再看", async () => {
		const root = await answering(
			() => ({ conditions: [appraising], note: null }),
			() => sentence("鉴宝的"),
		);
		const next = await answering(
			(_text, base) => ({ conditions: base, note: null }),
			() => sentence("就这样", root.turnId),
		);
		assert.deepEqual(
			(await loadTurn(next.turnId))?.trace?.map(({ at: _at, ...step }) => step),
			[{ tool: "read", segments: 0, left: 0 }],
			"去取了一次，没有要看的",
		);
		assert.deepEqual(next.spec, root.spec);
	});

	test("AI 读过的结论属于那一次找人任务：另一次任务写了同一条判据也从头读，任务删掉结论一起删", async () => {
		const read = async (text: string) => {
			const { turnId } = await createTurn(OWNER, { kind: "sentence", text });
			const spec = await answering(
				() => ({ conditions: [appraising], note: null }),
				() => settle(turnId),
			);
			return { turnId, spec };
		};
		const kept = async (rootTurnId: string) => {
			const { rows } = await pool.query<{ n: number }>(
				"select count(*)::int as n from experience_verdict where root_turn_id = $1",
				[rootTurnId],
			);
			return rows[0]?.n;
		};
		const { turnId: first } = await read("鉴宝的，头一次");
		const { turnId: second, spec } = await read("鉴宝的，另一次");
		assert.deepEqual(
			(await loadTurn(second))?.trace?.map(({ at: _at, ...step }) => step),
			[
				{ tool: "read", segments: 3, left: 3 },
				{ tool: "judge", fits: 2, unfit: 1 },
				{ tool: "score", segments: 2 },
			],
			"头一次读过的不算数，三段都重新读",
		);
		assert.deepEqual([await kept(first), await kept(second)], [3, 3]);

		await deleteSearch(OWNER, first);
		assert.deepEqual([await kept(first), await kept(second)], [0, 3]);
		assert.equal((await search(spec, second)).total, 2);
	});

	test("在对话的条件上直接去掉一条：名单先按确认过的出，AI 接着把新进范围的候选人确认完，条件不变；确认完这一轮才算处理完", async () => {
		// 两条都必须时候选人只有做鉴宝直播的那一位，确认过的也只有他
		const root = await answering(
			() => ({ conditions: [appraising, live], note: null }),
			() => sentence("鉴宝直播的"),
		);
		const spec = {
			query: { conditions: queryOfSpec(root.spec).conditions.slice(0, 1) },
		};
		const listed = async () => {
			const outcome = await search(spec, root.turnId);
			return [
				outcome.results.map((r) => r.employee.empId).sort(),
				outcome.incomplete,
			];
		};

		const { turnId, attempt } = await createTurn(
			OWNER,
			{ kind: "spec", spec },
			root.turnId,
		);
		assert.ok(attempt, "条件里有判据：这一轮带着处理的编号");
		assert.equal((await loadTurn(turnId))?.settled, false);
		assert.deepEqual(await listed(), [["JB02"], { above: null }]);

		await processTurn(turnId, attempt);
		const turn = await loadTurn(turnId);
		assert.equal(turn?.settled, true);
		assert.equal((await loadAttempt(OWNER, turnId))?.settled, true);
		assert.deepEqual(turn?.spec, spec, "条件还是 HR 改成的那一份");
		assert.deepEqual(
			turn?.trace?.map(({ at: _at, ...step }) => step),
			[
				{ tool: "read", segments: 2, left: 2 },
				{ tool: "judge", fits: 1, unfit: 1 },
				{ tool: "score", segments: 1 },
			],
			"只读新进范围的那两位",
		);
		assert.deepEqual(await listed(), [["JB01", "JB02"], undefined]);
	});

	test("改完的条件出不了名单：没有经历可读，这一轮照常处理完，不记步骤", async () => {
		const root = await answering(
			() => ({ conditions: [appraising], note: null }),
			() => sentence("鉴宝的，再加一条跑不了的"),
		);
		const spec: SearchSpec = {
			query: {
				conditions: [
					...queryOfSpec(root.spec).conditions,
					{ ...lately, id: "lately", mode: "must", from: "person" },
				],
			},
		};
		const { turnId, attempt } = await createTurn(
			OWNER,
			{ kind: "spec", spec },
			root.turnId,
		);
		assert.ok(attempt, "条件里有判据：这一轮带着处理的编号");
		await processTurn(turnId, attempt);
		const turn = await loadTurn(turnId);
		assert.deepEqual(
			[turn?.settled, turn?.fault, turn?.trace],
			[true, null, []],
			"名单出不来是搜索那一侧的空态，不是 AI 没处理成",
		);
	});

	test("改完条件，要补的人没补上：记下失败原因，这一轮不算处理完，名单仍不完整；重试把剩下的补完", async () => {
		const root = await answering(
			() => ({ conditions: [appraising, live], note: null }),
			() => sentence("鉴宝直播的"),
		);
		const spec = {
			query: { conditions: queryOfSpec(root.spec).conditions.slice(0, 1) },
		};
		const { turnId, attempt } = await createTurn(
			OWNER,
			{ kind: "spec", spec },
			root.turnId,
		);
		assert.ok(attempt);
		const restore = breakUnderstanding();
		try {
			await processTurn(turnId, attempt);
		} finally {
			restore();
		}
		const failed = await loadTurn(turnId);
		assert.deepEqual([failed?.settled, failed?.fault], [false, "rejected"]);
		assert.deepEqual((await search(spec, root.turnId)).incomplete, {
			above: null,
		});

		assert.deepEqual(await retried(turnId), spec);
		assert.equal((await loadTurn(turnId))?.settled, true);
		assert.equal((await search(spec, root.turnId)).incomplete, undefined);
	});

	test("改完条件还没补完又改了一次：上一轮的那一次到此为止，写不进来，也不算失败", async () => {
		const root = await answering(
			() => ({ conditions: [appraising], note: null }),
			() => sentence("鉴宝的，连改两次"),
		);
		const conditions = queryOfSpec(root.spec).conditions;
		const first = await createTurn(
			OWNER,
			{
				kind: "spec",
				spec: {
					query: {
						conditions: conditions.map((c) => ({ ...c, mode: "boost" })),
					},
				},
			},
			root.turnId,
		);
		assert.ok(first.attempt);
		const second = await createTurn(
			OWNER,
			{ kind: "spec", spec: root.spec },
			first.turnId,
		);
		assert.ok(second.attempt, "AI 的处理只属于最后一轮");
		assert.equal(await loadAttempt(OWNER, first.turnId), null);

		await processTurn(first.turnId, first.attempt);
		const replaced = await loadTurn(first.turnId);
		assert.deepEqual(
			[replaced?.settled, replaced?.trace, replaced?.fault],
			[true, null, null],
		);
	});

	test("模型回答迟到时，已被新轮或重试取代的运行不能再写结论，当前运行仍能正常确认", async () => {
		for (const action of ["revise", "retry"] as const) {
			const root = await answering(
				() => ({
					conditions: [
						{
							label: "员工",
							mode: "must",
							from: "person",
							where: "true",
						},
					],
					note: null,
				}),
				() => sentence(`合成迟到回答 ${action}`),
			);
			const spec: SearchSpec = {
				query: {
					conditions: [
						{ ...appraising, id: "appraise", from: "experience", mode: "must" },
					],
				},
			};
			const first = await createTurn(
				OWNER,
				{ kind: "spec", spec },
				root.turnId,
			);
			assert.ok(first.attempt);
			let entered!: () => void;
			let release!: () => void;
			const waiting = new Promise<void>((resolve) => {
				entered = resolve;
			});
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			const original = globalThis.fetch;
			let paused = false;
			globalThis.fetch = async (input, init) => {
				const response = await original(input, init);
				const payload = (await response.clone().json()) as {
					choices?: {
						message: {
							tool_calls?: { function: { name: string; arguments: string } }[];
						};
					}[];
				};
				const call = payload.choices?.[0]?.message.tool_calls?.find(
					(c) => c.function.name === "judge",
				);
				if (paused || !call) return response;
				paused = true;
				call.function.arguments = JSON.stringify({ fits: [] });
				entered();
				await held;
				return Response.json(payload);
			};
			const running = processTurn(first.turnId, first.attempt);
			let current = first;
			try {
				await waiting;
				if (action === "revise")
					current = await createTurn(
						OWNER,
						{ kind: "spec", spec },
						first.turnId,
					);
				else {
					await db
						.update(searchTurn)
						.set({
							attemptStartedAt: sql`now() - interval '1 hour'`,
							attemptHeartbeatAt: sql`now() - interval '1 hour'`,
							trace: [],
						})
						.where(eq(searchTurn.id, first.turnId));
					current = {
						turnId: first.turnId,
						attempt: await restartTurn(OWNER, first.turnId),
					};
				}
			} finally {
				release();
				await running;
				globalThis.fetch = original;
			}
			const kept = await pool.query<{ n: number }>(
				"select count(*)::int as n from experience_verdict where root_turn_id = $1",
				[root.turnId],
			);
			assert.equal(kept.rows[0]?.n, 0, `${action}：旧运行没有留下迟到的结论`);
			assert.ok(current.attempt);
			await processTurn(current.turnId, current.attempt);
			assert.equal((await loadTurn(current.turnId))?.settled, true);
			assert.deepEqual(
				(await search(spec, root.turnId)).results
					.map((r) => r.employee.empId)
					.sort(),
				["JB01", "JB02"],
				`${action}：当前运行的结论生效，名单没有被旧运行清空`,
			);
		}
	});

	test("不用 AI 接着处理的改动不带处理的编号：条件里没有判据的、关键词搜索的、在早先一轮上补充时恢复条件的那一轮", async () => {
		const plain = await sentence("education:硕士");
		const tuned = await createTurn(
			OWNER,
			{ kind: "spec", spec: plain.spec },
			plain.turnId,
		);
		assert.equal(tuned.attempt, null);
		assert.equal((await loadTurn(tuned.turnId))?.settled, true);
		assert.equal(await loadAttempt(OWNER, tuned.turnId), null);

		const typed = await createTurn(OWNER, {
			kind: "spec",
			spec: { conditions: parseQuery("鉴宝") },
		});
		const retyped = await createTurn(
			OWNER,
			{ kind: "spec", spec: { conditions: parseQuery("鉴宝, 直播") } },
			typed.turnId,
		);
		assert.deepEqual([typed.attempt, retyped.attempt], [null, null]);

		const root = await answering(
			() => ({ conditions: [appraising], note: null }),
			() => sentence("鉴宝的"),
		);
		await sentence("直播", root.turnId);
		const again = await createTurn(
			OWNER,
			{ kind: "sentence", text: "再想想" },
			root.turnId,
		);
		const restored = (await loadThread(OWNER, again.turnId))?.at(-2);
		assert.deepEqual(restored?.spec, root.spec, "恢复的是早先那一轮的条件");
		assert.deepEqual(
			[restored?.said, restored?.trace, restored?.settled],
			[null, null, true],
		);
	});
});

describe("一轮只有一次理解", () => {
	/**
	 * 理解随这一轮写下开始，重新开始只有人点重试这一个入口。还在跑的那一次不能被
	 * 重试顶掉：否则两次理解同时往一条记录上写步骤，线程里就是两遍的步骤混在一起。
	 */
	test("理解还在跑时点重试：什么都不做", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		assert.equal(await restartTurn(OWNER, turnId), null);
		await settle(turnId);
		assert.equal(await restartTurn(OWNER, turnId), null, "理解好了也不再开始");
	});

	/**
	 * 进程在理解到一半时没了：隔了一步的上限没有新的一步，也没有结果和失败，读记录时就是失败，
	 * 可以重试。万一那一次其实还活着、后来才写回来，编号已经换掉，它写不进来。
	 */
	test("没了的那一次算作失败；重试之后，它写不进来", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		const lost = await attemptOf(turnId);
		await db
			.update(searchTurn)
			.set({ attemptStartedAt: sql`now() - interval '1 hour'` })
			.where(eq(searchTurn.id, turnId));
		assert.equal((await loadAttempt(OWNER, turnId))?.fault, "broken");

		assert.ok(await restartTurn(OWNER, turnId));
		assert.equal((await loadAttempt(OWNER, turnId))?.fault, null);

		await processTurn(turnId, lost);
		assert.equal((await loadTurn(turnId))?.spec, null, "换掉的那一次没写进来");
		assert.deepEqual(wordsOf(await settle(turnId)), ["算法"]);
	});
});

describe("这一次理解还在不在", () => {
	/** 模拟持久化时钟，进度不参与存活判断。 */
	async function quietFor(turnId: string, started: number, heartbeat?: number) {
		await db
			.update(searchTurn)
			.set({
				attemptStartedAt: sql`now() - make_interval(secs => ${started / 1000})`,
				attemptHeartbeatAt:
					heartbeat === undefined
						? null
						: sql`now() - make_interval(secs => ${heartbeat / 1000})`,
				trace: [],
			})
			.where(eq(searchTurn.id, turnId));
		return (await loadAttempt(OWNER, turnId))?.fault ?? null;
	}

	test("请求排队或重试再久，有心跳就不能重试取代它", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		assert.equal(await quietFor(turnId, 3_600_000, 1_000), null);
		assert.equal(await restartTurn(OWNER, turnId), null);
	});

	test("创建后没有启动：租约过期读到 broken，没过的不算", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		assert.equal(await quietFor(turnId, 55_000), null);
		assert.equal(await quietFor(turnId, 65_000), "broken");
	});

	test("心跳过期才算没了，重试清掉旧心跳", async () => {
		const { turnId } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		const hour = 3_600_000;
		assert.equal(await quietFor(turnId, hour, 1_000), null);
		assert.equal(await quietFor(turnId, hour, 55_000), null);
		assert.equal(await quietFor(turnId, hour, 65_000), "broken");
		assert.ok(await restartTurn(OWNER, turnId), "没了的那一次可以重试");
		assert.equal((await loadAttempt(OWNER, turnId))?.fault, null);
	});

	test("模型仍在等待时进程独立续租，开始时间和展示步骤不变", {
		timeout: 20_000,
	}, async () => {
		const original = globalThis.fetch;
		let release!: () => void;
		let entered!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		globalThis.fetch = async (...args) => {
			entered();
			await held;
			return original(...args);
		};
		const { turnId, attempt } = await createTurn(OWNER, {
			kind: "sentence",
			text: "算法",
		});
		assert.ok(attempt);
		const running = processTurn(turnId, attempt);
		try {
			await started;
			await quietFor(turnId, 3_600_000, 65_000);
			const before = await loadAttempt(OWNER, turnId);
			const deadline = Date.now() + 13_000;
			while ((await loadAttempt(OWNER, turnId))?.fault && Date.now() < deadline)
				await new Promise((resolve) => setTimeout(resolve, 50));
			const alive = await loadAttempt(OWNER, turnId);
			assert.equal(alive?.fault, null);
			assert.equal(alive?.startedAt, before?.startedAt);
			assert.deepEqual(alive?.trace, before?.trace);
			assert.equal(await restartTurn(OWNER, turnId), null);
		} finally {
			release();
			await running;
			globalThis.fetch = original;
		}
	});
});

describe("查询记录状态", () => {
	test("链不分叉：一轮后面至多接一轮", async () => {
		const root = await sentence("算法");
		await sentence("渠道运营", root.turnId);
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "forked_turn",
				rootTurnId: root.turnId,
				parentTurnId: root.turnId,
				rawText: "带团队",
				attempt: "forked_attempt",
				attemptStartedAt: new Date(),
				trace: [],
			}),
			violates("search_turn_line"),
		);
	});

	test("说了话的一轮一定带着处理的编号；编号、开始的时刻和步骤同有同无", async () => {
		const root = await sentence("算法");
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "said_without_attempt",
				rootTurnId: root.turnId,
				rawText: "带团队",
			}),
			violates("search_turn_attempt"),
		);
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "attempt_without_start",
				rootTurnId: root.turnId,
				spec: root.spec,
				attempt: "stray",
				trace: [],
			}),
			violates("search_turn_attempt"),
		);
	});

	test("处理完了：说了话的一轮和条件同时写下，直接改条件的一轮要有处理的编号；处理完了的不能再记失败", async () => {
		const root = await sentence("算法");
		const run = {
			attempt: "synthetic",
			attemptStartedAt: new Date(),
			trace: [],
		};
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "said_done_without_spec",
				rootTurnId: root.turnId,
				rawText: "带团队",
				attemptDone: true,
				...run,
			}),
			violates("search_turn_done"),
		);
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "edited_done_without_attempt",
				rootTurnId: root.turnId,
				spec: root.spec,
				attemptDone: true,
			}),
			violates("search_turn_done"),
		);
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "done_and_failed",
				rootTurnId: root.turnId,
				spec: root.spec,
				attemptDone: true,
				attemptFault: "broken",
				...run,
			}),
			violates("search_turn_failed"),
		);
	});

	test("数据库不接受既没原话也没条件的记录", async () => {
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OWNER,
				id: "invalid_pending_spec",
				rootTurnId: "invalid_pending_spec",
				spec: null,
			}),
			violates("search_turn_state"),
		);
	});
});

describe("删除", () => {
	test("删一行就是删整条链，早先几轮不会留在列表里", async () => {
		const root = await sentence("产品经理");
		const rewritten = await sentence("渠道运营", root.turnId);

		const gone = await deleteSearch(OWNER, rewritten.turnId);
		assert.deepEqual(gone.sort(), [root.turnId, rewritten.turnId].sort());
		assert.equal(await loadTurn(root.turnId), null);
		assert.equal(await loadTurn(rewritten.turnId), null);
		assert.ok(
			!(await recent()).some((r) => r.turnId === root.turnId),
			"链头没有因为末条被删而顶回最近搜索",
		);
	});

	test("不存在的记录：什么都没删", async () => {
		assert.deepEqual(await deleteSearch(OWNER, "no-such-turn"), []);
	});
});

describe("一次找人任务只属于发起它的账号", () => {
	const OTHER = "synthetic-other";
	before(async () => {
		await pool.query(
			`insert into auth_user (id, name, email, username)
			 values ($1, '另一个合成账号', 'other@users.invalid', 'synthetic.other')`,
			[OTHER],
		);
	});

	test("别人的记录和不存在的一样：读不到、接不上、重试不了、删不掉，也不在最近搜索里", async () => {
		const mine = await sentence("算法");
		const failed = await createTurn(
			OWNER,
			{ kind: "sentence", text: "渠道运营" },
			mine.turnId,
		);
		const restore = breakUnderstanding();
		try {
			await processTurn(failed.turnId, await attemptOf(failed.turnId));
		} finally {
			restore();
		}
		assert.equal(await loadAttempt(OTHER, failed.turnId), null);
		assert.equal(await restartTurn(OTHER, failed.turnId), null);
		assert.ok(
			(await loadAttempt(OWNER, failed.turnId))?.fault,
			"别人的重试没有换掉这一次",
		);
		assert.equal(await loadThread(OTHER, mine.turnId), null);
		await assert.rejects(
			createTurn(OTHER, { kind: "sentence", text: "带团队" }, mine.turnId),
			/要修改的查询记录不存在/,
		);
		assert.deepEqual(await deleteSearch(OTHER, mine.turnId), []);
		assert.ok(await loadTurn(mine.turnId), "别人的删除没有删掉它");

		const theirs = await createTurn(OTHER, {
			kind: "spec",
			spec: { conditions: parseQuery("产品经理") },
		});
		const listed = await listRecent(OTHER, 50);
		assert.deepEqual(
			listed.rows.map((row) => row.turnId),
			[theirs.turnId],
		);
		assert.equal(listed.total, 1, "总数也只数自己的");
		assert.ok(!(await recent()).some((row) => row.turnId === theirs.turnId));
	});

	test("链上每一轮的归属都是链头的归属：数据库不接受接到别人链上的一轮", async () => {
		const root = await sentence("算法");
		await assert.rejects(
			db.insert(searchTurn).values({
				ownerId: OTHER,
				id: "grafted_turn",
				rootTurnId: root.turnId,
				parentTurnId: root.turnId,
				spec: { conditions: [] },
			}),
			violates("search_turn_chain"),
		);
	});
});
