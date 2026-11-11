/** 人员条件与经历筛选各自的候选范围，使用合成档案和真实 SQL 验证。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Condition } from "#/search/condition";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { search } = await import("#/search/search");

await seed([
	{
		empId: "P1",
		name: "合成无经历",
		school: "合成大学",
		education: "本科",
		recruitment: "校招",
		curLevel: "P6",
		segments: [],
	},
	{
		empId: "P2",
		name: "合成待业",
		school: "合成大学",
		education: "硕士",
		recruitment: "校招",
		curLevel: "P7",
		segments: [{ kind: "external", unemployed: true, months: 6 }],
	},
	{
		empId: "P3",
		name: "合成任职",
		school: "合成大学",
		education: "硕士",
		recruitment: "社招",
		curLevel: "P7",
		segments: [{ title: "工程师", months: 12 }],
	},
	{
		empId: "P4",
		name: "合成其他学校",
		school: "另一大学",
		education: "博士",
		segments: [{ title: "工程师", months: 12 }],
	},
]);
const school: Condition = {
	about: "person",
	field: "school",
	mode: "must",
	values: ["合成大学"],
};
const find = (more: Condition[] = [], filters = {}) =>
	search({ conditions: [school, ...more] }, null, filters);
const ids = (result: Awaited<ReturnType<typeof find>>) =>
	result.results.map((row) => row.employee.empId);

test("人的条件不要求工作经历；人员分面含全部候选，经历分面只含实际工作经历", async () => {
	const result = await find();
	assert.deepEqual(ids(result), ["P1", "P2", "P3"]);
	assert.equal(result.total, 3);
	assert.deepEqual(
		result.facets.level.map((row) => [row.value, row.n]),
		[
			["P6", 1],
			["P7", 2],
		],
	);
	assert.equal(
		result.facets.education.find((row) => row.value === "硕士")?.n,
		2,
	);
	assert.deepEqual(result.facets.kind, [{ value: "internal", n: 1 }]);
	assert.equal(result.facets.minMonths.find((row) => row.value === 12)?.n, 1);
	assert.ok(!result.results.some((row) => "evidence" in row));
});

test("人员筛选保留无经历的人，经历筛选与背景门槛要求有效工作经历", async () => {
	assert.deepEqual(ids(await find([], { education: ["本科"] })), ["P1"]);
	assert.deepEqual(ids(await find([], { kind: "internal" })), ["P3"]);
	assert.deepEqual(ids(await find([], { minMonths: 12 })), ["P3"]);
	assert.equal((await find([], { kind: "external" })).total, 0);
	assert.deepEqual(
		ids(await find([{ about: "experience", mode: "must", kind: "internal" }])),
		["P3"],
	);
});

test("只有加分的人的条件时全部员工进入名单，满足偏好的在前", async () => {
	const result = await search(
		{
			conditions: [
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
	assert.deepEqual(ids(result), ["P2", "P3", "P1", "P4"]);
});

test("经历偏好只排序，不缩小人员候选；没有经历的人仍保留", async () => {
	const boost: Condition = {
		about: "experience",
		mode: "boost",
		what: ["工程师"],
	};
	const plain = await find();
	const boosted = await find([boost]);
	assert.deepEqual(new Set(ids(boosted)), new Set(ids(plain)));
	assert.equal(ids(boosted)[0], "P3");
	assert.deepEqual(boosted.facets, plain.facets);
	assert.deepEqual(ids(await find([boost], { education: ["本科"] })), ["P1"]);
	const everyone = await search({ conditions: [boost] }, null);
	assert.equal(everyone.total, 4);
	assert.equal(
		(
			await search(
				{ conditions: [{ ...boost, what: ["不存在的合成技能"] }] },
				null,
			)
		).total,
		4,
	);
});

test("排除按人生效：有那种经历的人不在名单上，没有经历的人不受影响", async () => {
	const exclude: Condition = {
		about: "experience",
		mode: "exclude",
		kind: "internal",
	};
	const result = await find([exclude]);
	assert.deepEqual(ids(result), ["P1", "P2"], "P3 有一段公司内任职");
	assert.deepEqual(result.facets.kind, []);
	assert.equal(
		(
			await find([
				exclude,
				{ about: "experience", mode: "must", kind: "internal" },
			])
		).total,
		0,
		"要有、又不能有同一种经历：没有这样的人",
	);
});
