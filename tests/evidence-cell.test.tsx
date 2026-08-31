/**
 * 表格里那个「概念词 × 人」的格子。
 *
 * 它画的是**排序依据本身**：点管强度、右对齐的数管累计时长、数的深浅管近因。
 * 所以这里钉的第一件事是「看得见的数就是参与打分的那个数」——显示单段月数
 * 而排序用累计月数，会让两个名次不同的人显示同一个数，这个界面的说服力
 * 全在于两者一致。
 *
 * 点是 aria-hidden 的，说明文字全在 aria-label 和 title 里——正好是
 * `visibleText` 要防的形态：属性完整、人眼却什么都看不到。所以断言的
 * 一律是可见文本，只有「近因」那一档因为编码在字色上，才去看类名。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceCell } from "#/routes/-components/evidence";
import type { Hit, TermBasis } from "#/search/result";
import type { Route } from "#/search/weights";
import { visibleText } from "./render";

const hit = (over: Partial<Hit> = {}): Hit => ({
	experienceId: 1,
	term: "算法",
	route: "seq" as Route,
	kind: "internal",
	startDate: "2020-01-01",
	endDate: null,
	org: "某部门",
	title: "算法工程师",
	seq: "技术 · 算法",
	months: 27,
	...over,
});

const basis = (over: Partial<TermBasis> = {}): TermBasis => ({
	term: "算法",
	routes: ["seq"],
	months: 27,
	endDate: null,
	external: false,
	...over,
});

const markup = (h: Hit | undefined, b?: TermBasis | null) =>
	renderToStaticMarkup(<EvidenceCell basis={b} hit={h} />);

const seen = (h: Hit | undefined, b?: TermBasis | null) =>
	visibleText(markup(h, b));

describe("证据格子看得见的部分", () => {
	test("有命中就必须看得见时长，不能只剩一颗点", () => {
		assert.equal(seen(hit(), basis()), "2.3 年");
	});

	test("显示的是参与打分的累计月数，不是随便挑的那一段", () => {
		// 同一个人：最强那一路上累计 60 个月，样例段只有其中 27 个月。
		// 显示 27 会让他和一个真的只做过 27 个月的人在表格上完全一样。
		assert.equal(seen(hit({ months: 27 }), basis({ months: 60 })), "5.0 年");
	});

	test("「前」由累计的那些段一起决定，不由样例段的 kind 决定", () => {
		// 样例段是入职前的，但累计里还有在职的段——这个数不配叫「前」
		assert.equal(
			seen(hit({ kind: "external" }), basis({ external: false })),
			"2.3 年",
		);
		assert.equal(
			seen(hit({ kind: "internal" }), basis({ external: true })),
			"前 2.3 年",
		);
	});

	test("还在做的把数字提到 default，做完了的留在 subtle", () => {
		assert.match(markup(hit(), basis({ endDate: null })), /text-kumo-default/);
		assert.match(
			markup(hit(), basis({ endDate: "2021-06-01" })),
			/text-kumo-subtle/,
		);
	});

	test("没有聚合值时退回样例段，格子不会因此空掉", () => {
		assert.equal(seen(hit({ kind: "external" }), null), "前 2.3 年");
	});

	test("没有命中画的是破折号，不是空格子——列的节奏不能断", () => {
		assert.equal(seen(undefined, null), "—");
	});

	test("不写命中来自哪一路：点的填充已经表达了，写出来就是同一份数据画两遍", () => {
		for (const route of ["seq", "title", "org", "description"] as Route[]) {
			assert.equal(
				seen(hit({ route }), basis()),
				"2.3 年",
				`${route} 多写了文字`,
			);
		}
	});
});
