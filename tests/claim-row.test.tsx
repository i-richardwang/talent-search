/**
 * 名单一行的第二行：这个人凭哪段经历进的名单。条件名不在这一行重复；凭的是现在这份
 * 任职时不重抄第一行；不止一段时写段数，时长写参与排名的累计值。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimRow } from "#/routes/s/$turnId/-components/claim-evidence";
import type { ClaimLine } from "#/routes/s/$turnId/-lib/claim-lines";
import type { ClaimBasis, Evidence } from "#/search/result";
import { compiledClaim } from "./conditions";
import { visibleText } from "./render";
import { evidence } from "./rows";

const claim = compiledClaim("商家服务");

const basis = (over: Partial<ClaimBasis> = {}): ClaimBasis => ({
	months: 38,
	endDate: null,
	segments: 1,
	...over,
});

const seen = (found: ClaimLine["found"]) =>
	visibleText(renderToStaticMarkup(<ClaimRow lines={[{ claim, found }]} />));

const past: Partial<Evidence> = {
	kind: "external",
	company: "某公司",
	department: "",
	endDate: "2020-01-01",
};

describe("名单一行的第二行", () => {
	test("一段入职前经历：公司、岗位和那一段的时长，不写条件名", () => {
		const text = seen({
			evidence: evidence(past),
			basis: basis({ endDate: "2020-01-01" }),
		});
		assert.equal(text, "某公司 · 算法工程师 · 入职前 3.2 年");
		assert.ok(!text.includes(claim.label));
	});

	test("凭的是现在这份任职：不重抄部门和岗位", () => {
		const one = { evidence: evidence(), basis: basis() };
		assert.equal(seen(one), "现任岗位 · 3.2 年");
		assert.equal(
			seen({ ...one, basis: basis({ segments: 3 }) }),
			"现任岗位 等 3 段 · 累计 3.2 年",
		);
	});

	test("没有命中的主张时空着", () => {
		assert.equal(seen(null), "");
	});
});
