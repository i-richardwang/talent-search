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
	search({ conditions: [school, ...more] }, filters);
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
	assert.ok(!result.results.some((row) => "hits" in row));
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
	const result = await search({
		conditions: [
			{ about: "person", mode: "boost", field: "education", values: ["硕士"] },
		],
	});
	assert.deepEqual(ids(result), ["P2", "P3", "P1", "P4"]);
});

test("排除仅否决经历，人员条件仍生效，被否决的段不参与筛选或背景门槛", async () => {
	const exclude: Condition = {
		about: "experience",
		mode: "exclude",
		kind: "internal",
	};
	const result = await find([exclude]);
	assert.deepEqual(ids(result), ["P1", "P2", "P3"]);
	assert.deepEqual(result.facets.kind, []);
	assert.equal((await find([exclude], { kind: "internal" })).total, 0);
	assert.equal(
		(
			await find([
				exclude,
				{ about: "experience", mode: "must", kind: "internal" },
			])
		).total,
		0,
	);
});
