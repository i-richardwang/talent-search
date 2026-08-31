/**
 * 证据强度模型。这层没有数据库，但它决定了界面上「橙点 / 灰点 / 空心圈」
 * 分别是什么意思——权重一改，这里必须跟着重新论证。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bestHitPerTerm, strengthOf } from "#/search/evidence";
import type { Hit, TermPlan } from "#/search/result";
import { ROUTE_WEIGHTS, type Route } from "#/search/weights";

const hit = (term: string, route: Route): Hit => ({
	experienceId: 1,
	term,
	route,
	kind: "internal",
	startDate: "2020-01-01",
	endDate: null,
	org: "",
	title: "",
	seq: "",
	months: 12,
});

const terms = (...t: string[]): TermPlan[] =>
	t.map((term) => ({ term, effective: term, mode: "must" }));

describe("强度分档", () => {
	test("受控字段是序列与岗位，且它们权重最高", () => {
		assert.equal(strengthOf("seq"), "controlled");
		assert.equal(strengthOf("title"), "controlled");
		const top = Math.max(...Object.values(ROUTE_WEIGHTS));
		assert.equal(ROUTE_WEIGHTS.seq, top);
		assert.equal(ROUTE_WEIGHTS.title, top);
	});

	test("部门公司自成一档，权重居中", () => {
		assert.equal(strengthOf("org"), "org");
		assert.ok(ROUTE_WEIGHTS.org < ROUTE_WEIGHTS.seq);
		assert.ok(ROUTE_WEIGHTS.org > ROUTE_WEIGHTS.description);
	});

	test("简历原文是自述，权重最低", () => {
		assert.equal(strengthOf("description"), "claimed");
		assert.equal(
			ROUTE_WEIGHTS.description,
			Math.min(...Object.values(ROUTE_WEIGHTS)),
		);
	});

	test("每一路都归到确切的一档，不是「属于三档之一」", () => {
		// 断言整张映射表而不是逐个判断「在集合里」：后者被任何兜底分支保证为真，
		// 加一路而没决定它多硬时照样绿。这里少一路多一路都会红。
		assert.deepEqual(
			Object.fromEntries(
				(Object.keys(ROUTE_WEIGHTS) as Route[]).map((r) => [r, strengthOf(r)]),
			),
			{
				seq: "controlled",
				title: "controlled",
				org: "org",
				description: "claimed",
			},
		);
	});
});

describe("每个概念词取最好的那条命中", () => {
	test("按概念词的顺序对齐，不按命中的顺序", () => {
		const best = bestHitPerTerm(
			[hit("运营", "org"), hit("算法", "seq")],
			terms("算法", "运营"),
		);
		assert.deepEqual(
			best.map((h) => h?.route),
			["seq", "org"],
		);
	});

	test("同一个词有多条时取展示列表中排在第一的那条", () => {
		const best = bestHitPerTerm(
			[hit("算法", "seq"), hit("算法", "description")],
			terms("算法"),
		);
		assert.equal(best[0]?.route, "seq");
	});
});
