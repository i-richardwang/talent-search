/**
 * 人口覆盖宽度：按人量，在查询理解落库前**可见地**停用，成因记在 `off` 上。
 *
 * 一条主张的几个经历词同权：宽的那个丢掉，其余照常找人；全宽才说明这条
 * 主张几乎不筛人，整条停用、成因写成 `off: "wide"`，用户看得见、能换词、
 * 也能坚持启用。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { answering, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { createTurn, resolveTurn } = await import("#/server/turn");

before(async () => {
	await seed([
		...Array.from({ length: 9 }, (_, i) => ({
			empId: `W${i}`,
			name: `宽${i}`,
			segments: [
				{ seqL2: "灵能驾驶", months: 12 },
				{ seqL2: "星际外交", months: 12 },
			],
		})),
		{
			empId: "W9",
			name: "窄",
			segments: [{ seqL2: "机甲算法", months: 12 }],
		},
		{
			empId: "W10",
			name: "囤段",
			segments: Array.from({ length: 5 }, () => ({
				seqL2: "幽冥测绘",
				months: 6,
			})),
		},
	]);
});

async function sentence(text: string) {
	const { turnId } = await createTurn({ kind: "sentence", text });
	return resolveTurn(turnId);
}

describe("太宽的词在理解时停用", () => {
	test("超过占比的词整条停用，成因是 wide；别的词照常参与", async () => {
		const spec = await sentence("灵能驾驶, 机甲算法");
		assert.deepEqual(spec.conditions, [
			{ about: "experience", mode: "must", what: ["灵能驾驶"], off: "wide" },
			{ about: "experience", mode: "must", what: ["机甲算法"] },
		]);
	});

	test("正向条件的词才量宽：排除词照原样生效", async () => {
		// 宽这个指标答的是「它还筛不筛得掉人」，那是准入的问题。排除词答的是
		// 「哪一段不作数」，命中面广恰恰是它在起作用；而且它按更高的
		// RELEVANCE_MIN_EXCLUDE 判定，这个指标量出来的根本不是它搜出来的宽。
		const spec = await sentence("机甲算法, -灵能驾驶");
		assert.deepEqual(spec.conditions, [
			{ about: "experience", mode: "must", what: ["机甲算法"] },
			{ about: "experience", mode: "exclude", what: ["灵能驾驶"] },
		]);
	});

	test("量的是人不是段：一个人囤再多命中段，词也不算宽", async () => {
		const spec = await sentence("幽冥测绘");
		assert.deepEqual(spec.conditions, [
			{ about: "experience", mode: "must", what: ["幽冥测绘"] },
		]);
	});
});

describe("一条主张里只有一部分经历词太宽", () => {
	test("只丢宽的那个词，主张本身照常参与，不停用；别的项原样留着", async () => {
		const spec = await sentence("机甲算法/灵能驾驶 kind:internal");
		assert.deepEqual(spec.conditions, [
			{
				about: "experience",
				mode: "must",
				what: ["机甲算法"],
				kind: "internal",
			},
		]);
	});

	test("代表词太宽时下一个词顶上：chip 上写的就是搜的", async () => {
		const spec = await sentence("灵能驾驶/机甲算法");
		assert.deepEqual(spec.conditions, [
			{ about: "experience", mode: "must", what: ["机甲算法"] },
		]);
	});

	test("全部词都宽才停整条，停的时候词一个不丢，也不降成没有词的主张", async () => {
		const spec = await sentence("灵能驾驶/星际外交 kind:internal");
		assert.deepEqual(spec.conditions, [
			{
				about: "experience",
				mode: "must",
				what: ["灵能驾驶", "星际外交"],
				kind: "internal",
				off: "wide",
			},
		]);
	});
});

describe("补充需求时只量这一轮新加的词", () => {
	test("上一轮用户坚持启用的宽词不会被停掉", async () => {
		const { parseQuery } = await import("#/search/query-syntax");
		const said = await createTurn({ kind: "sentence", text: "灵能驾驶" });
		assert.deepEqual((await resolveTurn(said.turnId)).conditions, [
			{ about: "experience", mode: "must", what: ["灵能驾驶"], off: "wide" },
		]);
		// 直接提交的条件不量宽：用户在 chip 上把太宽的那条重新启用，就是这样一份
		const kept = await createTurn(
			{ kind: "spec", spec: { conditions: parseQuery("灵能驾驶") } },
			said.turnId,
		);
		const { turnId } = await createTurn(
			{ kind: "sentence", text: "机甲算法" },
			kept.turnId,
		);
		assert.deepEqual((await resolveTurn(turnId)).conditions, [
			{ about: "experience", mode: "must", what: ["灵能驾驶"] },
			{ about: "experience", mode: "must", what: ["机甲算法"] },
		]);
	});
});

describe("替代条件落库前就量过", () => {
	test("模型给的替代条件太宽时停用，点「加上」提交的就是停用的那一条", async () => {
		const { loadTurn } = await import("#/server/turn");
		const { turnId } = await createTurn({
			kind: "sentence",
			text: "机甲算法，有潜力",
		});
		await answering(
			() => ({
				conditions: [{ about: "experience", mode: "must", what: ["机甲算法"] }],
				assumed: [],
				declined: [
					{
						said: "有潜力",
						why: "经历里看不出潜力",
						instead: [
							{ about: "experience", mode: "boost", what: ["灵能驾驶"] },
							{ about: "experience", mode: "boost", what: ["幽冥测绘"] },
						],
					},
				],
			}),
			() => resolveTurn(turnId),
		);
		assert.deepEqual((await loadTurn(turnId))?.notes?.declined[0]?.instead, [
			{ about: "experience", mode: "boost", what: ["灵能驾驶"], off: "wide" },
			{ about: "experience", mode: "boost", what: ["幽冥测绘"] },
		]);
	});
});
