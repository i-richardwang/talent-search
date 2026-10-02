/** 载荷上限针对实际参与检索的事实，被否决的经历不占用载荷。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql } from "drizzle-orm";
import { FACT_MAX } from "#/search/weights";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { db } = await import("#/db");
const { search } = await import("#/search/search");

test("超过事实载荷上限的被否决段不导致有效候选溢出", async () => {
	await seed([
		{
			empId: "C1",
			name: "合成被否决",
			segments: [{ title: "工程师", org: "排除部门", months: 12 }],
		},
		{
			empId: "C2",
			name: "合成有效",
			segments: [{ title: "工程师", org: "保留部门", months: 12 }],
		},
	]);
	await db.execute(sql`with added as (
		insert into experience (emp_id, kind, start_date, title, org, months)
		select 'C1', 'internal', date '1000-01-01' + n, '工程师', '排除部门', 1
		from generate_series(1, ${FACT_MAX}) n returning id)
		insert into experience_phrase (experience_id, route, phrase_id)
		select a.id, 'title', p.id from added a cross join phrase p where p.text = '工程师'`);
	const result = await search({
		conditions: [
			{ about: "experience", mode: "must", what: ["工程师"] },
			{ about: "experience", mode: "exclude", org: ["排除部门"] },
		],
	});
	assert.equal(result.total, 1);
	assert.equal(result.empty, null);
	assert.deepEqual(
		result.results.map((row) => row.employee.empId),
		["C2"],
	);
});
