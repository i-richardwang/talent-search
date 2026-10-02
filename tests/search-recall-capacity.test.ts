/** 大召回集合在事实、否决和查词三条路径中保持完整语义。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { conditionsOf } from "#/search/condition";
import { RECALL_TOP } from "#/search/weights";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { search, findTerms } = await import("#/search/search");
const skills = Array.from(
	{ length: RECALL_TOP },
	(_, i) => "工程师".repeat(6) + i,
);
await seed(
	Array.from({ length: 6 }, (_, i) => ({
		empId: `R${i + 1}`,
		name: "合成召回候选",
		school: "合成大学",
		segments:
			i === 0
				? skills.map((skill) => ({
						months: 12,
						title: skill,
						org: "合成保留公司",
						extracted: { skills: [skill] },
					}))
				: [
						{
							months: 12,
							org: i === 5 ? "合成排除公司" : "合成保留公司",
							extracted: { skills },
						},
					],
	})),
);

const groups = ["工程师", "师工程", "程师工"].map((word) =>
	Array.from({ length: 6 }, (_, i) => word.repeat(i + 1)),
);
const ids = (result: Awaited<ReturnType<typeof search>>) =>
	result.results.map((row) => row.employee.empId);

test("合法多主张的大召回集合保留名单、分面和逐条证据", async () => {
	const conditions = conditionsOf(
		groups.map((what, i) => ({
			about: "experience",
			mode: "must",
			what,
			minMonths: i + 1,
		})),
	);
	assert.equal(conditions.length, 3);
	const first = conditions[0];
	assert.ok(first);
	const baseline = await search({ conditions: [first] });
	const result = await search({ conditions });
	assert.equal(result.total, 6);
	assert.equal(result.empty, null);
	assert.deepEqual(ids(result), ["R1", "R2", "R3", "R4", "R5", "R6"]);
	assert.deepEqual(ids(result), ids(baseline));
	assert.deepEqual(result.facets, baseline.facets);
	assert.equal(result.order, "evidence");
	if (result.order !== "evidence") return;
	for (const person of result.results) {
		assert.equal(person.basis.length, 3);
		assert.ok(
			person.basis.every(
				(basis) =>
					basis?.months === (person.employee.empId === "R1" ? 12000 : 12),
			),
		);
		assert.deepEqual(
			new Set(person.hits.map((hit) => hit.claim)),
			new Set([0, 1, 2]),
		);
	}
});

test("多个排除主张的大召回集合完整否决指定经历", async () => {
	const excludes = conditionsOf(
		groups.map((what, i) => ({
			about: "experience",
			mode: "exclude",
			what,
			org: ["合成排除公司"],
			minMonths: i + 1,
		})),
	);
	assert.equal(excludes.length, 3);
	const result = await search(
		{
			conditions: [
				{
					about: "person",
					mode: "must",
					field: "school",
					values: ["合成大学"],
				},
				...excludes,
			],
		},
		{ org: ["合成排除公司"] },
	);
	assert.equal(result.total, 0);
	const retained = await search({
		conditions: [
			{ about: "experience", mode: "must", what: ["工程师"] },
			...excludes,
		],
	});
	assert.equal(retained.total, 5);
	assert.deepEqual(ids(retained), ["R1", "R2", "R3", "R4", "R5"]);
});

test("提交条件查词的大召回集合完整统计人数并返回人才库写法", async () => {
	const texts = groups.flat();
	const findings = await findTerms(texts);
	assert.equal(findings.length, 18);
	assert.deepEqual(
		findings.map((finding) => finding.text),
		texts,
	);
	for (const finding of findings) {
		assert.equal(finding.people, 6);
		assert.equal(finding.wide, true);
		assert.equal(finding.terms.length, 8);
		assert.ok(
			finding.terms.every(
				(term) => term.people === 6 && skills.includes(term.name),
			),
		);
	}
});
