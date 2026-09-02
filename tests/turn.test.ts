/**
 * 查询记录的派生语义。跑在临时 schema 上的真 SQL。
 *
 * 派生有两种，语义必须分开：**追加**（在父条件上再敲一句话，新词接在父 chips
 * 后面）和**重译**（同一句原话换一次理解，父的 chips 是要被替换的旧理解）。
 * 两者都挂在同一条链上——「最近搜索」一次找人任务只占一行、后退键能回到
 * 上一步，靠的都是链不断。
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

describe("整句的追加", () => {
	test("新词接在父条件后面，链上是同一次找人任务", async () => {
		const root = await sentence("算法");
		assert.deepEqual(root.terms, ["算法"]);

		const child = await sentence("渠道运营", root.turnId);
		assert.deepEqual(child.terms, ["算法", "渠道运营"]);
		const row = await loadTurn(child.turnId);
		assert.equal(row?.rootTurnId, root.turnId, "追加不开新链");
	});

	test("结构化范围与提示随完整查询一起继承，不借 URL 或旁路字段回填", async () => {
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
		assert.deepEqual(spec.scope, { kind: "external", minMonths: 24 });
		assert.deepEqual(spec.notices, [
			{ kind: "unsupported", text: "北京" },
			{ kind: "fallback" },
		]);
		assert.deepEqual(
			spec.evidence.map((item) => item.term),
			["算法", "渠道运营"],
		);
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

	test("链中段重译沿用这句话原本的合并基线", async () => {
		const root = await sentence("算法");
		const child = await sentence("渠道运营", root.turnId);
		assert.deepEqual(child.terms, ["算法", "渠道运营"]);

		const redo = await reinterpret(child.turnId);
		assert.deepEqual(redo.terms, ["算法", "渠道运营"]);
	});

	test("连续重译始终使用同一份基线", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const root = await sentence("算法");
		const child = await sentence("渠道运营", root.turnId);
		const redo1 = await reinterpret(child.turnId);
		const redo2 = await reinterpret(redo1.turnId);
		const rows = await db.select().from(searchTurn);
		const baseOf = (id: string) => rows.find((r) => r.id === id)?.baseTurnId;
		assert.equal(baseOf(child.turnId), root.turnId);
		assert.equal(baseOf(redo1.turnId), root.turnId);
		assert.equal(baseOf(redo2.turnId), root.turnId);
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

	test("纠正带着说明落库：原话仍是父亲那句，说明单独存", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const root = await sentence("渠道运营");
		const { turnId } = await createTurn(
			{ kind: "reinterpret", note: "指的是线下渠道" },
			root.turnId,
		);
		const rows = await db.select().from(searchTurn);
		const row = rows.find((r) => r.id === turnId);
		assert.equal(row?.rawText, "渠道运营", "被纠正的是原话，不是说明");
		assert.equal(row?.note, "指的是线下渠道");
		// 模型不可用时纠正说明被忽略，退回原话的规则解析——理解仍要能完成，
		// 说明里的词不许混进条件（它是修改意见，不是新查询）
		const spec = await resolveTurn(turnId);
		assert.deepEqual(
			spec.evidence.map((c) => c.term),
			["渠道运营"],
		);
	});

	test("没降级的理解不许无说明重跑：温度为 0，重跑只会复读", async () => {
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
		const { turnId } = await createTurn(
			{ kind: "reinterpret", note: "指的是硬件产品" },
			"nd_model",
		);
		assert.ok(turnId, "带纠正说明才是有意义的重新理解");
	});

	test("直接重试只看当前这句话是否降级，不被基线里的旧提示误导", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		const root = await sentence("算法");
		await db.insert(searchTurn).values({
			id: "model_child_after_fallback",
			rootTurnId: root.turnId,
			parentTurnId: root.turnId,
			baseTurnId: root.turnId,
			rawText: "渠道运营",
			delta: {
				evidence: [{ term: "渠道运营", mode: "must" }],
				scope: {},
				notices: [],
			},
			spec: {
				evidence: [
					{ term: "算法", mode: "must" },
					{ term: "渠道运营", mode: "must" },
				],
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
				id: "invalid_resolved",
				rootTurnId: "invalid_resolved",
				rawText: "算法",
				spec,
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

	test("待理解记录不在缺失基线时悄悄退回空查询", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		await db.insert(searchTurn).values([
			{
				id: "pending_base",
				rootTurnId: "pending_base",
				rawText: "算法",
			},
			{
				id: "pending_child",
				rootTurnId: "pending_base",
				parentTurnId: "pending_base",
				baseTurnId: "pending_base",
				rawText: "渠道运营",
			},
		]);

		await assert.rejects(resolveTurn("pending_child"), /合并基线尚未理解完成/);
	});

	test("纠正记录不在缺失上一版理解时当作普通查询", async () => {
		const { db } = await import("#/db");
		const { searchTurn } = await import("#/db/schema");
		await db.insert(searchTurn).values({
			id: "direct_parent",
			rootTurnId: "direct_parent",
			spec: { evidence: [], scope: {}, notices: [] },
		});
		await db.insert(searchTurn).values({
			id: "invalid_correction",
			rootTurnId: "direct_parent",
			parentTurnId: "direct_parent",
			rawText: "算法",
			note: "指的是推荐算法",
		});

		await assert.rejects(resolveTurn("invalid_correction"), /缺少上一版理解/);
	});
});
