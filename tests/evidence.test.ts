/**
 * 证据的来源怎么写、每条主张取哪条命中。来源只用字写在证据行上，不分档、不进名次。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bestHitPerClaim, routeLabel } from "#/search/evidence";
import type { Claim } from "#/search/result";
import type { Route } from "#/search/weights";
import { claim } from "./conditions";
import { hit as row } from "./rows";

const hit = (claim: number, route: Route) => row({ claim, route });

const claims = (...what: string[]): Claim[] =>
	what.map((w) => claim(w) as Claim);

describe("来源的写法", () => {
	test("每一类来源各有确切的写法；做过的事不另起类型名", () => {
		// 断言整张表：少一类多一类都会失败，加一类时必须决定它在屏幕上叫什么
		const routes: Route[] = ["role", "title", "skill", "did", "description"];
		assert.deepEqual(
			Object.fromEntries(routes.map((r) => [r, routeLabel(r)])),
			{
				role: "任职记录",
				title: "岗位",
				skill: "技能",
				did: "",
				description: "简历原文",
			},
		);
	});
});

describe("每条主张取最好的那条命中", () => {
	test("按主张的顺序对齐，不按命中的顺序", () => {
		const best = bestHitPerClaim(
			[hit(1, "skill"), hit(0, "role")],
			claims("算法", "运营"),
		);
		assert.deepEqual(
			best.map((h) => h?.route),
			["role", "skill"],
		);
	});

	test("同一条主张有多条时取展示列表中排在第一的那条", () => {
		const best = bestHitPerClaim(
			[hit(0, "description"), hit(0, "role")],
			claims("算法"),
		);
		assert.equal(best[0]?.route, "description");
	});
});
