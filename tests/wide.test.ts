/**
 * 人口覆盖宽度：按人量，在查询理解落库前**可见地**停用，成因记成一条注解。
 *
 * 两件事要分开测：**停没停用**是要求的状态（`off`），**为什么**是这次理解的
 * 注解（`notices` 的 `wide`）。宽是关于语料的事实，会随语料重灌后失效，而要求
 * 是记录里不可变的那一半——把成因写进要求，等于把一条会过期的判断冻进条件里。
 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import { wideTerms } from "#/search/spec";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { createTurn, resolveTurn } = await import("#/server/turn");

before(async () => {
	await seed([
		...Array.from({ length: 9 }, (_, i) => ({
			empId: `W${i}`,
			name: `宽${i}`,
			segments: [{ seqL2: "灵能驾驶", months: 12 }],
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
	test("超过占比的用户词整条停用并注明成因，别的词照常参与", async () => {
		const spec = await sentence("灵能驾驶, 机甲算法");
		assert.deepEqual(spec.requirements, parseQuery("~灵能驾驶,机甲算法"));
		assert.deepEqual(wideTerms(spec), ["灵能驾驶"], "成因是一条注解");
	});

	test("正向要求的词才量宽：排除词照原样生效", async () => {
		// 宽这把尺答的是「它还筛不筛得掉人」，那是准入的问题。排除词答的是
		// 「哪一段不作数」，命中面广恰恰是它在起作用；而且它按更高的
		// RELEVANCE_MIN_EXCLUDE 判定，这把尺量出来的根本不是它搜出来的宽。
		const spec = await sentence("机甲算法, -灵能驾驶");
		assert.deepEqual(spec.requirements, parseQuery("机甲算法,-灵能驾驶"));
		assert.deepEqual(wideTerms(spec), []);
	});

	test("量的是人不是段：一个人囤再多命中段，词也不算宽", async () => {
		const spec = await sentence("幽冥测绘");
		assert.deepEqual(spec.requirements, parseQuery("幽冥测绘"));
		assert.deepEqual(wideTerms(spec), []);
	});

	test("成因只解释在场的东西：那枚 chip 被删掉，注解跟着走", async () => {
		const spec = await sentence("灵能驾驶, 机甲算法");
		const { normalizeSpec } = await import("#/search/spec");
		const kept = normalizeSpec({
			...spec,
			requirements: parseQuery("机甲算法"),
		});
		assert.deepEqual(wideTerms(kept), []);
		assert.deepEqual(kept.requirements, [
			{ members: [{ text: "机甲算法", tier: "said" }], mode: "must" },
		]);
	});
});

describe("变体太宽", () => {
	test("只丢那个变体，要求本身照常参与，也不注明", async () => {
		// 变体是模型替用户补的、用户没见过：一个用户没说过的宽词不该把整条
		// 要求停掉，也没有「你说的词太宽」可解释。
		const spec = await sentence("机甲算法/~灵能驾驶");
		assert.deepEqual(spec.requirements, parseQuery("机甲算法"));
		assert.deepEqual(wideTerms(spec), []);
	});

	test("用户自己的说法太宽才停整条，停的时候变体一起停、不丢", async () => {
		const spec = await sentence("灵能驾驶/~机甲算法");
		assert.deepEqual(spec.requirements, parseQuery("~灵能驾驶/~机甲算法"));
		assert.deepEqual(wideTerms(spec), ["灵能驾驶"]);
	});
});
