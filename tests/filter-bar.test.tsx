/**
 * 范围条件那一行看得见的部分。
 *
 * 断言的是 visibleText，属性一律不算数：`aria-label` 会让文案存在于 DOM 里，
 * 按字符串搜 HTML 就能命中一个人眼什么都看不到的空壳。
 *
 * 筛选住在弹层里，而关着的弹层不进 SSR 输出，所以选项表本身在这一层够不着。
 * 那些不变量（人数、裸值翻译、选中项不消失）钉在 `tests/filters.test.ts` 上——
 * 它们本来就产在 `filterFields`，这里只是把它画出来。
 *
 * 这个文件只管**不点开也必须看得见**的那部分，而那恰恰是把筛选收进弹层时
 * 最容易弄丢的东西。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar } from "#/routes/-components/filter-bar";
import { filterFields, textFilters } from "#/routes/-lib/filters";
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
	level: [{ value: "P6", n: 20 }],
	recruitment: [],
	education: [],
	strong: { on: 7, off: 31 },
};

const render = (view: View) =>
	visibleText(
		renderToStaticMarkup(
			<FilterBar
				fields={filterFields(FACETS, view)}
				onChange={() => {}}
				strongCount={7}
				textFilters={textFilters(view)}
				view={view}
			/>,
		),
	);

describe("不点开也知道能筛什么", () => {
	test("五个维度各有一枚按钮，名字就写在上面", () => {
		const seen = render({});
		for (const title of [
			"序列",
			"入职前公司",
			"经历来源",
			"经历时长",
			"岗位或序列命中",
		]) {
			assert.ok(seen.includes(title), `看不到维度「${title}」：${seen}`);
		}
	});

	test("数不出人的维度整枚按钮都不出现", () => {
		// 分面只返回还数得出人的选项，一个都不剩时那一维没有可点的东西
		const seen = visibleText(
			renderToStaticMarkup(
				<FilterBar
					fields={filterFields({ ...FACETS, companyTag: [] }, {})}
					onChange={() => {}}
					strongCount={7}
					textFilters={[]}
					view={{}}
				/>,
			),
		);
		assert.ok(!seen.includes("入职前公司"), `空维度还占着位置：${seen}`);
	});
});

describe("不点开也知道现在筛的是什么", () => {
	/*
	 * 选中的值必须长在按钮上。丢了它，界面上就没有任何东西解释「为什么只剩
	 * 这几个人」——那正是把筛选摊开成一整列本来能白拿、收进弹层之后必须
	 * 另外买回来的东西。
	 */
	test("选中之后按钮上写的是值，不是维度名", () => {
		const seen = render({ kind: "internal", minMonths: 12 });
		assert.ok(seen.includes("公司内经历"), seen);
		assert.ok(seen.includes("1 年"), seen);
		assert.ok(!seen.includes("经历来源"), `选中后还在写维度名：${seen}`);
	});

	test("选项文案是人话，不是 URL 里的裸值", () => {
		assert.ok(!render({ kind: "internal" }).includes("internal"));
	});

	test("序列的值也写全，哪怕它排在第 9 位", () => {
		// 已选中的那一项永远不该需要人去找，无论它在选项表里排第几
		assert.ok(render({ seq: "技术/序列8" }).includes("技术 · 序列8"));
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

describe("证据要求", () => {
	test("没点亮时按钮上带着人数：点下去还剩几个人，不点开就知道", () => {
		// 有了这个数，名单那边就不必再写一句「已排除 N 人」：同一件事的另一种说法
		assert.match(render({}), /岗位或序列命中\s*7/);
	});
});

describe("不给死路", () => {
	test("一个人都数不出来时，证据要求那枚按钮不出现", () => {
		// 点下去必然清空名单。其余四维靠「数不出人的选项不进分面」自动做到
		// 这件事，只有这一维是布尔的，没有选项列表可以空。
		const seen = visibleText(
			renderToStaticMarkup(
				<FilterBar
					fields={filterFields(FACETS, {})}
					onChange={() => {}}
					strongCount={0}
					textFilters={[]}
					view={{}}
				/>,
			),
		);
		assert.ok(!seen.includes("岗位或序列命中"), seen);
	});

	test("已经点亮的那一枚永远留着，否则没有任何东西能取消它", () => {
		const seen = visibleText(
			renderToStaticMarkup(
				<FilterBar
					fields={filterFields(FACETS, { strong: true })}
					onChange={() => {}}
					strongCount={0}
					textFilters={[]}
					view={{ strong: true }}
				/>,
			),
		);
		assert.ok(seen.includes("岗位或序列命中"), seen);
	});
});
