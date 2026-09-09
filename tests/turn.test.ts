/**
 * 查询记录的派生语义。跑在临时 schema 上的真 SQL，理解走夹具里的假模型端点
 * （按一行查询语法读那句话，见 `fixture.ts` 的 `fakeIntent`）。
 *
 * 派生有两种：**改写**（把这条查询问的那句话换一句，条件整份重来）和
 * **改条件**（不动那句话，只调几枚 chip）。两者都挂在同一条链上——「最近搜索」
 * 一次找人任务只占一行、后退键能回到上一步，靠的都是链不断。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { SearchSpec } from "#/search/spec";
import { answerIntent, breakUnderstanding, setup, violates } from "./fixture";

const teardown = await setup();
after(teardown);

const { createTurn, listRecent, loadTurn, resolveTurn } = await import(
	"#/server/turn"
);

const termsOf = (spec: SearchSpec) => spec.terms.map((t) => t.values[0]);

async function sentence(text: string, parent?: string) {
	const { turnId } = await createTurn({ kind: "sentence", text }, parent);
	const spec = await resolveTurn(turnId);
	return { turnId, spec, terms: termsOf(spec) };
}

describe("整句的改写", () => {
	test("新的一句整份替换旧条件，链上仍是同一次找人任务", async () => {
		const root = await sentence("算法");
		assert.deepEqual(root.terms, ["算法"]);

		// 改写不是追加：屏幕上那句话是查询的完整表示，换一句就该整份重读，
		// 否则删掉的词会从上一版的条件里活着回来。
		const child = await sentence("渠道运营", root.turnId);
		assert.deepEqual(child.terms, ["渠道运营"]);
		const row = await loadTurn(child.turnId);
		assert.equal(row?.rootTurnId, root.turnId, "改写不开新链");
	});

	test("上一条的范围不跟着过来", async () => {
		const root = await createTurn({
			kind: "spec",
			spec: { terms: parseQuery("算法,kind:external,minMonths:24") },
		});
		const child = await createTurn(
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		const spec = await resolveTurn(child.turnId);
		assert.deepEqual(spec.terms, parseQuery("渠道运营"));
	});
});

describe("只改条件", () => {
	test("原话原样带下来：问的是什么没变，只是读法调了一下", async () => {
		const root = await sentence("算法");
		const tuned = await createTurn(
			{
				kind: "spec",
				spec: { terms: parseQuery("+算法") },
			},
			root.turnId,
		);
		assert.equal((await loadTurn(tuned.turnId))?.rawText, "算法");
	});
});

describe("门面", () => {
	test("那一行的门面和它的条件出自同一次提问", async () => {
		const root = await sentence("算法");
		const rewritten = await sentence("渠道运营", root.turnId);
		const [row] = (await listRecent()).filter(
			(r) => r.turnId === rewritten.turnId,
		);
		// 门面若回溯根记录取原话，改写之后就是拿旧话给新条件当门面：屏幕上写着
		// 「算法」，点进去搜的是渠道运营，而两边都不会报错。
		assert.equal(row?.rawText, "渠道运营");
	});

	test("改一枚 chip 不换门面：问的还是那句话", async () => {
		const root = await sentence("算法");
		const { turnId } = await createTurn(
			{
				kind: "spec",
				spec: { terms: parseQuery("+算法") },
			},
			root.turnId,
		);
		const [row] = (await listRecent()).filter((r) => r.turnId === turnId);
		assert.equal(row?.rawText, "算法", "调条件不是重新问一遍");
	});

	test("改写不脱链：最近搜索里仍是一行，停在最后的样子", async () => {
		const before = await listRecent();
		const root = await sentence("产品经理");
		const rewritten = await sentence("渠道运营", root.turnId);

		const rows = (await listRecent()).filter(
			(r) => !before.some((b) => b.turnId === r.turnId),
		);
		assert.equal(rows.length, 1, "一次找人任务只占一行");
		assert.equal(rows[0]?.turnId, rewritten.turnId, "停在最后的样子上");
	});

	test("还在理解中的记录不能派生", async () => {
		const root = await sentence("算法");
		const pending = await createTurn(
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		await assert.rejects(
			createTurn({ kind: "sentence", text: "带团队" }, pending.turnId),
			/查询仍在理解中/,
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
		assert.deepEqual(termsOf(spec), ["算法"]);
	});

	/**
	 * 模型答得合法却没按约定作答——给了条件，取值却全在词表外——收窄之后
	 * 一个不剩。这一份空条件走下去，界面画的是「一个条件都没解析出来」，
	 * 也就是把一次故障画成了「你没说条件」。它和端点报错走同一条路。
	 */
	test("模型给了条件、收窄后一个不剩：也是失败，不落库", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		const restore = answerIntent(() => ({
			terms: [{ field: "level", mode: "must", values: ["资深"] }],
		}));
		try {
			await assert.rejects(resolveTurn(turnId));
		} finally {
			restore();
		}
		assert.equal((await loadTurn(turnId))?.spec, null);

		assert.deepEqual(termsOf(await resolveTurn(turnId)), ["算法"]);
	});

	test("只丢一部分是设计内的：剩下的条件照常落库", async () => {
		const { turnId } = await createTurn({ kind: "sentence", text: "算法" });
		const restore = answerIntent(() => ({
			terms: [
				{ field: "level", mode: "boost", values: ["资深"] },
				{ field: "minMonths", mode: "must", values: ["三年"] },
				{ field: "experience", mode: "must", values: ["算法"] },
			],
		}));
		try {
			assert.deepEqual((await resolveTurn(turnId)).terms, [
				{ field: "experience", mode: "must", values: ["算法"] },
			]);
		} finally {
			restore();
		}
	});
});

describe("理解只落一次", () => {
	/**
	 * 工作台挂载后就地补理解，而同一条 `/s/:id` 可能被同时打开两次（两个标签页、
	 * 一次刷新）。记录是不可变的，所以这两跳不能各写一份：`where spec is null`
	 * 让先到的赢，后到的读回同一份最终结果。写成「后到的覆盖」的话，同一条
	 * 查询的条件会在两次刷新之间悄悄变一次，而 URL 承诺的正是它不变。
	 */
	test("并发理解同一条记录：先写的赢，后到的读回同一份", async () => {
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
