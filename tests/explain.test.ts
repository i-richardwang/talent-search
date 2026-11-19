/**
 * 搜索条件的详情照真正执行的条件解析：设计系统里展示的每个样例，都是这里解析出来的样子；
 * 「且」「或」展开成几种之一，同一属性的「或」并成一行，翻不出来的部分明说说不清楚。
 * 只解析语法树，不连数据库。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { QueryCondition } from "#/search/query";
import { explainCondition } from "#/server/explain";
import { EXPLAIN_SAMPLES } from "../scripts/design-system/preview/samples/explain";

const STREAMS = new Map([
	["perf", "绩效"],
	["level", "职级"],
]);

const experience = (
	where: string,
	params: QueryCondition["params"] = {},
): QueryCondition => ({
	from: "experience",
	id: "c",
	label: "条件",
	mode: "must",
	params,
	where,
});

describe("设计系统的样例", () => {
	for (const sample of EXPLAIN_SAMPLES)
		test(sample.title, async () => {
			assert.deepEqual(
				await explainCondition(sample.condition, STREAMS),
				sample.explained,
			);
		});
});

describe("展开", () => {
	test("且里套或：来源成为每一种的抬头，或拆成几种", async () => {
		const { options } = await explainCondition(
			experience(
				"e.kind = 'internal' and (e.seq_l1 = '运营' or e.title ilike :t)",
				{ t: "%运营%" },
			),
			STREAMS,
		);
		assert.deepEqual(options, [
			{
				lead: "公司内经历",
				rows: [{ field: "序列", kind: "fact", value: [{ tag: "运营" }] }],
			},
			{
				lead: "公司内经历",
				rows: [
					{
						field: "岗位",
						kind: "fact",
						value: [{ word: "含" }, { tag: "运营" }],
					},
				],
			},
		]);
	});

	test("否定的比较不并成一行", async () => {
		const { options } = await explainCondition(
			experience("e.title not ilike '%实习%' or e.title not ilike '%外包%'"),
			STREAMS,
		);
		assert.equal(options.length, 2);
	});

	test("翻不出来的部分说不清楚，不露出写法", async () => {
		const { options } = await explainCondition(
			experience("length(e.title) > 4"),
			STREAMS,
		);
		assert.deepEqual(options, [{ lead: null, rows: [{ kind: "unclear" }] }]);
	});

	test("人的档比档高：职级 P7 及以上", async () => {
		const { options } = await explainCondition(
			{
				from: "person",
				id: "c",
				label: "条件",
				mode: "must",
				params: { band: "P7" },
				where:
					"p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)",
			},
			STREAMS,
		);
		assert.deepEqual(options, [
			{
				lead: null,
				rows: [
					{
						field: "职级",
						kind: "fact",
						value: [{ tag: "P7" }, { word: "及以上" }],
					},
				],
			},
		]);
	});
});
