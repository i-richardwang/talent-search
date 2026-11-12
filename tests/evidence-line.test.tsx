/**
 * 一个人一个条件的那一行证据。
 *
 * 它画的是**排序依据本身**：右端的数是参与打分的累计时长，数的深浅是近因。所以这里测的
 * 第一件事是「看得见的数就是参与打分的那个数」——显示单段月数而排序用累计月数，会让两个
 * 名次不同的人显示同一个数。
 *
 * 第二件事是**行内必须写出到底是哪个字段命中的**。写错字段比不写更坏——屏幕上会出现一个
 * 和条件毫不相干的岗位名，读起来像是系统匹配错了——所以每一种来源都单独测一遍。
 *
 * 点是 aria-hidden 的，断言的一律是可见文本，只有「近因」那一档因为编码在字色上，才去看类名。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	EvidenceLine,
	MissedClaims,
} from "#/routes/s/$turnId/-components/evidence";
import type { ClaimBasis, Evidence } from "#/search/result";
import { classesWith, visibleText } from "./render";
import { evidence as row } from "./rows";

const evidence = (over: Partial<Evidence> = {}) =>
	row({ department: "某部门", ...over });

const basis = (over: Partial<ClaimBasis> = {}): ClaimBasis => ({
	months: 27,
	endDate: null,
	segments: 1,
	...over,
});

const markup = (h: Evidence, b: ClaimBasis) =>
	renderToStaticMarkup(
		<EvidenceLine basis={b} boost={false} evidence={h} name="算法" />,
	);

const seen = (h: Evidence, b: ClaimBasis) => visibleText(markup(h, b));

describe("一行证据看得见的部分", () => {
	test("有命中就必须看得见时长，不能只剩一颗点", () => {
		assert.match(seen(evidence(), basis()), /2\.3 年/);
	});

	test("显示的是参与打分的累计月数", () => {
		// 时长只放在 basis 上：样例段自己不带月数，界面没有第二个数可挑。
		assert.match(seen(evidence(), basis({ months: 60 })), /5\.0 年/);
	});

	test("一段时按经历来源写，多段时写累计", () => {
		assert.match(seen(evidence(), basis()), /公司内 2\.3 年/);
		assert.match(
			seen(evidence({ kind: "external" }), basis()),
			/入职前 2\.3 年/,
		);
		for (const kind of ["external", "internal"] as const)
			assert.match(
				seen(evidence({ kind }), basis({ segments: 2 })),
				/累计 2\.3 年/,
			);
	});

	test("还在做的把数字提到次要色，做完了的留在三级灰", () => {
		// 定字色的是右端那个数所在的元素，只它一个
		const number = (b: ClaimBasis) =>
			classesWith(markup(evidence(), b), "tabular-nums") ?? [];
		const ongoing = number(basis({ endDate: null }));
		assert.ok(ongoing.includes("text-fg-secondary"), ongoing.join(" "));
		assert.ok(!ongoing.includes("text-fg-tertiary"), ongoing.join(" "));
		const ended = number(basis({ endDate: "2021-06-01" }));
		assert.ok(ended.includes("text-fg-tertiary"), ended.join(" "));
		assert.ok(!ended.includes("text-fg-secondary"), ended.join(" "));
	});

	test("主张的名字总会显示：上下几行靠它对照", () => {
		assert.match(seen(evidence(), basis()), /算法/);
	});

	test("写出来的必须是真正命中的那个字段，不是固定取岗位", () => {
		// 屏幕上出现一个和条件毫不相干的字段值，读起来就是系统匹配错了。
		const byRole = seen(
			evidence({ route: "role", department: "算法平台部" }),
			basis(),
		);
		assert.match(byRole, /任职记录/);
		assert.match(byRole, /算法工程师/);
		assert.match(byRole, /算法平台部/);

		const byTitle = seen(evidence({ route: "title" }), basis());
		assert.match(byTitle, /岗位/);
		assert.match(byTitle, /算法工程师/);
	});

	test("简历原文命中时不显示引用的原文", () => {
		// 命中事实里根本不带原文片段（见 search/result.ts 的 Evidence）。
		// 摆一段岗位名出来当引文，等于把没有原文片段的一路写成可核对的证据。
		const said = seen(evidence({ route: "description" }), basis());
		assert.match(said, /简历原文/);
		// 这一段经历的身份还是要给：不然「在哪儿提过」无从查起。
		assert.match(said, /算法工程师/);
		assert.match(said, /某部门/);
	});

	test("抽取的能力写出类型，投入档跟在说法前面", () => {
		const bySkill = seen(
			evidence({ route: "skill", phrase: "Spark" }),
			basis(),
		);
		assert.match(bySkill, /技能/);
		assert.match(bySkill, /Spark/);
		assert.doesNotMatch(bySkill, /能力词/);

		const byDepth = seen(
			evidence({
				route: "skill",
				phrase: "推荐系统",
				engagement: "主导",
			}),
			basis(),
		);
		assert.match(byDepth, /技能/);
		assert.match(byDepth, /主导 · 推荐系统/);
	});
});

describe("没命中的条件合成一行", () => {
	const missed = (names: string[]) =>
		visibleText(renderToStaticMarkup(<MissedClaims names={names} />));

	test("没命中要说出来，不是留一片空白让人以为还没加载完", () => {
		assert.match(missed(["算法", "风控"]), /未命中/);
		assert.match(missed(["算法", "风控"]), /算法、风控/);
	});

	test("全部命中时它不占位——一行说不出东西的灰字比不写更糟", () => {
		assert.equal(missed([]), "");
	});
});
