/**
 * 证据可信度的分档。这层没有数据库，但它决定了界面上「绿点 / 灰点 / 空心圈」
 * 分别是什么意思，也是排序的第一把尺——档一改，这里必须跟着重新论证。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bestHitPerClaim, bestStrength, strengthOf } from "#/search/evidence";
import type { Claim } from "#/search/result";
import {
	ROUTE_ORDER,
	ROUTE_STRENGTH,
	type Route,
	STRENGTHS,
	strengthRank,
} from "#/search/weights";
import { claim } from "./conditions";
import { hit as row } from "./rows";

const hit = (claim: number, route: Route | null) => row({ claim, route });

const claims = (...what: string[]): Claim[] =>
	what.map((w) => claim(w) as Claim);

describe("强度分档", () => {
	test("三档由强到弱：登记的序列或岗位、登记的部门或公司、自述", () => {
		assert.deepEqual(STRENGTHS, ["controlled", "org", "claimed"]);
		assert.ok(strengthRank("controlled") < strengthRank("org"));
		assert.ok(strengthRank("org") < strengthRank("claimed"));
	});

	test("抽取的两路来源仍是自述，和简历原文同档", () => {
		// 强度只看字段来源：模型读得再好也不会让自述变成登记
		assert.equal(strengthOf("skill"), "claimed");
		assert.equal(strengthOf("did"), "claimed");
		assert.equal(strengthOf("description"), "claimed");
	});

	test("六路按档由强到弱排，取数去重和界面枚举读的是同一份", () => {
		const ranks = ROUTE_ORDER.map((r) => strengthRank(ROUTE_STRENGTH[r]));
		assert.deepEqual(
			ranks,
			[...ranks].sort((a, b) => a - b),
		);
		assert.equal(ROUTE_ORDER.length, Object.keys(ROUTE_STRENGTH).length);
	});

	test("每一路都归到确切的一档，不是「属于三档之一」", () => {
		// 断言整张映射表而不是逐个判断「在集合里」：后者被任何兜底分支保证为真，
		// 加一路而没决定它多硬时照样绿。这里少一路多一路都会红。
		assert.deepEqual(
			Object.fromEntries(
				(Object.keys(ROUTE_STRENGTH) as Route[]).map((r) => [r, strengthOf(r)]),
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
