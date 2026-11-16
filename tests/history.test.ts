/**
 * 这次找人之前的对话写成给查询理解读的几行字（`search/history.ts`）。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compileConditions } from "#/search/compile";
import { historyLines, type PastTurn } from "#/search/history";
import { withOff } from "#/search/query";
import { parseQuery } from "#/search/query-syntax";

const table = (syntax: string) =>
	compileConditions(parseQuery(syntax)).conditions;

const algo = table("算法, +带团队");
const ASKED = {
	says: "算法有好几个方向，要看哪一类？",
	choices: {
		current: "各个方向都看",
		others: [{ label: "只看推荐算法" }, { label: "只看视觉算法" }],
	},
};

describe("之前的对话", () => {
	test("第一句话之前没有对话", () => {
		assert.deepEqual(historyLines([]), []);
	});

	test("说了话的一轮：原话、条件加了什么去掉了什么、对 HR 说过问过什么", () => {
		const past: PastTurn[] = [
			{ said: "找做算法的，带过团队的优先", conditions: algo, notes: ASKED },
			{ said: "不用带团队", conditions: algo.slice(0, 1), notes: null },
			{
				said: "看看有没有",
				conditions: algo.slice(0, 1),
				notes: { says: "人才库里没有工作地点", choices: null },
			},
		];
		assert.deepEqual(historyLines(past), [
			"HR：找做算法的，带过团队的优先\n你：按这些条件找：算法、带团队（加分）。问 HR：算法有好几个方向，要看哪一类？ 当时按的是「各个方向都看」，HR 还可以回答「只看推荐算法」、「只看视觉算法」",
			"HR：不用带团队\n你：去掉 带团队（加分）。",
			"HR：看看有没有\n你：条件没变。对 HR 说：人才库里没有工作地点",
		]);
	});

	test("HR 直接改条件的一轮：改了什么；条件原样的是接着往下找；只动了停用的另说", () => {
		const [first] = algo;
		assert.ok(first);
		const past: PastTurn[] = [
			{ said: "找做算法的", conditions: algo, notes: null },
			{ said: null, conditions: algo.slice(0, 1), notes: null },
			{ said: null, conditions: algo.slice(0, 1), notes: null },
			{ said: null, conditions: [withOff(first, "user")], notes: null },
		];
		assert.deepEqual(historyLines(past).slice(1), [
			"HR 自己改了条件：去掉 带团队（加分）。",
			"HR 让你按原样的条件接着往下找。",
			"HR 自己停用或启用了几条条件。",
		]);
	});

	test("聊得再久也只写第一句话和最近的几轮，中间从略", () => {
		const past: PastTurn[] = Array.from({ length: 20 }, (_, i) => ({
			said: `第 ${i + 1} 句`,
			conditions: algo,
			notes: null,
		}));
		const lines = historyLines(past);
		assert.equal(lines.length, 13);
		assert.match(lines[0] ?? "", /^HR：第 1 句/);
		assert.equal(lines[1], "（中间 8 轮从略）");
		assert.match(lines[2] ?? "", /^HR：第 10 句/);
		assert.match(lines.at(-1) ?? "", /^HR：第 20 句/);
	});
});
