/**
 * 证据的来源怎么写、每条主张取哪条命中。来源只用字写在证据行上，不分档、不进名次。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { bestEvidencePerClaim, routeLabel } from "#/search/evidence";
import type { Claim } from "#/search/query";
import type { Route } from "#/search/weights";
import { compiledClaim } from "./conditions";
import { evidence as row } from "./rows";

const evidence = (claim: number, route: Route) => row({ claim, route });

const claims = (...what: string[]): Claim[] =>
	what.map((w) => compiledClaim(w));

describe("来源的写法", () => {
	test("每一类来源各有确切的写法", () => {
		// 断言整张表：少一类多一类都会失败，加一类时必须决定它在屏幕上叫什么
		const routes: Route[] = ["role", "title", "skill", "description"];
		assert.deepEqual(
			Object.fromEntries(routes.map((r) => [r, routeLabel(r)])),
			{
				role: "任职记录",
				title: "岗位",
				skill: "技能",
				description: "简历原文",
			},
		);
	});
});

describe("每条主张取最好的那条命中", () => {
	test("按主张的顺序对齐，不按命中的顺序", () => {
		const best = bestEvidencePerClaim(
			[evidence(1, "skill"), evidence(0, "role")],
			claims("算法", "运营"),
		);
		assert.deepEqual(
			best.map((h) => h?.route),
			["role", "skill"],
		);
	});

	test("同一条主张有多条时取展示列表中排在第一的那条", () => {
		const best = bestEvidencePerClaim(
			[evidence(0, "description"), evidence(0, "role")],
			claims("算法"),
		);
		assert.equal(best[0]?.route, "description");
	});
});
