/** 人口覆盖宽度：按人量，并在查询理解落库前可见地停用。 */
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);

delete process.env.LLM_BASE_URL;
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
		const { chips } = await sentence("灵能驾驶, 机甲算法");
		assert.deepEqual(chips, [
			{ term: "灵能驾驶", mode: "must", off: true, wide: true },
			{ term: "机甲算法", mode: "must" },
		]);
	});

	test("太宽的排除词一样停：它会把大量证据无声否决掉", async () => {
		const { chips } = await sentence("机甲算法, -灵能驾驶");
		assert.deepEqual(chips, [
			{ term: "机甲算法", mode: "must" },
			{ term: "灵能驾驶", mode: "exclude", off: true, wide: true },
		]);
	});

	test("太宽的相近说法直接摘掉：没过质检的翻译不上屏", async () => {
		const { chips } = await sentence("机甲算法/?灵能驾驶");
		assert.deepEqual(chips, [{ term: "机甲算法", mode: "must" }]);
	});

	test("量的是人不是段：一个人囤再多命中段，词也不算宽", async () => {
		const { chips } = await sentence("幽冥测绘");
		assert.deepEqual(chips, [{ term: "幽冥测绘", mode: "must" }]);
	});
});
