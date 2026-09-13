/**
 * 证据强度模型。这层没有数据库，但它决定了界面上「绿点 / 灰点 / 空心圈」
 * 分别是什么意思——权重一改，这里必须跟着重新论证。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bestHitPerClaim, bestStrength, strengthOf } from "#/search/evidence";
import type { Claim } from "#/search/result";
import { ROUTE_WEIGHTS, type Route } from "#/search/weights";
import { claim } from "./conditions";
import { hit as row } from "./rows";

const hit = (claim: number, route: Route | null) => row({ claim, route });

const claims = (...what: string[]): Claim[] =>
	what.map((w) => claim(w) as Claim);

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

	test("抽取的两路来源仍是自述，和简历原文同档同权", () => {
		// 强度只看字段来源：模型读得再好也不会让自述变成登记
		assert.equal(strengthOf("skill"), "claimed");
		assert.equal(strengthOf("did"), "claimed");
		assert.equal(ROUTE_WEIGHTS.skill, ROUTE_WEIGHTS.description);
		assert.equal(ROUTE_WEIGHTS.did, ROUTE_WEIGHTS.description);
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
				skill: "claimed",
				did: "claimed",
				description: "claimed",
			},
		);
	});

	test("不比文本的命中（落在范围里的段）是登记事实，算受控", () => {
		assert.equal(strengthOf(null), "controlled");
	});

	test("一段经历按它最强的那一路上色", () => {
		assert.equal(bestStrength([hit(0, "description"), hit(1, "org")]), "org");
		assert.equal(bestStrength([]), undefined);
	});
});

describe("每条主张取最好的那条命中", () => {
	test("按主张的顺序对齐，不按命中的顺序", () => {
		const best = bestHitPerClaim(
			[hit(1, "org"), hit(0, "seq")],
			claims("算法", "运营"),
		);
		assert.deepEqual(
			best.map((h) => h?.route),
			["seq", "org"],
		);
	});

	test("同一条主张有多条时取展示列表中排在第一的那条", () => {
		const best = bestHitPerClaim(
			[hit(0, "seq"), hit(0, "description")],
			claims("算法"),
		);
		assert.equal(best[0]?.route, "seq");
	});
});
