/**
 * 查询记录的派生语义。跑在临时 schema 上的真 SQL。
 *
 * 派生有三种：**改写**（把这条查询问的那句话换一句，条件整份重来）、**重译**
 * （同一句原话换一次理解）和**改条件**（不动那句话，只调几枚 chip）。三者都挂在
 * 同一条链上——「最近搜索」一次找人任务只占一行、后退键能回到上一步，
 * 靠的都是链不断。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { setup } from "./fixture";

const teardown = await setup();
after(teardown);

// 不碰真模型：不设 LLM_BASE_URL 时 understand 返回 null，退回确定性的规则解析，
// 测试才不依赖网络。llm.ts 在模块求值时就读了环境变量，所以删除必须在 import 前。
delete process.env.LLM_BASE_URL;
const { createTurn, listRecent, loadTurn, resolveTurn } = await import(
	"#/server/turn"
);

const violates = (constraint: string) => (error: unknown) =>
	(error as { cause?: { constraint?: string } }).cause?.constraint ===
	constraint;

async function sentence(text: string, parent?: string) {
	const { turnId } = await createTurn({ kind: "sentence", text }, parent);
	const spec = await resolveTurn(turnId);
	return { turnId, spec, terms: spec.evidence.map((c) => c.term) };
}

async function reinterpret(parent: string) {
	const { turnId } = await createTurn({ kind: "reinterpret" }, parent);
	const spec = await resolveTurn(turnId);
	return { turnId, terms: spec.evidence.map((c) => c.term) };
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

	test("上一条的范围与提示不跟着过来", async () => {
		const root = await createTurn({
			kind: "spec",
			spec: {
				evidence: [{ term: "算法", mode: "must" }],
				scope: { kind: "external", minMonths: 24 },
				notices: [{ kind: "unsupported", text: "北京" }],
			},
		});
		const child = await createTurn(
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		const spec = await resolveTurn(child.turnId);
		assert.deepEqual(spec.scope, {});
		assert.deepEqual(spec.notices, [{ kind: "fallback" }]);
		assert.deepEqual(
			spec.evidence.map((item) => item.term),
			["渠道运营"],
		);
	});
});

describe("只改条件", () => {
	test("原话原样带下来：问的是什么没变，只是读法调了一下", async () => {
		const root = await sentence("算法");
		const tuned = await createTurn(
			{
				kind: "spec",
				spec: {
					evidence: [{ term: "算法", mode: "boost" }],
					scope: {},
					notices: [],
				},
			},
			root.turnId,
		);
		assert.equal((await loadTurn(tuned.turnId))?.rawText, "算法");
	});
});

describe("整句的重译", () => {
	test("重译由服务端复用父记录的原话", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const root = await sentence("渠道运营");
		const redo = await reinterpret(root.turnId);
		assert.deepEqual(redo.terms, ["渠道运营"]);
		const rows = await db.select().from(searchTurn);
		assert.equal(rows.find((r) => r.id === redo.turnId)?.rawText, "渠道运营");
		assert.equal((await loadTurn(root.turnId))?.canReinterpret, true);
	});

	test("链中段重译只重读这一句，不把上一句的词带回来", async () => {
		const root = await sentence("算法");
		const child = await sentence("渠道运营", root.turnId);

		const redo = await reinterpret(child.turnId);
		assert.deepEqual(redo.terms, ["渠道运营"]);
	});

	test("重译不脱链：最近搜索里仍是一行，停在重译后的样子", async () => {
		const before = await listRecent();
		const root = await sentence("产品经理");
		const redo = await reinterpret(root.turnId);

		const rows = (await listRecent()).filter(
			(r) => !before.some((b) => b.turnId === r.turnId),
		);
		assert.equal(rows.length, 1, "一次找人任务只占一行");
		assert.equal(rows[0]?.turnId, redo.turnId, "停在最后的样子上");
	});

	test("没降级的理解不许重跑：温度为 0，重跑只会复读", async () => {
		// 离线跑不出「模型参与过」的记录（规则解析必然降级），直接落一行模拟：
		// 服务端函数是可直接调用的端点，这条契约必须在 createTurn 里立住
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		await db.insert(searchTurn).values({
			id: "nd_model",
			rootTurnId: "nd_model",
			rawText: "产品经理",
			delta: {
				evidence: [{ term: "产品经理", mode: "must" }],
				scope: {},
				notices: [],
			},
			spec: {
				evidence: [{ term: "产品经理", mode: "must" }],
				scope: {},
				notices: [],
			},
		});
		await assert.rejects(createTurn({ kind: "reinterpret" }, "nd_model"));
	});

	test("直接重试只看当前这句话是否降级，不被合并结果里的旧提示误导", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const root = await sentence("算法");
		await db.insert(searchTurn).values({
			id: "model_child_after_fallback",
			rootTurnId: root.turnId,
			parentTurnId: root.turnId,
			rawText: "渠道运营",
			delta: {
				evidence: [{ term: "渠道运营", mode: "must" }],
				scope: {},
				notices: [],
			},
			spec: {
				evidence: [{ term: "渠道运营", mode: "must" }],
				scope: {},
				notices: [{ kind: "fallback" }],
			},
		});

		const row = await loadTurn("model_child_after_fallback");
		assert.equal(row?.canReinterpret, false);
		await assert.rejects(
			createTurn({ kind: "reinterpret" }, "model_child_after_fallback"),
		);
	});

	test("只有已经理解完成的整句记录可以重译", async () => {
		await assert.rejects(createTurn({ kind: "reinterpret" }));
		const root = await sentence("算法");
		const direct = await createTurn(
			{
				kind: "spec",
				spec: {
					evidence: [{ term: "算法", mode: "must" }],
					scope: {},
					notices: [],
				},
			},
			root.turnId,
		);
		await assert.rejects(createTurn({ kind: "reinterpret" }, direct.turnId));

		const pending = await createTurn(
			{ kind: "sentence", text: "渠道运营" },
			root.turnId,
		);
		await assert.rejects(
			createTurn({ kind: "sentence", text: "带团队" }, pending.turnId),
		);
	});
});

describe("查询记录状态", () => {
	test("数据库只接受待理解、已理解和直接查询三种形状", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const spec = {
			evidence: [{ term: "算法", mode: "must" as const }],
			scope: {},
			notices: [],
		};

		await assert.rejects(
			db.insert(searchTurn).values({
				id: "invalid_pending_spec",
				rootTurnId: "invalid_pending_spec",
				spec: null,
			}),
			violates("search_turn_state"),
		);
		await assert.rejects(
			db.insert(searchTurn).values({
				id: "invalid_direct_delta",
				rootTurnId: "invalid_direct_delta",
				delta: spec,
				spec,
			}),
			violates("search_turn_state"),
		);
		await assert.rejects(
			db.insert(searchTurn).values({
				id: "invalid_pending_delta",
				rootTurnId: "invalid_pending_delta",
				rawText: "算法",
				delta: spec,
			}),
			violates("search_turn_state"),
		);
	});
});
