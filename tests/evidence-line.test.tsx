/**
 * 一个人一个条件的那一行证据。
 *
 * 它画的是**排序依据本身**：点管强度、右端的数管累计时长、数的深浅管近因。
 * 所以这里钉的第一件事是「看得见的数就是参与打分的那个数」——显示单段月数
 * 而排序用累计月数，会让两个名次不同的人显示同一个数，这个界面的说服力
 * 全在于两者一致。
 *
 * 第二件事是**行内必须写出到底是哪个字段命中的**。一行的宽度足够写下它，
 * 不写就等于把「凭什么算命中」这个问题推给详情面板。写错字段比不写更坏——
 * 屏幕上会出现一个不含查询词的岗位名，读起来像是系统匹配错了——
 * 所以每一路都单独钉一遍。
 *
 * 点是 aria-hidden 的，说明文字全在类名和 title 里——正好是 `visibleText`
 * 要防的形态：属性完整、人眼却什么都看不到。所以断言的一律是可见文本，
 * 只有「近因」那一档因为编码在字色上，才去看类名。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceLine } from "#/routes/-components/evidence";
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
	renderToStaticMarkup(
		<EvidenceLine basis={b} boost={false} hit={h} term="算法" />,
	);

const seen = (h: Hit | undefined, b?: TermBasis | null) =>
	visibleText(markup(h, b));

describe("一行证据看得见的部分", () => {
	test("有命中就必须看得见时长，不能只剩一颗点", () => {
		assert.match(seen(hit(), basis()), /2\.3 年/);
	});

	test("显示的是参与打分的累计月数，不是随便挑的那一段", () => {
		// 同一个人：最强那一路上累计 60 个月，样例段只有其中 27 个月。
		// 显示 27 会让他和一个真的只做过 27 个月的人在名单上完全一样。
		assert.match(seen(hit({ months: 27 }), basis({ months: 60 })), /5\.0 年/);
	});

	test("「前」由累计的那些段一起决定，不由样例段的 kind 决定", () => {
		// 样例段是入职前的，但累计里还有在职的段——这个数不配叫「前」
		assert.doesNotMatch(
			seen(hit({ kind: "external" }), basis({ external: false })),
			/前 2\.3 年/,
		);
		assert.match(
			seen(hit({ kind: "internal" }), basis({ external: true })),
			/前 2\.3 年/,
		);
	});

	test("还在做的把数字提到正文色，做完了的留在次要色", () => {
		assert.match(markup(hit(), basis({ endDate: null })), /text-foreground/);
		assert.match(
			markup(hit(), basis({ endDate: "2021-06-01" })),
			/text-muted-foreground/,
		);
	});

	test("没有聚合值时退回样例段，这一行不会因此空掉", () => {
		assert.match(seen(hit({ kind: "external" }), null), /前 2\.3 年/);
	});

	test("条件词本身永远在，命中与否都在——它是上下对比的那条竖线", () => {
		assert.match(seen(hit(), basis()), /算法/);
		assert.match(seen(undefined, null), /算法/);
	});

	test("没有命中要说「未命中」，不是留一片空白让人以为还没加载完", () => {
		assert.match(seen(undefined, null), /未命中/);
	});

	test("命中的词在字段值里被标出来——这一行存在的全部意义", () => {
		assert.match(
			markup(hit({ route: "title" }), basis()),
			/<mark[^>]*>算法<\/mark>/,
		);
	});

	test("写出来的必须是真正命中的那个字段，不是固定取岗位", () => {
		// 屏幕上出现一个不含查询词的字段值，读起来就是系统匹配错了。
		const bySeq = seen(hit({ route: "seq" }), basis());
		assert.match(bySeq, /序列/);
		assert.match(bySeq, /技术 · 算法/);

		// 「算法工程师」里的「算法」被 <mark> 包住了，所以标签抹掉之后
		// 中间多一个空格——那正是这一行该有的样子，见下面那条 Highlight 断言
		const byTitle = seen(hit({ route: "title" }), basis());
		assert.match(byTitle, /岗位/);
		assert.match(byTitle, /算法 ?工程师/);

		const byOrg = seen(
			hit({ route: "org", org: "算法平台部" }),
			basis({ routes: ["org"] }),
		);
		assert.match(byOrg, /部门或公司/);
		assert.match(byOrg, /算法 ?平台部/);
	});

	test("简历原文这一路不假装引用了一句原文", () => {
		// 命中事实里根本不带原文片段（见 search/result.ts 的 Hit）。
		// 摆一段岗位名出来当引文，等于把最弱的一路伪装成可核对的证据。
		const said = seen(hit({ route: "description" }), basis());
		assert.match(said, /简历原文/);
		// 这一段经历的身份还是要给：不然「在哪儿提过」无从查起。
		// 这一路没有可标的字段值，所以这里不经过 Highlight，是完整的一串
		assert.match(said, /算法工程师/);
		assert.match(said, /某部门/);
	});
});
