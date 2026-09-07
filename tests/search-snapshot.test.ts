/**
 * 语料锁。
 *
 * 语料锁要同时成立两件相反的事：一次跨语句读取只看得见一版语料，而**模型调用
 * 不许押着它**——独占锁是排队的，一次慢端点会挡住等着发布的 ETL，那个 ETL 又
 * 挡住排在它后面的每一个新读者。所以准入（召回 + 重排）在语料锁外算完，进语料锁
 * 时核对语料还是不是同一版（见 `search/phrases.ts`）。
 *
 * 这几条自己起一个 schema：其中一条真的把整库换掉了，和别的用例共用种子的话，
 * 后面每一条断言都会莫名其妙地少几个人。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { EMBED_DIM } from "#/db/schema";
import { CANARY, fakeEmbedding, holdNextRerank, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 与 #/server/embed 在模块求值时就绑死了环境变量
const { search } = await import("#/search/search");
const { db, pool, withCorpusSnapshot } = await import("#/db");

const run = async (evidence: string) => {
	const outcome = await search({ evidence, scope: {}, notices: [] });
	if (outcome.order !== "relevance")
		throw new Error("要求查询未进入相关度路径");
	return outcome;
};

describe("语料快照", () => {
	/** 一次真发布：独占锁、整库重灌、重写 embedding_space 那一行，然后重新种。 */
	async function republish(rows: Parameters<typeof seed>[0]) {
		const writer = await pool.connect();
		try {
			await writer.query("begin");
			await writer.query("lock table embedding_space in access exclusive mode");
			await writer.query(
				"truncate experience, employee, phrase, embedding_space restart identity cascade",
			);
			await writer.query(
				`insert into embedding_space
					(space_id, model, dimension, canary_text, canary_embedding)
				 values ('fake-v1', 'fake', $1, $2, $3::halfvec)`,
				[EMBED_DIM, CANARY, `[${fakeEmbedding(CANARY).join(",")}]`],
			);
			await writer.query("commit");
		} finally {
			writer.release();
		}
		await seed(rows);
	}

	/** 那条连接是不是正等在一把锁上。 */
	async function waitingOnLock(pid: number) {
		for (let attempt = 0; attempt < 200; attempt++) {
			const state = await db.execute<{ waiting: boolean }>(sql`
				select wait_event_type = 'Lock' as waiting
				from pg_stat_activity where pid = ${pid}`);
			if (state.rows[0]?.waiting) return true;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		return false;
	}

	test("重排在飞行中时，整库重灌不必等它", async () => {
		await seed([
			{
				empId: "SNAP001",
				name: "快照测试",
				segments: [{ title: "快照一致性专用", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pending = run("快照一致性专用");
		await gate.entered;

		// 重排正卡在假端点里。这时候一次发布必须当场拿到独占锁：拿不到就说明
		// 模型调用被押在语料锁内，一次端点抖动会变成全站检索不可用。
		const writer = await pool.connect();
		try {
			await writer.query("begin");
			await writer.query("set local lock_timeout = '3s'");
			await writer.query("lock table embedding_space in access exclusive mode");
			await writer.query("rollback");
		} finally {
			writer.release();
		}

		gate.release();
		const result = await pending;
		assert.equal(result.results[0]?.employee.empId, "SNAP001");
	});

	test("重排跨过一次重灌时，结果不混版", async () => {
		await seed([
			{
				empId: "GEN001",
				name: "重灌前",
				segments: [{ title: "重灌专用", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pending = run("重灌专用");
		await gate.entered;
		// 整库重灌：`restart identity` 让 phrase 的 id 从头再来，于是上一版算出来的
		// 那批 id 现在指向的是别的说法。照着它取数会得到一份看起来完全正常的错名单。
		await republish([
			{
				empId: "GEN002",
				name: "重灌后",
				segments: [{ title: "另一种说法", months: 12 }],
			},
		]);
		gate.release();
		const result = await pending;
		assert.deepEqual(result.results, [], "旧 id 指到的新说法不算命中");
		assert.equal(result.total, 0);
	});

	test("一次快照里的多条语句只看得见一版语料", async () => {
		await seed([
			{
				empId: "ONEGEN",
				name: "一版语料",
				segments: [{ title: "单代读取专用", months: 12 }],
			},
		]);
		const count = (store: { execute: typeof db.execute }) =>
			store
				.execute<{ n: number }>(sql`select count(*)::int as n from experience`)
				.then((r) => r.rows[0]?.n);

		const writer = await pool.connect();
		try {
			const pid = (
				await writer.query<{ pid: number }>("select pg_backend_pid() as pid")
			).rows[0]?.pid;
			assert.ok(pid, "取不到测试写连接的 pid");
			// 发布事务在这次读取**中途**开始排队：语料锁已经被这次读取共享锁着，
			// 它只能等在门口。锁的顺序反过来的话，第二条语句会看见另一版语料。
			const locking: Promise<unknown>[] = [];
			await withCorpusSnapshot(async (store) => {
				const before = await count(store);
				await writer.query("begin");
				locking.push(
					writer.query("lock table embedding_space in access exclusive mode"),
				);
				assert.ok(await waitingOnLock(pid), "重灌应当排在这次读取后面");
				assert.equal(
					await count(store),
					before,
					"同一次快照里两次读取必须一致",
				);
			});
			await Promise.all(locking);
			await writer.query("rollback");
		} finally {
			writer.release();
		}
	});

	test("同一新词并发检索共享确定性缓存：分数只算一次", async () => {
		await seed([
			{
				empId: "CACHE001",
				name: "缓存并发测试",
				segments: [{ title: "缓存并发专用", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const first = run("缓存并发专用");
		await gate.entered;
		let secondError: unknown;
		try {
			const second = await run("缓存并发专用");
			assert.equal(second.results[0]?.employee.empId, "CACHE001");
		} catch (error) {
			secondError = error;
		} finally {
			gate.release();
		}
		const result = await first;
		if (secondError) throw secondError;
		assert.equal(result.results[0]?.employee.empId, "CACHE001");
		// 「共享」是这条测试的全部内容：两次检索算的是同一个确定的分数，
		// 落库时后到者被 on conflict 丢掉，一对文本在缓存里只占一行。
		const rows = await db.execute<{ n: number }>(sql`
			select count(*)::int as n from phrase_relevance
			where query = '缓存并发专用'
			group by phrase_id having count(*) > 1`);
		assert.deepEqual(rows.rows, [], "同一对文本不该在缓存里出现两行");
	});
});
