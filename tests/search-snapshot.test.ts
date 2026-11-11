/**
 * 语料快照。
 *
 * 语料是增量长的（解析一批一批地提交、同步一笔事务增删），一次跨语句读取仍然只能看见一个
 * 整体：按字面捞说法、物化命中、接上确认过的结论、取事实都在同一个快照里（`search/phrases.ts`、
 * `search/execute.ts`）。检索里没有模型调用，快照不会被一次慢端点占住。
 *
 * 自己起一个 schema：用例中途增删语料，和别的用例共用种子的话，别处的断言会莫名其妙地
 * 多几个人、少几个人。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 在模块求值时就绑死了环境变量
const { db, pool } = await import("#/db");
const { withCorpusSnapshot } = await import("#/db/snapshot");

describe("语料快照", () => {
	/** 一笔写者的短事务：加一个人一段经历。解析和同步写入都是这种事务。 */
	async function writeOne(empId: string) {
		const writer = await pool.connect();
		try {
			await writer.query("begin");
			await writer.query("set local lock_timeout = '3s'");
			await writer.query(
				"insert into employee (emp_id, name) values ($1, $1)",
				[empId],
			);
			await writer.query(
				`insert into experience (emp_id, kind, start_date, months)
				 values ($1, 'internal', '2020-01-01', 12)`,
				[empId],
			);
			await writer.query("commit");
		} finally {
			writer.release();
		}
	}

	test("一次快照里的多条语句只看得见一个整体", async () => {
		await seed([
			{
				empId: "SNAP001",
				name: "快照前就在",
				segments: [{ title: "快照读取验证", months: 12 }],
			},
		]);
		const count = (store: { execute: typeof db.execute }) =>
			store
				.execute<{ n: number }>(sql`select count(*)::int as n from experience`)
				.then((r) => r.rows[0]?.n);

		// 写者在这次读取**中途**提交了一笔。快照是事务开头拍的，第二条语句看到的
		// 仍然是那一张；读提交隔离下它会看见多出来的那一段。
		let before: number | undefined;
		await withCorpusSnapshot(async (store) => {
			before = await count(store);
			await writeOne("SNAP002");
			assert.equal(await count(store), before, "同一次快照里两次读取必须一致");
		});
		assert.equal(await count(db), (before ?? 0) + 1, "快照之外看得见那一笔");
	});
});
