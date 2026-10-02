/** 名称视图筛选与背景、人员门槛共用匹配规则，排除只否决经历段。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Condition, ExperienceCondition } from "#/search/condition";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { search } = await import("#/search/search");

await seed([
	{
		empId: "N1",
		name: "合成保留经历",
		school: "合成大学_%",
		segments: [
			{ title: "工程师", org: "合成保留公司", kind: "external", months: 12 },
			{ title: "工程师", org: "合成排除公司", kind: "external", months: 6 },
			{
				title: "工程师",
				org: "合成部门",
				orgPath: "合成总部/合成排除部门",
				months: 12,
			},
		],
	},
	{
		empId: "N2",
		name: "合成全部否决",
		school: "合成大学_%",
		segments: [{ title: "工程师", org: "合成排除公司", months: 12 }],
	},
	{
		empId: "N3",
		name: "合成相近校名",
		school: "合成大学甲乙",
		segments: [{ title: "工程师", org: "合成其他公司", months: 12 }],
	},
	{ empId: "N4", name: "合成无经历", school: "合成大学_%", segments: [] },
	{
		empId: "N5",
		name: "合成待业",
		school: "合成大学_%",
		segments: [
			{ unemployed: true, kind: "external", org: "合成排除公司", months: 12 },
		],
	},
]);

const exclude: Condition = {
	about: "experience",
	mode: "exclude",
	org: ["合成排除"],
};
const ids = (result: Awaited<ReturnType<typeof search>>) =>
	result.results.map((row) => row.employee.empId);

for (const [name, base] of [
	[
		"人员查询",
		{ about: "person", mode: "must", field: "school", values: ["合成大学"] },
	],
	["经历查询", { about: "experience", mode: "must", what: ["工程师"] }],
] as const satisfies readonly (readonly [string, Condition])[]) {
	test(`${name}的公司筛选与背景门槛一致，被否决公司或部门不提供筛选依据`, async () => {
		for (const [org, expected] of [
			[["合成排除公司"], []],
			[["合成排除部门"], []],
			[["合成保留公司"], ["N1"]],
			[["合成排除公司", "合成保留公司"], ["N1"]],
		] as const) {
			const conditions = [base, exclude];
			const view = await search({ conditions }, { org });
			const gate = await search({
				conditions: [
					...conditions,
					{
						about: "experience",
						mode: "must",
						org,
					} satisfies ExperienceCondition,
				],
			});
			assert.deepEqual(ids(view), expected);
			assert.equal(view.total, expected.length);
			assert.deepEqual(ids(view), ids(gate));
			assert.deepEqual(view.facets, gate.facets);
		}
	});

	test(`${name}的学校筛选与人员门槛一致，百分号和下划线按字面匹配`, async () => {
		const conditions = [base, exclude];
		const view = await search({ conditions }, { school: ["合成大学_%"] });
		const gate = await search({
			conditions: [
				...conditions,
				{
					about: "person",
					mode: "must",
					field: "school",
					values: ["合成大学_%"],
				},
			],
		});
		assert.deepEqual(
			ids(view),
			name === "人员查询" ? ["N1", "N2", "N4", "N5"] : ["N1"],
		);
		assert.deepEqual(ids(view), ids(gate));
		assert.deepEqual(view.facets, gate.facets);
	});
}
