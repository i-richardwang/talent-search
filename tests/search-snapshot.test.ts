/**
 * 语料快照。
 *
 * 语料是增量长的（派生一批一批地提交、同步一笔事务增删），一次跨语句读取仍然
 * 只许看见一个整体；而**模型调用不许押着快照**——快照占着池里的一条连接，一次
 * 慢端点会耗光连接池。所以准入（召回 + 重排）在快照外算完，进快照时核对嵌入空间
 * 还是不是同一个（见 `search/phrases.ts`）。
 *
 * 这几条自己起一个 schema：其中一条真的把说法表整张换掉了，和别的用例共用种子的话，
 * 后面每一条断言都会莫名其妙地少几个人。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { EMBED_DIM } from "#/db/schema";
import { parseQuery } from "#/search/query-syntax";
import { CANARY, fakeEmbedding, holdNextRerank, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 与 #/server/embed 在模块求值时就绑死了环境变量
const { search } = await import("#/search/search");
const { db, pool, withCorpusSnapshot } = await import("#/db");

const run = async (query: string) => {
	const outcome = await search({ terms: parseQuery(query) });
	if (outcome.order !== "relevance")
		throw new Error("要求查询未进入相关度路径");
	return outcome;
};

describe("语料快照", () => {
	/** 换嵌入空间那一下（`corpus/derive.ts` 的 `ensureSpace`）：说法整张作废、身份证重写，然后重新种。 */
	async function switchSpace(rows: Parameters<typeof seed>[0]) {
		const writer = await pool.connect();
		try {
			await writer.query("begin");
			await writer.query("truncate phrase restart identity cascade");
			await writer.query("delete from embedding_space");
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

	/** 一笔写者的短事务：加一个人一段经历。派生和同步落库都是这种事务。 */
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

	test("重排在飞行中时，写者的一笔提交不必等它", async () => {
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

		// 重排正卡在假端点里。这时候一笔写必须当场提交：提交不了就说明
		// 模型调用被押在快照内，快照又押着什么锁，一次端点抖动会变成写者全停。
		await writeOne("SNAP002");

		gate.release();
		const result = await pending;
		assert.equal(result.results[0]?.employee.empId, "SNAP001");
	});

	test("重排跨过一次换嵌入空间时，结果不混版", async () => {
		await seed([
			{
				empId: "GEN001",
				name: "换空间前",
				segments: [{ title: "换空间专用", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pending = run("换空间专用");
		await gate.entered;
		// `restart identity` 让 phrase 的 id 从头再来，于是上一版算出来的
		// 那批 id 现在指向的是别的说法。照着它取数会得到一份看起来完全正常的错名单。
		await switchSpace([
			{
				empId: "GEN002",
				name: "换空间后",
				segments: [{ title: "另一种说法", months: 12 }],
			},
		]);
		gate.release();
		const result = await pending;
		assert.deepEqual(result.results, [], "旧 id 指到的新说法不算命中");
		assert.equal(result.total, 0);
	});

	test("一次快照里的多条语句只看得见一个整体", async () => {
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

		// 写者在这次读取**中途**提交了一笔。快照是事务开头拍的，第二条语句看到的
		// 仍然是那一张；读提交隔离下它会看见多出来的那一段。
		let before: number | undefined;
		await withCorpusSnapshot(async (store) => {
			before = await count(store);
			await writeOne("ONEGEN2");
			assert.equal(await count(store), before, "同一次快照里两次读取必须一致");
		});
		assert.equal(await count(db), (before ?? 0) + 1, "快照之外看得见那一笔");
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
