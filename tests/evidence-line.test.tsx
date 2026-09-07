/**
 * 一个人一个条件的那一行证据。
 *
 * 它画的是**排序依据本身**：点管强度、相关度和右端的数管参与打分的两个量、
 * 数的深浅管近因。所以这里测的第一件事是「看得见的数就是参与打分的那个数」——
 * 显示单段月数而排序用累计月数，会让两个名次不同的人显示同一个数，这个界面的
 * 说服力全在于两者一致。
 *
 * 第二件事是**行内必须写出到底是哪个字段命中的**。一行的宽度足够写下它，
 * 不写就等于把「凭什么算命中」这个问题推给详情面板。写错字段比不写更坏——
 * 屏幕上会出现一个和条件毫不相干的岗位名，读起来像是系统匹配错了——
 * 所以每一路都单独测一遍。
 *
 * 点是 aria-hidden 的，强度全在类名里——正好是 `visibleText` 要防的形态：
 * 属性完整、人眼却什么都看不到。所以断言的一律是可见文本，只有「近因」那一档
 * 因为编码在字色上，才去看类名。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceLine, MissedTerms } from "#/components/evidence";
import type { Hit, TermBasis } from "#/search/result";
import { visibleText } from "./render";
import { hit as row } from "./rows";

const hit = (over: Partial<Hit> = {}) =>
	row({ relevance: 0.83, org: "某部门", ...over });

const basis = (over: Partial<TermBasis> = {}): TermBasis => ({
	term: "算法",
	route: "seq",
	relevance: 0.83,
	months: 27,
	endDate: null,
	external: false,
	...over,
});

const markup = (h: Hit, b: TermBasis) =>
	renderToStaticMarkup(
		<EvidenceLine basis={b} boost={false} hit={h} term="算法" />,
	);

const seen = (h: Hit, b: TermBasis) => visibleText(markup(h, b));

describe("一行证据看得见的部分", () => {
	test("有命中就必须看得见时长，不能只剩一颗点", () => {
		assert.match(seen(hit(), basis()), /2\.3 年/);
	});

	test("显示的是参与打分的累计月数", () => {
		// 时长只住在 basis 上：样例段自己不带月数，界面没有第二个数可挑。
		assert.match(seen(hit(), basis({ months: 60 })), /5\.0 年/);
	});

	test("相关度显示成百分比，取的是参与打分的那条证据", () => {
		assert.match(
			seen(hit({ relevance: 0.61 }), basis({ relevance: 0.83 })),
			/83%/,
		);
		assert.doesNotMatch(
			seen(hit({ relevance: 0.61 }), basis({ relevance: 0.83 })),
			/61%/,
		);
		// 一字不差就是 100%
		assert.match(seen(hit({ relevance: 1 }), basis({ relevance: 1 })), /100%/);
	});

	test("「前」由累计的那些段一起决定", () => {
		// 累计里只要有在职的段，这个数就不配叫「前」
		assert.doesNotMatch(seen(hit(), basis({ external: false })), /前 2\.3 年/);
		assert.match(seen(hit(), basis({ external: true })), /前 2\.3 年/);
	});

	test("还在做的把数字提到正文色，做完了的留在次要色", () => {
		assert.match(markup(hit(), basis({ endDate: null })), /text-foreground/);
		assert.match(
			markup(hit(), basis({ endDate: "2021-06-01" })),
			/text-muted-foreground/,
		);
	});

	test("条件词本身永远在——它是上下对比的那条竖线", () => {
		assert.match(seen(hit(), basis()), /算法/);
	});

	test("写出来的必须是真正命中的那个字段，不是固定取岗位", () => {
		// 屏幕上出现一个和条件毫不相干的字段值，读起来就是系统匹配错了。
		const bySeq = seen(hit({ route: "seq" }), basis());
		assert.match(bySeq, /序列/);
		assert.match(bySeq, /技术 · 算法/);

		const byTitle = seen(hit({ route: "title" }), basis({ route: "title" }));
		assert.match(byTitle, /岗位/);
		assert.match(byTitle, /算法工程师/);

		const byOrg = seen(
			hit({ route: "org", org: "算法平台部" }),
			basis({ route: "org" }),
		);
		assert.match(byOrg, /部门或公司/);
		assert.match(byOrg, /算法平台部/);
	});

	test("简历原文这一路不假装引用了一句原文", () => {
		// 命中事实里根本不带原文片段（见 search/result.ts 的 Hit）。
		// 摆一段岗位名出来当引文，等于把最弱的一路伪装成可核对的证据。
		const said = seen(
			hit({ route: "description" }),
			basis({ route: "description" }),
		);
		assert.match(said, /简历原文/);
		// 这一段经历的身份还是要给：不然「在哪儿提过」无从查起。
		assert.match(said, /算法工程师/);
		assert.match(said, /某部门/);
	});
});

describe("没命中的条件收成一行", () => {
	const missed = (terms: string[]) =>
		visibleText(renderToStaticMarkup(<MissedTerms terms={terms} />));

	test("没命中要说出来，不是留一片空白让人以为还没加载完", () => {
		assert.match(missed(["算法", "风控"]), /未命中/);
		assert.match(missed(["算法", "风控"]), /算法、风控/);
	});

	test("全部命中时它不占位——一行说不出东西的灰字比不写更糟", () => {
		assert.equal(missed([]), "");
	});
});
