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

async function sentence(text: string, parent?: string) {
	const { turnId } = await createTurn({ kind: "sentence", text }, parent);
	const { chips } = await resolveTurn(turnId);
	return { turnId, chips, terms: chips.map((c) => c.term) };
}

async function reinterpret(parent: string) {
	const { turnId } = await createTurn({ kind: "reinterpret" }, parent);
	const { chips } = await resolveTurn(turnId);
	return { turnId, terms: chips.map((c) => c.term) };
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
		const { chips } = await resolveTurn(turnId);
		assert.deepEqual(
			chips.map((c) => c.term),
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
			chips: [{ term: "产品经理", mode: "must" }],
			degraded: false,
		});
		await assert.rejects(createTurn({ kind: "reinterpret" }, "nd_model"));
		const { turnId } = await createTurn(
			{ kind: "reinterpret", note: "指的是硬件产品" },
			"nd_model",
		);
		assert.ok(turnId, "带纠正说明才是有意义的重新理解");
	});

	test("只有已经理解完成的整句记录可以重译", async () => {
		await assert.rejects(createTurn({ kind: "reinterpret" }));
		const root = await sentence("算法");
		const direct = await createTurn(
			{ kind: "chips", chips: [{ term: "算法", mode: "must" }] },
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
