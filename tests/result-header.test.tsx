/**
 * 名单表头上那个「只看任职记录可查的」。
 *
 * 它是这套检索里最容易被点错也最值钱的一个开关：打开之后，每一条必须条件都得
 * 有受控证据（任职记录）才算命中，只在简历里提过的人一律不算。所以这里测三件
 * 事——它说人话、它先告诉你点下去还剩几个人、它不给死路。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultHeader } from "#/routes/s/$turnId/-components/result-list";
import type { TermPlan } from "#/search/result";
import { visibleText } from "./render";

const TERMS: TermPlan[] = [
	{ term: "算法", members: [{ text: "算法", tier: "said" }], mode: "must" },
];

const render = (strong: boolean, strongOn: number, terms = TERMS) =>
	visibleText(
		renderToStaticMarkup(
			<ResultHeader
				loading={false}
				onChange={() => {}}
				order="relevance"
				strong={strong}
				strongOn={strongOn}
				terms={terms}
				total={38}
			/>,
		),
	);

describe("这份名单是什么", () => {
	test("报数和排序依据都在", () => {
		const seen = render(false, 7);
		assert.ok(seen.includes("38"), seen);
		assert.ok(seen.includes("按相关度排序"), seen);
	});

	test("一个条件都没有时不画图例，也不画那个开关", () => {
		// 没有点可对照的时候，图例解释的是不存在的东西
		const seen = render(false, 7, []);
		assert.ok(!seen.includes("匹配来源"), seen);
		assert.ok(!seen.includes("只看任职记录可查的"), seen);
	});
});

describe("只看任职记录可查的", () => {
	test("名字说的是留下什么，不是命中了哪个字段", () => {
		// 「序列」是 HR 的字段名，招聘的人不认得它
		const seen = render(false, 7);
		assert.ok(seen.includes("只看任职记录可查的"), seen);
	});

	test("关着的时候带着人数：点下去还剩几个，不点就知道", () => {
		// 有了这个数，名单那边就不必再写一句「已排除 N 人」：同一件事的另一种说法
		assert.match(render(false, 7), /只看任职记录可查的\s*7/);
	});

	test("它紧挨着解释它的那三颗点", () => {
		const seen = render(false, 7);
		const legend = seen.indexOf("岗位或序列");
		const toggle = seen.indexOf("只看任职记录可查的");
		assert.ok(legend >= 0 && toggle > legend, seen);
	});
});

describe("不给死路", () => {
	test("一个人都数不出来时这个开关不出现", () => {
		// 点下去必然清空名单。左栏那几维把数到 0 的那一行禁用掉就完事了，
		// 只有这一档是布尔的，没有行可以禁用。
		assert.ok(!render(false, 0).includes("只看任职记录可查的"));
	});

	test("已经打开的永远留着，否则没有任何东西能关掉它", () => {
		assert.ok(render(true, 0).includes("只看任职记录可查的"));
	});
});
