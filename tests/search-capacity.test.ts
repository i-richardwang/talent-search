/** 载荷上限针对实际参与检索的事实，被否决的经历不占用载荷。 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { FACT_MAX } from "#/search/weights";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { db } = await import("#/db");
const { search } = await import("#/search/search");

beforeEach(async () => {
	await db.execute(sql`truncate employee, phrase restart identity cascade`);
});

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

test("人员候选超过单语句参数上限时，加分门槛保留全部人员并正确排序", async () => {
	await db.execute(sql`insert into employee (emp_id, name, school, education_level, education_rank)
		select 'S' || lpad(n::text, 5, '0'), '合成大候选', '合成大学',
			case when n % 2 = 0 then '硕士' else '本科' end,
			case when n % 2 = 0 then 4 else 3 end
		from generate_series(1, 66000) n`);
	await db.execute(sql`insert into experience (emp_id, kind, start_date, org, months)
		values ('S00002', 'internal', date '2000-01-01', '合成偏好公司', 12)`);
	const required = {
		about: "person",
		mode: "must",
		field: "school",
		values: ["合成大学"],
	} as const;
	const baseline = await search({ conditions: [required] });
	assert.equal(baseline.total, 66000);
	assert.equal(baseline.results[0]?.employee.empId, "S00001");
	const boosted = await search({
		conditions: [
			required,
			{ about: "person", mode: "boost", field: "education", values: ["硕士"] },
		],
	});
	assert.equal(boosted.total, baseline.total);
	assert.equal(boosted.empty, null);
	assert.equal(boosted.results[0]?.employee.empId, "S00002");
	assert.equal(boosted.results[1]?.employee.empId, "S00004");
	assert.deepEqual(boosted.facets, baseline.facets);
	const background = await search({
		conditions: [
			required,
			{ about: "experience", mode: "boost", org: ["合成偏好公司"] },
		],
	});
	assert.equal(background.total, baseline.total);
	assert.equal(background.empty, null);
	assert.equal(background.results[0]?.employee.empId, "S00002");
	assert.equal(background.results[1]?.employee.empId, "S00001");
	assert.deepEqual(background.facets, baseline.facets);
});

test("经历候选超过单语句参数上限时，加分门槛保留全部证据并正确排序", async () => {
	await seed([
		{
			empId: "S00001",
			name: "合成大候选",
			education: "本科",
			segments: [{ title: "工程师", org: "合成普通公司", months: 12 }],
		},
	]);
	await db.execute(sql`insert into employee (emp_id, name, education_level, education_rank)
		select 'S' || lpad(n::text, 5, '0'), '合成大候选',
			case when n % 2 = 0 then '硕士' else '本科' end,
			case when n % 2 = 0 then 4 else 3 end
		from generate_series(2, 66000) n`);
	await db.execute(sql`with added as (
		insert into experience (emp_id, kind, start_date, title, org, months)
		select 'S' || lpad(n::text, 5, '0'), 'internal', date '2000-01-01', '工程师',
			'合成普通公司', 12
		from generate_series(2, 66000) n returning id)
		insert into experience_phrase (experience_id, route, phrase_id)
		select a.id, 'title', p.id from added a cross join phrase p where p.text = '工程师'`);
	const required = {
		about: "experience",
		mode: "must",
		what: ["工程师"],
	} as const;
	const baseline = await search({ conditions: [required] });
	assert.equal(baseline.total, 66000);
	assert.equal(baseline.results[0]?.employee.empId, "S00001");
	const boosted = await search({
		conditions: [
			required,
			{ about: "person", mode: "boost", field: "education", values: ["硕士"] },
		],
	});
	assert.equal(boosted.total, baseline.total);
	assert.equal(boosted.empty, null);
	assert.equal(boosted.results[0]?.employee.empId, "S00002");
	assert.equal(boosted.results[1]?.employee.empId, "S00004");
	assert.deepEqual(boosted.facets, baseline.facets);
});
