/**
 * 查询记录的派生语义。跑在临时 schema 上的真 SQL，理解走夹具里的假模型端点
 * （按一行查询语法读那句话、接在当前条件后面，见 `fixture.ts` 的 `fakeIntent`）。
 *
 * 一条链是一次找人任务，派生有两种：**补充需求**（一句话作用在正看着的条件上）
 * 和**改条件**（直接交一整张表）。两者都记在同一条链的最后——「最近搜索」一次
 * 找人任务只占一行、线程从头读到尾、后退键能回到上一步，靠的都是链是一条线。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { SearchSpec } from "#/search/spec";
import { answering, breakUnderstanding, setup, violates } from "./fixture";

const teardown = await setup();
after(teardown);

const {
	createTurn,
	deleteSearch,
	listRecent,
	loadThread,
	loadTurn,
	resolveTurn,
	traceOf,
} = await import("#/server/turn");

/** 每条条件的代表词：主张的第一个经历词，人的条件的第一个取值。 */
const wordsOf = (spec: SearchSpec) =>
	spec.conditions.map((c) =>
		c.about === "experience"
			? c.what?.[0]
			: "atLeast" in c
				? c.atLeast
				: c.values[0],
	);

async function sentence(text: string, from?: string) {
	const { turnId } = await createTurn({ kind: "sentence", text }, from);
	const spec = await resolveTurn(turnId);
	return { turnId, spec, words: wordsOf(spec) };
}

/**
 * 一次对话任务，停在这份条件上：先说一句，再在 chip 上改成它（比如停用一条）。
 * 停用只能是用户在 chip 上做的事，模型写不出来。
 */
async function talkedTo(query: string) {
	const root = await sentence(query.replaceAll("~", ""));
	const { turnId } = await createTurn(
		{ kind: "spec", spec: { conditions: parseQuery(query) } },
		root.turnId,
	);
	return turnId;
}

describe("补充需求", () => {
	test("一句话作用在上一轮的条件上，链上仍是同一次找人任务", async () => {
		const root = await sentence("算法");
		const child = await sentence("渠道运营", root.turnId);
		assert.deepEqual(child.words, ["算法", "渠道运营"]);
		const row = await loadTurn(child.turnId);
		assert.equal(row?.rootTurnId, root.turnId, "补充需求不开新链");
		const thread = await loadThread(child.turnId);
		assert.deepEqual(
			thread?.map((t) => t.id),
			[root.turnId, child.turnId],
			"线程是整条链，链头在前",
		);
		assert.deepEqual(
			thread?.[0]?.spec,
			root.spec,
			"上一轮的条件就是这一轮的基线",
		);
	});

	test("理解时的步骤记在记录上：开始先清空，落下后能读回", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		assert.deepEqual(await traceOf(turnId), { settled: false, trace: [] });
		await resolveTurn(turnId);
		// 假模型不用工具，走完就是零步；有步的路在 agent-tools.test.ts 里
		assert.deepEqual(await traceOf(turnId), { settled: true, trace: [] });
		assert.deepEqual((await loadTurn(turnId))?.trace, []);
		assert.equal(await traceOf("nope"), null);
	});

	test("从哪一轮取线程都是整条链；不存在的记录没有线程", async () => {
		const root = await sentence("算法");
		const next = await sentence("渠道运营", root.turnId);
		for (const id of [root.turnId, next.turnId])
			assert.deepEqual(
				(await loadThread(id))?.map((t) => t.id),
				[root.turnId, next.turnId],
			);
		assert.equal(await loadThread("nope"), null);
	});

	test("在早先一轮上补充一句：先记一轮恢复那时的条件，话接在最后", async () => {
		const root = await sentence("算法");
		const later = await sentence("渠道运营", root.turnId);
		const { turnId } = await createTurn(
			{ kind: "sentence", text: "带团队" },
			root.turnId,
		);
		const thread = (await loadThread(turnId)) ?? [];
		assert.deepEqual(
			thread.slice(0, 2).map((t) => t.id),
			[root.turnId, later.turnId],
			"后面那一轮还在，没有分出去",
		);
		const [restored, said] = thread.slice(2);
		assert.equal(restored?.said, null, "恢复是一次直接改条件");
		assert.deepEqual(restored?.spec, root.spec);
		assert.equal(said?.id, turnId);
		assert.deepEqual(wordsOf(await resolveTurn(turnId)), ["算法", "带团队"]);
	});

	test("同时追加两轮：排着队接上，链仍是一条线", async () => {
		const root = await sentence("算法");
		const spec = (q: string) => ({
			kind: "spec" as const,
			spec: { conditions: parseQuery(q) },
		});
		const [a, b] = await Promise.all([
			createTurn(spec("+算法"), root.turnId),
			createTurn(spec("算法, 后端"), root.turnId),
		]);
		const ids = (await loadThread(root.turnId))?.map((t) => t.id);
		assert.equal(ids?.length, 3);
		assert.deepEqual(new Set(ids?.slice(1)), new Set([a.turnId, b.turnId]));
	});

	test("在早先一轮上直接改条件：整张表接在最后，不另记恢复", async () => {
		const root = await sentence("算法");
		const later = await sentence("渠道运营", root.turnId);
		const { turnId } = await createTurn(
			{ kind: "spec", spec: { conditions: parseQuery("+算法") } },
			root.turnId,
		);
		assert.deepEqual(
			(await loadThread(turnId))?.map((t) => t.id),
			[root.turnId, later.turnId, turnId],
		);
	});

	test("模型拿到的是上一轮的整张表，停用的也在里面", async () => {
		const at = await talkedTo("~算法, 渠道运营");
		let seen: unknown[] = [];
		await answering(
			(_text, base) => {
				seen = base;
				return { conditions: base, assumed: [], declined: [] };
			},
			async () => {
				const { turnId } = await createTurn(
					{ kind: "sentence", text: "就这样" },
					at,
				);
				await resolveTurn(turnId);
			},
		);
		assert.deepEqual(seen, parseQuery("算法, 渠道运营"));
	});

	test("用户停掉的条件不会因为又说了一句话就复活", async () => {
		const child = await sentence("渠道运营", await talkedTo("~算法"));
		assert.deepEqual(child.spec.conditions, parseQuery("~算法, 渠道运营"));
	});

	test("模型按这句话重写了整张表：新表就是新表", async () => {
		const root = await sentence("算法");
		const spec = await answering(
			() => ({ conditions: parseQuery("产品经理"), assumed: [], declined: [] }),
			async () => {
				const { turnId } = await createTurn(
					{ kind: "sentence", text: "换成找产品经理" },
					root.turnId,
				);
				return resolveTurn(turnId);
			},
		);
		assert.deepEqual(spec.conditions, parseQuery("产品经理"));
	});

	test("没理解出来的最后一轮被下一句取代，不留在链上", async () => {
		const root = await sentence("算法");
		const stuck = await createTurn(
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		const { turnId } = await createTurn(
			{ kind: "sentence", text: "带团队" },
			stuck.turnId,
		);
		assert.equal(await loadTurn(stuck.turnId), null);
		assert.deepEqual(
			(await loadThread(turnId))?.map((t) => t.id),
			[root.turnId, turnId],
		);
		assert.deepEqual(wordsOf(await resolveTurn(turnId)), ["算法", "带团队"]);
	});

	test("链头就没理解出来：下一句成了新的链头", async () => {
		const stuck = await createTurn({ kind: "sentence", text: "算法" });
		const { turnId } = await createTurn(
			{ kind: "sentence", text: "渠道运营" },
			stuck.turnId,
		);
		assert.equal(await loadTurn(stuck.turnId), null);
		const turn = await loadTurn(turnId);
		assert.equal(turn?.rootTurnId, turnId);
		assert.equal(turn?.title, "渠道运营");
	});

	test("还没有条件时不能直接改条件", async () => {
		const stuck = await createTurn({ kind: "sentence", text: "算法" });
		await assert.rejects(
			createTurn(
				{ kind: "spec", spec: { conditions: parseQuery("算法") } },
				stuck.turnId,
			),
			/还没有可以修改的搜索条件/,
		);
	});
});

describe("说明", () => {
	test("读法和搜不了的要求跟着这一轮落库，替代条件也查词表", async () => {
		const { turnId } = await createTurn({
			kind: "sentence",
			text: "北京的算法，有潜力",
		});
		await answering(
			() => ({
				conditions: parseQuery("算法"),
				assumed: ["「算法」按算法工程方向读"],
				declined: [
					{ said: "北京的", why: "库里没有工作地点", instead: [] },
					{
						said: "有潜力",
						why: "经历里看不出潜力",
						instead: [
							{ about: "experience", mode: "boost", what: ["带团队"] },
							{
								about: "person",
								mode: "must",
								field: "level",
								values: ["资深"],
							},
						],
					},
				],
			}),
			() => resolveTurn(turnId),
		);
		assert.deepEqual((await loadTurn(turnId))?.notes, {
			assumed: ["「算法」按算法工程方向读"],
			declined: [
				{ said: "北京的", why: "库里没有工作地点", instead: [] },
				{
					said: "有潜力",
					why: "经历里看不出潜力",
					instead: parseQuery("+带团队"),
				},
			],
		});
	});

	test("一条都搜不了的话是一个合法的结果：条件为空，说明在", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "北京的" });
		const spec = await answering(
			() => ({
				conditions: [],
				assumed: [],
				declined: [{ said: "北京的", why: "库里没有工作地点", instead: [] }],
			}),
			() => resolveTurn(turnId),
		);
		assert.deepEqual(spec.conditions, []);
		assert.equal((await loadTurn(turnId))?.notes?.declined.length, 1);
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
		const before = await listRecent();
		const root = await sentence("产品经理");
		const next = await sentence("渠道运营", root.turnId);

		const rows = (await listRecent()).filter(
			(r) => !before.some((b) => b.turnId === r.turnId),
		);
		assert.equal(rows.length, 1, "一次找人任务只占一行");
		assert.equal(rows[0]?.turnId, next.turnId, "停在最后的样子上");
		assert.equal(rows[0]?.title, "产品经理");
	});

	test("关键词搜索没有标题", async () => {
		const { turnId } = await createTurn({
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		const [row] = (await listRecent()).filter((r) => r.turnId === turnId);
		assert.equal(row?.title, null);
	});
});

describe("两种搜索各走各的链", () => {
	test("链头定下种类：有原话是对话，直接是条件是关键词，整条链不变", async () => {
		const talk = await sentence("算法");
		const tuned = await createTurn(
			{ kind: "spec", spec: { conditions: parseQuery("+算法") } },
			talk.turnId,
		);
		assert.equal((await loadTurn(tuned.turnId))?.mode, "conversation");

		const typed = await createTurn({
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		const next = await createTurn(
			{ kind: "spec", spec: { conditions: parseQuery("算法, 渠道运营") } },
			typed.turnId,
		);
		assert.equal((await loadTurn(next.turnId))?.mode, "keyword");
	});

	test("关键词搜索不收一句话的需求", async () => {
		const typed = await createTurn({
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		await assert.rejects(
			createTurn({ kind: "sentence", text: "渠道运营" }, typed.turnId),
			/关键词搜索不收一句话/,
		);
	});

	test("关键词搜索只收框里写得出的条件表", async () => {
		// 加分、停用都不是框能写出来的：落了库，结果页就填不回框里
		await assert.rejects(
			createTurn({ kind: "spec", spec: { conditions: parseQuery("+算法") } }),
			/关键词框里写得出/,
		);
		const typed = await createTurn({
			kind: "spec",
			spec: { conditions: parseQuery("算法") },
		});
		await assert.rejects(
			createTurn(
				{ kind: "spec", spec: { conditions: parseQuery("~算法") } },
				typed.turnId,
			),
			/关键词框里写得出/,
		);
	});
});

describe("理解失败", () => {
	/**
	 * 模型那一跳失败时记录必须停在「待理解」：spec 仍是 null，下一次调用
	 * 再跑一遍。落一份空 spec 的话，这条 `/s/:id` 就永久变成「没有条件」，
	 * 而故障在屏幕上和「没有这样的人」长得一模一样。
	 */
	test("模型报错时不落库，记录仍待理解，再试一次照常成立", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		const restore = breakUnderstanding();
		try {
			await assert.rejects(resolveTurn(turnId));
		} finally {
			restore();
		}
		assert.equal((await loadTurn(turnId))?.spec, null);

		const spec = await resolveTurn(turnId);
		assert.deepEqual(wordsOf(spec), ["算法"]);
	});

	/**
	 * 模型答得合法却没按约定作答——给了条件，取值却全在词表外——收窄之后
	 * 一个不剩。这一份空条件走下去，界面画的是「一个条件都没解析出来」，
	 * 也就是把一次故障画成了「你没说条件」。它和端点报错走同一条路。
	 */
	test("模型给了条件、收窄后一个不剩：也是失败，不落库", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		await assert.rejects(
			answering(
				() => ({
					conditions: [
						{ about: "person", field: "level", mode: "must", values: ["资深"] },
					],
					assumed: [],
					declined: [],
				}),
				() => resolveTurn(turnId),
			),
			/全部不合规/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);

		assert.deepEqual(wordsOf(await resolveTurn(turnId)), ["算法"]);
	});

	test("条件和说明都空着：没作答，不落库", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		await assert.rejects(
			answering(
				() => ({ conditions: [], assumed: [], declined: [] }),
				() => resolveTurn(turnId),
			),
			/既没有给出条件，也没有说明/,
		);
		assert.equal((await loadTurn(turnId))?.spec, null);
	});

	test("只丢一部分是设计内的：剩下的条件照常落库", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		const spec = await answering(
			() => ({
				conditions: [
					{ about: "person", field: "level", mode: "boost", values: ["资深"] },
					{ about: "experience", mode: "must", minMonths: -36 },
					{ about: "experience", mode: "must", what: ["算法"] },
				],
				assumed: [],
				declined: [],
			}),
			() => resolveTurn(turnId),
		);
		assert.deepEqual(spec.conditions, [
			{ about: "experience", mode: "must", what: ["算法"] },
		]);
	});
});

describe("理解只落一次", () => {
	/**
	 * 工作台挂载后就地补理解，而同一条 `/s/:id` 可能被同时打开两次（两个标签页、
	 * 一次刷新）。记录是不可变的，所以这两跳不能各写一份：`where spec is null`
	 * 让先写入的生效，后到的读回同一份最终结果。写成「后到的覆盖」的话，同一条
	 * 查询的条件会在两次刷新之间悄悄变一次，而 URL 承诺的正是它不变。
	 */
	test("并发理解同一条记录：先写入的生效，后到的读回同一份", async () => {
		const { turnId } = await createTurn({
			kind: "sentence",
			text: "算法、渠道运营",
		});
		const [first, second] = await Promise.all([
			resolveTurn(turnId),
			resolveTurn(turnId),
		]);
		assert.deepEqual(first, second, "两跳必须读到同一份 spec");
		assert.deepEqual((await loadTurn(turnId))?.spec, first, "落库的就是那一份");
	});
});

describe("查询记录状态", () => {
	test("链不分叉：一轮后面至多接一轮", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const root = await sentence("算法");
		await sentence("渠道运营", root.turnId);
		await assert.rejects(
			db.insert(searchTurn).values({
				id: "forked_turn",
				rootTurnId: root.turnId,
				parentTurnId: root.turnId,
				rawText: "带团队",
			}),
			violates("search_turn_line"),
		);
	});

	test("数据库不接受既没原话也没条件的记录", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		await assert.rejects(
			db.insert(searchTurn).values({
				id: "invalid_pending_spec",
				rootTurnId: "invalid_pending_spec",
				spec: null,
			}),
			violates("search_turn_state"),
		);
	});
});

describe("删除", () => {
	test("删一行就是删整条链，早先几轮不会顶上来", async () => {
		const root = await sentence("产品经理");
		const rewritten = await sentence("渠道运营", root.turnId);

		const gone = await deleteSearch(rewritten.turnId);
		assert.deepEqual(gone.sort(), [root.turnId, rewritten.turnId].sort());
		assert.equal(await loadTurn(root.turnId), null);
		assert.equal(await loadTurn(rewritten.turnId), null);
		assert.ok(
			!(await listRecent()).some((r) => r.turnId === root.turnId),
			"链头没有因为末条被删而顶回最近搜索",
		);
	});

	test("不存在的记录：什么都没删", async () => {
		assert.deepEqual(await deleteSearch("no-such-turn"), []);
	});
});
