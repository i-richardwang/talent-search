/** 嵌入端点没配：解析照常，整理不收集要判的词，已经判过的照常生效。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { answerChat, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
// 端点配置在模块求值时读，得在加载服务端模块之前去掉
delete process.env.EMBED_BASE_URL;

const { derive } = await import("#/corpus/derive");
const { review } = await import("#/corpus/review");
const { guideIdentity } = await import("#/corpus/vocabulary");
const { pool } = await import("#/db");

test("解析不需要嵌入端点", async () => {
	await seed([
		{
			empId: "E1",
			name: "合成解析",
			segments: [
				{ kind: "external", title: "分析师", description: "样例", months: 12 },
			],
		},
	]);
	const restore = answerChat(() => ({ items: [] }));
	const client = await pool.connect();
	try {
		assert.deepEqual(
			await derive(
				{ client, release: async () => client.release() },
				() => {},
				10_000,
			),
			{ done: 1, left: 0 },
		);
	} finally {
		client.release();
		restore();
	}
});

test("整理说出没法收集，队列里判过的词照常生效", async () => {
	await seed(
		["U1", "U2", "U3"].map((empId) => ({
			empId,
			name: "合成整理",
			segments: [
				{
					kind: "external" as const,
					months: 12,
					extracted: { skills: ["合成能力", "合成能力工作"] },
				},
			],
		})),
	);
	await pool.query(
		`insert into review_word (guide_identity, word, people, near, judge, judgment) values (
			$1, '合成能力工作', 3, '[{"word":"合成能力","people":3}]'::jsonb, 'agent:test',
			'{"why":"同义","kind":"同一件事","target":"合成能力"}'::jsonb)`,
		[guideIdentity()],
	);
	const said: string[] = [];
	await review(pool, (line) => said.push(line), "external", null);
	assert.match(said.join("\n"), /未配置嵌入端点/);
	const { rows } = await pool.query<{ word: string; canonical: string }>(
		"select word, canonical from term order by word",
	);
	assert.deepEqual(rows, [
		{ word: "合成能力", canonical: "合成能力" },
		{ word: "合成能力工作", canonical: "合成能力" },
	]);
	const queued = await pool.query("select 1 from review_word");
	assert.equal(queued.rowCount, 0);
});
