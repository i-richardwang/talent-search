/**
 * 左栏筛选看得见的那部分。
 *
 * 断言的是 visibleText，属性一律不算数：`aria-label` 会让文案存在于 DOM 里，
 * 按字符串搜 HTML 就能命中一个人眼什么都看不到的空壳。
 *
 * 常驻列表而不是弹层，也是这一层可测的前提——弹层关着时不进 SSR 输出，
 * 渲染测试根本够不着。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterRail } from "#/routes/-components/filter-rail";
import { filterFields } from "#/routes/-lib/filters";
import type { View } from "#/routes/-lib/view-params";
import type { Facets } from "#/search/result";
import { visibleText } from "./render";

const SEQ = Array.from({ length: 9 }, (_, i) => ({
	seqL1: "技术",
	seqL2: `序列${i}`,
	n: 100 - i,
}));

const FACETS: Facets = {
	seq: SEQ,
	companyTag: [{ value: "大厂", n: 42 }],
	kind: [
		{ value: "internal", n: 31 },
		{ value: "external", n: 12 },
	],
	minMonths: [
		{ value: 6, n: 40 },
		{ value: 12, n: 33 },
	],
	strong: { on: 7, off: 31 },
};

const render = (view: View, hasQuery = true) =>
	visibleText(
		renderToStaticMarkup(
			<FilterRail
				fields={filterFields(FACETS, view)}
				hasQuery={hasQuery}
				onChange={() => {}}
				view={view}
				strongCount={7}
			/>,
		),
	);

describe("筛选是常驻的索引", () => {
	test("四组标题都在，不用先点开才知道能筛什么", () => {
		const seen = render({});
		for (const title of [
			"序列",
			"入职前公司",
			"经历来源",
			"经历时长",
			"匹配来源",
		]) {
			assert.ok(seen.includes(title), `看不到分组「${title}」：${seen}`);
		}
	});

	test("每个选项后面的人数一直可见", () => {
		assert.match(render({}), /技术 · 序列0\s*100/);
		assert.match(render({}), /大厂\s*42/);
	});

	test("选项文案是人话，不是 URL 里的裸值", () => {
		const seen = render({ kind: "internal", minMonths: 12 });
		assert.ok(seen.includes("公司内经历"), seen);
		assert.ok(seen.includes("1 年"), seen);
		assert.ok(!seen.includes("internal"), `裸值泄漏到界面上：${seen}`);
	});
});

describe("长列表的渐进披露", () => {
	test("默认只露出前 6 项，其余收起来并说清还有几项", () => {
		const seen = render({});
		assert.ok(seen.includes("技术 · 序列5"), seen);
		assert.ok(!seen.includes("技术 · 序列6"), `第 7 项不该默认可见：${seen}`);
		assert.ok(seen.includes("还有 3 项"), seen);
	});

	test("已选中的那项排在第 7 位以后时，整组必须摊开", () => {
		// 否则界面上没有任何东西解释「为什么只剩这几个人」
		const seen = render({ seq: "技术/序列8" });
		assert.ok(seen.includes("技术 · 序列8"), seen);
		assert.ok(!seen.includes("还有"), `已选中项被藏起来了：${seen}`);
	});
});

describe("清除", () => {
	test("没筛就不出现清除，筛了就说清有几项", () => {
		assert.ok(!render({}).includes("清除"));
		assert.ok(render({ kind: "internal" }).includes("清除 1 项"));
		assert.ok(
			render({ kind: "internal", minMonths: 12 }).includes("清除 2 项"),
		);
	});

	test("证据要求不进「清除 N 项」的计数——它问的不是人群多大", () => {
		assert.ok(!render({ strong: true }).includes("清除"));
	});
});

describe("人数说的是「点了还剩几个人」", () => {
	test("证据要求那一项后面也有数，和上面四组长成一个样子", () => {
		// 有了这个数，中栏就不必再写一句「已排除 N 人」：同一件事的另一种说法
		assert.match(render({}), /岗位或序列\s*7/);
	});

	test("没有查询就没有可筛的东西，不摆一排点了没反应的控件", () => {
		const seen = render({}, false);
		assert.ok(seen.includes("搜索后可使用筛选"), seen);
		assert.ok(!seen.includes("入职前公司"), `没查询却列出了筛选项：${seen}`);
	});
});
