/** 目录的完整取值与人数；临时 schema 中只写合成公司、行业和经历。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { seed, seedCompanies, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { db } = await import("#/db");
const { experience } = await import("#/db/schema");
const { companyFacts, discover } = await import("#/server/discover");

test("行业树、目录取值和提示词人数完整一致，超过一百项也不丢失", async () => {
	const names = Array.from(
		{ length: 101 },
		(_, i) => `合成行业${String(i).padStart(3, "0")}`,
	);
	await seed(
		names.map((_, i) => ({
			empId: `IND${i}`,
			name: `合成样例${i}`,
			segments: [],
		})),
	);
	await seedCompanies(
		Object.fromEntries(names.map((name) => [name, null])),
		names.map((name, i) => ({
			name: `合成公司${i}`,
			industries: [name],
			mainIndustries: [name],
		})),
	);
	await db.insert(experience).values(
		names.map((_, i) => ({
			empId: `IND${i}`,
			kind: "external" as const,
			company: `合成公司${i}`,
			startDate: "2020-01-01",
			endDate: "2021-01-01",
			months: 12,
		})),
	);
	const facts = await companyFacts();
	assert.equal(facts.industries.length, names.length);
	assert.equal(facts.recognized, names.length);
	for (const column of ["main_industries", "industries"]) {
		const found = await discover({ relation: "experience", column });
		if (found.kind !== "values") throw new Error("该是一列取值");
		assert.deepEqual(found.values.map((v) => v.name).toSorted(), names);
		assert.ok(found.values.every((v) => v.people === 1));
	}
	assert.ok(facts.industries.every((i) => i.main === 1 && i.any === 1));
});
