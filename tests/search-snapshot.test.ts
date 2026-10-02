/**
 * 语料快照。
 *
 * 语料是增量长的（派生一批一批地提交、同步一笔事务增删），一次跨语句读取仍然
 * 只能看见一个整体；而**模型调用不能占用快照**——快照占着池里的一条连接，一次
 * 慢端点会耗光连接池。所以重排在快照外完成，取事实的快照核对嵌入空间，重新召回
 * 并核对当前候选文本对应的分数（见 `search/phrases.ts`）。
 *
 * 这几条自己起一个 schema：其中一条真的把说法表整张换掉了，和别的用例共用种子的话，
 * 后面每一条断言都会莫名其妙地少几个人。
 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { sql } from "drizzle-orm";
import { EMBED_DIM } from "#/db/schema";
import { parseQuery } from "#/search/query-syntax";
import {
	CANARY,
	fakeEmbedding,
	holdNextEmbedding,
	holdNextRerank,
	seed,
	setup,
} from "./fixture";

const teardown = await setup();
after(teardown);

// import 必须在 setup() 之后：#/db 与 #/server/embed 在模块求值时就绑死了环境变量
const { search } = await import("#/search/search");
const { db, pool } = await import("#/db");
const { withCorpusSnapshot } = await import("#/db/snapshot");

const run = async (query: string) => {
	const outcome = await search({ conditions: parseQuery(query) });
	if (outcome.order === "employee")
		throw new Error("要求查询得有经历主张，只有人的条件排不出名次");
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

	test("重排还在进行时，写者的一笔提交不必等它", async () => {
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
		// 模型调用被放在快照内、而快照又持有锁，一次端点变慢就会让所有写者停下。
		await writeOne("SNAP002");

		gate.release();
		const result = await pending;
		assert.equal(result.results[0]?.employee.empId, "SNAP001");
	});

	test("重排期间换了嵌入空间时，结果不混用两个版本", async () => {
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

	test("同一输入并发检索共享首个落库分数", async () => {
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
		const rows = await db.execute<{ n: number }>(sql`
			select count(*)::int as n from rerank_cache
			where query = '缓存并发专用'
			group by document_sha having count(*) > 1`);
		assert.deepEqual(rows.rows, [], "同一对文本不该在缓存里出现两行");
	});
});

describe("模型调用期间的语料变化", () => {
	test("删除候选说法后正常读取当前语料，不向已删除的行写缓存", async () => {
		await seed([
			{
				empId: "DELETE001",
				name: "合成删除",
				segments: [{ title: "删除竞态验证", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pending = run("删除竞态验证");
		await gate.entered;
		const { prunePhrases } = await import("#/corpus/derive");
		const writer = await pool.connect();
		try {
			await writer.query("begin");
			await writer.query("delete from employee where emp_id = 'DELETE001'");
			await prunePhrases(writer);
			await writer.query("commit");
		} finally {
			writer.release();
			gate.release();
		}
		const result = await pending;
		assert.ok(!result.results.some((r) => r.employee.empId === "DELETE001"));
	});

	test("释义在重排期间改变时，按当前完整文本重新判定", async () => {
		const word = "释义竞态验证";
		await seed([
			{
				empId: "GLOSS001",
				name: "合成释义",
				segments: [{ title: word, months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pending = run(word);
		await gate.entered;
		const { applyGlosses, glossIdentity } = await import("#/corpus/gloss");
		const writer = await pool.connect();
		try {
			await writer.query(
				"insert into review_group (kind, guide_identity, words, judge, judgment) values ($1,$2,$3,$4,$5)",
				[
					"gloss",
					glossIdentity(),
					JSON.stringify([{ word, people: 1 }]),
					"agent:test",
					JSON.stringify({
						judgments: [
							{ word, gloss: "厨房烹饪面点餐饮厨师烘焙宴席糕点蔬菜汤羹配菜" },
						],
					}),
				],
			);
			await applyGlosses(writer, () => {});
		} finally {
			writer.release();
			gate.release();
		}
		const result = await pending;
		assert.ok(!result.results.some((r) => r.employee.empId === "GLOSS001"));
		assert.ok(
			!(await run(word)).results.some((r) => r.employee.empId === "GLOSS001"),
		);
	});

	test("新增说法进入当前召回时，也在同一份取数快照中参与检索", async () => {
		await seed([
			{
				empId: "NEWPHRASE1",
				name: "合成原说法",
				segments: [{ title: "新说法验证", months: 12 }],
			},
		]);
		const gate = holdNextRerank();
		const pending = run("新说法验证");
		await gate.entered;
		try {
			await seed([
				{
					empId: "NEWPHRASE2",
					name: "合成新说法",
					segments: [{ title: "新说法验证师", months: 12 }],
				},
			]);
		} finally {
			gate.release();
		}
		const ids = (await pending).results.map((r) => r.employee.empId);
		assert.ok(ids.includes("NEWPHRASE1"));
		assert.ok(ids.includes("NEWPHRASE2"));
	});
});

test("查询向量生成后首份快照前换空间，旧向量不能在新语料中使用", async () => {
	const gate = holdNextEmbedding();
	const reading = run("首份快照空间核验");
	const rejected = assert.rejects(reading, /与语料 .* 不一致/);
	await gate.entered;
	try {
		await db.execute(sql`update embedding_space set space_id = 'fake-v2'`);
	} finally {
		gate.release();
	}
	try {
		await rejected;
	} finally {
		await db.execute(sql`update embedding_space set space_id = 'fake-v1'`);
	}
});
