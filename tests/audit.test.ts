/**
 * 操作记录：搜索、查看、导出各记一行，写下之后管理员在审计页按账号、人或搜索内容找得到。
 * 账号页上的几件事见 `auth.test.ts`。
 * 跑在临时 schema 上的真 SQL；人和账号都是合成的。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import { OWNER, seed, setup, violates } from "./fixture";

const teardown = await setup();
after(teardown);

const { listAudit, recordExport, recordView } = await import("#/server/audit");
const { createTurn, deleteSearch } = await import("#/server/turn");
const { db } = await import("#/db");
const { auditEvent } = await import("#/db/schema");

/** 一行里断言用得上的那几样。 */
const told = async (needle = "") =>
	(await listAudit(needle, 1)).rows.map((row) => [
		row.username,
		row.action,
		row.personId ?? row.text,
	]);

test("搜索和记录同一个事务写下：说的话或改完的条件；没写成的一轮不留痕，删掉搜索不带走它", async () => {
	const { turnId } = await createTurn(OWNER, {
		kind: "spec",
		spec: { conditions: parseQuery("算法") },
	});
	await createTurn(
		OWNER,
		{ kind: "spec", spec: { conditions: parseQuery("产品经理") } },
		turnId,
	);
	await assert.rejects(
		createTurn(OWNER, { kind: "sentence", text: "带团队" }, "no-such-turn"),
	);
	await deleteSearch(OWNER, turnId);
	assert.deepEqual(await told(), [
		["synthetic.owner", "search", "产品经理"],
		["synthetic.owner", "search", "算法"],
	]);
});

test("查看和导出一个人一行；按账号、工号、姓名、搜索内容都找得到，新的在前", async () => {
	await seed([
		{ personId: "synthetic-1", name: "合成甲", segments: [] },
		{ personId: "synthetic-2", name: "合成乙", segments: [] },
	]);
	await recordView(OWNER, "synthetic-1");
	await recordExport(OWNER, ["synthetic-1", "synthetic-2"]);
	assert.deepEqual(await told("合成乙"), [
		["synthetic.owner", "export", "synthetic-2"],
	]);
	assert.deepEqual(await told("synthetic-1"), [
		["synthetic.owner", "export", "synthetic-1"],
		["synthetic.owner", "view", "synthetic-1"],
	]);
	assert.deepEqual(await told("产品"), [
		["synthetic.owner", "search", "产品经理"],
	]);
	const all = await listAudit("synthetic.owner", 1);
	assert.equal(all.total, 5);
	assert.equal(all.rows[0]?.empName, "合成乙");
	assert.match(all.rows[0]?.at ?? "", /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
	assert.equal((await listAudit("没有这个词", 1)).total, 0);
});

test("一行只有一个对象：搜索带内容，查看和导出带人，管理账号带那个账号", async () => {
	for (const row of [
		{ action: "search" as const, personId: "synthetic-1", text: "算法" },
		{ action: "search" as const },
		{ action: "view" as const, text: "算法" },
		{ action: "export" as const },
		{ action: "view" as const, accountId: OWNER },
		{ action: "disable-account" as const, personId: "synthetic-1" },
		{ action: "create-account" as const },
	])
		await assert.rejects(
			db.insert(auditEvent).values({ userId: OWNER, ...row }),
			violates("audit_object_source_v2"),
		);
});
