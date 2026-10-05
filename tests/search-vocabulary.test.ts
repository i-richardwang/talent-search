/**
 * 检索按词表修正命中：写了细的人符合宽的要求，反过来不成立。词和关系都是合成的；
 * 假重排是字面重合，所以「爪哇编程」对「后端开发」一个字都不重合，只能顺着词表找到。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fakeRelevance, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { search } = await import("#/search/search");
const { RELEVANCE_MIN } = await import("#/search/weights");

before(async () => {
	const { db } = await import("#/db");
	const { term } = await import("#/db/schema");
	const person = (empId: string, skill: string) => ({
		empId,
		name: `合成${empId}`,
		segments: [
			{ kind: "external" as const, months: 24, extracted: { skills: [skill] } },
		],
	});
	await seed([
		person("V1", "后端开发"),
		person("V2", "服务端开发"),
		person("V3", "爪哇编程"),
		person("V4", "运营"),
		person("V5", "抖音运营"),
		person("V6", "快手运营"),
		person("V7", "SQL数据库"),
		person("V8", "数据库产品"),
		person("V9", "查询优化"),
	]);
	const reviewedAt = new Date();
	await db.insert(term).values([
		{ word: "后端开发", canonical: "后端开发", reviewedAt },
		{ word: "服务端开发", canonical: "后端开发", reviewedAt },
		{ word: "运营", canonical: "运营", reviewedAt },
		{ word: "数据库", canonical: "数据库", reviewedAt },
		{ word: "SQL数据库", canonical: "SQL数据库", reviewedAt },
	]);
	await db.insert(term).values([
		{ word: "爪哇编程", canonical: "爪哇编程", parent: "后端开发", reviewedAt },
		{ word: "抖音运营", canonical: "抖音运营", parent: "运营", reviewedAt },
		{ word: "快手运营", canonical: "快手运营", parent: "运营", reviewedAt },
		// 挂在别的分支上的一条归属：「数据库产品」属于「SQL数据库」
		{
			word: "数据库产品",
			canonical: "数据库产品",
			parent: "SQL数据库",
			reviewedAt,
		},
		{
			word: "查询优化",
			canonical: "查询优化",
			parent: "SQL数据库",
			reviewedAt,
		},
	]);
});

const found = async (what: string) =>
	(
		await search({
			conditions: [{ about: "experience", mode: "must", what: [what] }],
		})
	).results
		.map((r) => r.employee.empId)
		.sort();

describe("往下带", () => {
	test("其他写法和属于它的细词都算命中，相关度沿用命中的那个词", async () => {
		assert.equal(fakeRelevance("后端开发", "爪哇编程"), 0);
		assert.deepEqual(await found("后端开发"), ["V1", "V2", "V3"]);
		const result = await search({
			conditions: [{ about: "experience", mode: "must", what: ["后端开发"] }],
		});
		assert.equal(result.order, "evidence");
		if (result.order !== "evidence") return;
		const v3 = result.results.find((r) => r.employee.empId === "V3");
		assert.equal(v3?.hits[0]?.phrase, "爪哇编程", "证据是这个人自己的原话");
		assert.equal(v3?.hits[0]?.relevance, 1);
	});

	test("别的命中词下面的细词不跟着带：它和要找的谁宽谁细不知道", async () => {
		assert.ok(fakeRelevance("数据库", "SQL数据库") >= RELEVANCE_MIN);
		assert.equal(fakeRelevance("数据库", "查询优化"), 0);
		assert.ok(!(await found("数据库")).includes("V9"));
		assert.deepEqual(await found("SQL数据库"), ["V7", "V8", "V9"]);
	});
});

describe("往上挡", () => {
	test("比更对得上的命中词宽的词不算命中：只写了宽词的人没法确认做过细的那件", async () => {
		assert.ok(fakeRelevance("抖音运营", "运营") >= RELEVANCE_MIN);
		assert.deepEqual(await found("抖音运营"), ["V5"]);
	});

	test("要找的词不在词表里时，最对得上的命中词代表它的位置", async () => {
		assert.ok(fakeRelevance("抖音的运营", "运营") >= RELEVANCE_MIN);
		assert.deepEqual(await found("抖音的运营"), ["V5"]);
	});

	test("只挡要找的词往上的那条线：别的分支上子词得分高过上级，上级照样算命中", async () => {
		assert.ok(
			fakeRelevance("数据库", "数据库产品") >
				fakeRelevance("数据库", "SQL数据库"),
		);
		assert.ok(fakeRelevance("数据库", "SQL数据库") >= RELEVANCE_MIN);
		assert.deepEqual(await found("数据库"), ["V7", "V8"]);
	});

	test("搜的就是宽词时它不被挡，细词照常带上", async () => {
		assert.deepEqual(await found("运营"), ["V4", "V5", "V6"]);
	});
});
