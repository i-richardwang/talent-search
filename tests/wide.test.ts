/**
 * 人口覆盖宽度：按人量，在查询理解落库前**可见地**停用，成因记在 `off` 上。
 *
 * 一条条件的几个取值同权：宽的那个取值丢掉，其余照常找人；全宽才说明这条
 * 条件几乎不筛人，整条停用、成因写成 `off: "wide"`，用户看得见、能换词、
 * 也能坚持启用。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import { seed, setup } from "./fixture";

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
		assert.deepEqual(spec.terms, [
			{ field: "experience", mode: "must", values: ["灵能驾驶"], off: "wide" },
			{ field: "experience", mode: "must", values: ["机甲算法"] },
		]);
	});

	test("正向条件的词才量宽：排除词照原样生效", async () => {
		// 宽这把尺答的是「它还筛不筛得掉人」，那是准入的问题。排除词答的是
		// 「哪一段不作数」，命中面广恰恰是它在起作用；而且它按更高的
		// RELEVANCE_MIN_EXCLUDE 判定，这把尺量出来的根本不是它搜出来的宽。
		const spec = await sentence("机甲算法, -灵能驾驶");
		assert.deepEqual(spec.terms, parseQuery("机甲算法,-灵能驾驶"));
	});

	test("量的是人不是段：一个人囤再多命中段，词也不算宽", async () => {
		const spec = await sentence("幽冥测绘");
		assert.deepEqual(spec.terms, parseQuery("幽冥测绘"));
	});
});

describe("一条条件里只有一部分取值太宽", () => {
	test("只丢宽的那个取值，条件本身照常参与，不停用", async () => {
		const spec = await sentence("机甲算法/灵能驾驶");
		assert.deepEqual(spec.terms, parseQuery("机甲算法"));
	});

	test("代表词太宽时下一个取值顶上：chip 上写的就是搜的", async () => {
		const spec = await sentence("灵能驾驶/机甲算法");
		assert.deepEqual(spec.terms, parseQuery("机甲算法"));
	});

	test("全部取值都宽才停整条，停的时候取值一个不丢", async () => {
		const spec = await sentence("灵能驾驶/星际外交");
		assert.deepEqual(spec.terms, [
			{
				field: "experience",
				mode: "must",
				values: ["灵能驾驶", "星际外交"],
				off: "wide",
			},
		]);
	});
});
