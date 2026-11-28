/** 载荷上限针对实际参与检索的事实，被排除的人的经历不占用载荷。 */
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { sql } from "drizzle-orm";
import { FACT_MAX } from "#/search/weights";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { db } = await import("#/db");
const { search } = await import("#/search/search");

/**
 * 成批写进来之后更新统计信息，和生产的表由 autovacuum 维护一样：读取策略让执行计划依赖它，
 * 统计信息停在写入之前的表会选出慢得多的计划。
 */
async function analyze() {
	await db.execute(
		sql`insert into employment(person_id,emp_id) select person_id,person_id from person on conflict do nothing`,
	);
	await db.execute(sql`analyze person,employment,experience,experience_phrase`);
}

beforeEach(async () => {
	await db.execute(sql`truncate person, phrase restart identity cascade`);
});

// 计时包含批量写入合成数据和更新数据库统计信息。
const capacity = { timeout: 20_000 };

test("被排除的经历不占候选事实额度", capacity, async () => {
	await seed([
		{
			personId: "C1",
			name: "合成被排除",
			segments: [
				{ kind: "external", title: "工程师", company: "排除部门", months: 12 },
			],
		},
		{
			personId: "C2",
			name: "合成有效",
			segments: [
				{ kind: "external", title: "工程师", company: "保留部门", months: 12 },
			],
		},
	]);
	await db.execute(sql`with added as (
		insert into experience (person_id, kind, start_date, title, company, months)
		select 'C1', 'external', date '1000-01-01' + n, '工程师', '排除部门', 1
		from generate_series(1, ${FACT_MAX}) n returning id)
		insert into experience_phrase (experience_id, route, phrase_id)
		select a.id, 'title', p.id from added a cross join phrase p where p.text = '工程师'`);
	await analyze();
	const result = await search(
		{
			conditions: [
				{ about: "experience", mode: "must", what: ["工程师"] },
				{ about: "experience", mode: "exclude", company: ["排除部门"] },
			],
		},
		null,
	);
	assert.equal(result.total, 1);
	assert.equal(result.empty, null);
	assert.deepEqual(
		result.results.map((row) => row.employee.personId),
		["C2"],
	);
});

test("加分门槛支持超过单语句参数上限的人员候选", capacity, async () => {
	await db.execute(sql`insert into person (person_id, name, school, education_level, education_rank)
		select 'S' || lpad(n::text, 5, '0'), '合成大候选', '合成大学',
			case when n % 2 = 0 then '硕士' else '本科' end,
			case when n % 2 = 0 then 4 else 3 end
		from generate_series(1, 66000) n`);
	await db.execute(sql`insert into experience (person_id, kind, start_date, department, months)
		values ('S00002', 'internal', date '2000-01-01', '合成偏好部门', 12)`);
	await analyze();
	const required = {
		about: "person",
		mode: "must",
		field: "school",
		values: ["合成大学"],
	} as const;
	const baseline = await search({ conditions: [required] }, null);
	assert.equal(baseline.total, 66000);
	assert.equal(baseline.results[0]?.employee.personId, "S00001");
	const boosted = await search(
		{
			conditions: [
				required,
				{
					about: "person",
					mode: "boost",
					field: "education",
					values: ["硕士"],
				},
			],
		},
		null,
	);
	assert.equal(boosted.total, baseline.total);
	assert.equal(boosted.empty, null);
	assert.equal(boosted.results[0]?.employee.personId, "S00002");
	assert.equal(boosted.results[1]?.employee.personId, "S00004");
	assert.deepEqual(boosted.facets, baseline.facets);
	const background = await search(
		{
			conditions: [
				required,
				{ about: "experience", mode: "boost", department: ["合成偏好部门"] },
			],
		},
		null,
	);
	assert.equal(background.total, baseline.total);
	assert.equal(background.empty, null);
	assert.equal(background.results[0]?.employee.personId, "S00002");
	assert.equal(background.results[1]?.employee.personId, "S00001");
	assert.deepEqual(background.facets, baseline.facets);
});

test("加分门槛支持超过单语句参数上限的候选经历", capacity, async () => {
	await seed([
		{
			personId: "S00001",
			name: "合成大候选",
			education: "本科",
			segments: [
				{
					kind: "external",
					title: "工程师",
					company: "合成普通公司",
					months: 12,
				},
			],
		},
	]);
	await db.execute(sql`insert into person (person_id, name, education_level, education_rank)
		select 'S' || lpad(n::text, 5, '0'), '合成大候选',
			case when n % 2 = 0 then '硕士' else '本科' end,
			case when n % 2 = 0 then 4 else 3 end
		from generate_series(2, 66000) n`);
	await db.execute(sql`with added as (
		insert into experience (person_id, kind, start_date, title, company, months)
		select 'S' || lpad(n::text, 5, '0'), 'external', date '2000-01-01', '工程师',
			'合成普通公司', 12
		from generate_series(2, 66000) n returning id)
		insert into experience_phrase (experience_id, route, phrase_id)
		select a.id, 'title', p.id from added a cross join phrase p where p.text = '工程师'`);
	await analyze();
	const required = {
		about: "experience",
		mode: "must",
		what: ["工程师"],
	} as const;
	const baseline = await search({ conditions: [required] }, null);
	assert.equal(baseline.total, 66000);
	assert.equal(baseline.results[0]?.employee.personId, "S00001");
	const boosted = await search(
		{
			conditions: [
				required,
				{
					about: "person",
					mode: "boost",
					field: "education",
					values: ["硕士"],
				},
			],
		},
		null,
	);
	assert.equal(boosted.total, baseline.total);
	assert.equal(boosted.empty, null);
	assert.equal(boosted.results[0]?.employee.personId, "S00002");
	assert.equal(boosted.results[1]?.employee.personId, "S00004");
	assert.deepEqual(boosted.facets, baseline.facets);
});
