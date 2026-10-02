/** 召回表保留每条记录的身份、重复行和双精度相关度。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql } from "drizzle-orm";
import { setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { db } = await import("#/db");
const { phraseHitTable } = await import("#/search/phrases");

test("没有召回记录时不构造输入表", () => {
	assert.equal(phraseHitTable([]), null);
});

test("召回表完整保留列值对应关系、重复行和相关度精度", async () => {
	const rows = [
		{
			claimIdx: 0,
			valueIdx: 2,
			hit: { phraseId: 13, relevance: 0.1234567890123456 },
		},
		{
			claimIdx: 3,
			valueIdx: 1,
			hit: { phraseId: 7, relevance: 0.9876543210987654 },
		},
		{
			claimIdx: 0,
			valueIdx: 2,
			hit: { phraseId: 13, relevance: 0.1234567890123456 },
		},
	] as const;
	const table = phraseHitTable(rows);
	assert.ok(table);
	const result = await db.execute(sql`
		with q(claim_idx, value_idx, phrase_id, relevance) as ${table}
		select * from q order by claim_idx, value_idx, phrase_id, relevance`);
	assert.deepEqual(
		result.rows,
		[rows[0], rows[2], rows[1]].map((row) => ({
			claim_idx: row.claimIdx,
			value_idx: row.valueIdx,
			phrase_id: row.hit.phraseId,
			relevance: row.hit.relevance,
		})),
	);
});

test("大召回表保留所有输入记录", async () => {
	const rows = Array.from({ length: 18000 }, (_, i) => ({
		claimIdx: Math.floor(i / 6000),
		valueIdx: Math.floor(i / 1000) % 6,
		hit: { phraseId: i + 1, relevance: 0.75 },
	}));
	const table = phraseHitTable(rows);
	assert.ok(table);
	const result = await db.execute(sql`
		with q(claim_idx, value_idx, phrase_id, relevance) as ${table}
		select count(*)::int as n, min(phrase_id) as first, max(phrase_id) as last,
			count(distinct (claim_idx, value_idx))::int as groups from q`);
	assert.deepEqual(result.rows, [
		{ n: 18000, first: 1, last: 18000, groups: 18 },
	]);
});
