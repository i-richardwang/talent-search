/**
 * 名单表头上那个「仅岗位或序列」。
 *
 * 它是这套检索里最容易被点错也最值钱的一个开关：打开之后，每一条必须条件都得
 * 有受控证据（任职记录）才算命中，只在简历里提过的人一律不算。所以这里测三件
 * 事——它说人话、它先告诉你点下去还剩几个人、它不给死路。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultHeader } from "#/routes/s/$turnId/-components/result-list";
import type { Claim } from "#/search/result";
import { visibleText } from "./render";

const CLAIMS: Claim[] = [{ about: "experience", mode: "must", what: ["算法"] }];

const markup = (
	strong: boolean,
	strongOn: number,
	claims = CLAIMS,
	picking = false,
) =>
	renderToStaticMarkup(
		<ResultHeader
			claims={claims}
			loading={false}
			onChange={() => {}}
			onPicking={() => {}}
			order="relevance"
			pickable
			picking={picking}
			planned={claims.length > 0}
			strong={strong}
			strongOn={strongOn}
			total={38}
		/>,
	);

const render = (strong: boolean, strongOn: number, claims = CLAIMS) =>
	visibleText(markup(strong, strongOn, claims));

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
		assert.ok(!seen.includes("仅岗位或序列"), seen);
	});
});

describe("仅岗位或序列", () => {
	test("和图例最强那一档说同一句话", () => {
		const seen = render(false, 7);
		assert.ok(seen.includes("仅岗位或序列"), seen);
	});

	test("关着的时候带着人数：点下去还剩几个，不点就知道", () => {
		// 有了这个数，名单那边就不必再写一句「已排除 N 人」：同一件事的另一种说法
		assert.match(render(false, 7), /仅岗位或序列\s*7/);
	});

	test("它紧挨着解释它的那三颗点", () => {
		const seen = render(false, 7);
		const legend = seen.indexOf("岗位或序列");
		const toggle = seen.indexOf("仅岗位或序列");
		assert.ok(legend >= 0 && toggle > legend, seen);
	});
});

describe("不给死路", () => {
	test("一个人都数不出来时这个开关按不下去，但位子还在", () => {
		// 点下去必然清空名单，所以它不能可点；而抽掉它，表头这一行会随着结果
		// 落地长高一档、整份名单往下跳一次。左栏那几维处理死路的办法也正是
		// 把数到 0 的那一行禁用掉、留在原地（`filter-rail.tsx` 开头）。
		const html = markup(false, 0);
		assert.ok(html.includes("仅岗位或序列"), html);
		assert.match(
			html.slice(0, html.indexOf("仅岗位或序列")),
			/<button[^>]*\sdisabled=""/,
		);
	});

	test("已经打开的永远留着，否则没有任何东西能关掉它", () => {
		assert.ok(render(true, 0).includes("仅岗位或序列"));
	});
});

describe("挑人", () => {
	test("它是一次动作，不是这份名单的一种性质", () => {
		/*
		 * 它左边那个「仅岗位或序列」按下去会让人从名单上消失，是这份名单的性质，
		 * 所以是个按下态的开关；挑人按下去一个人不少。两件事做成同款控件并排，
		 * 等于宣称它们是一类——所以这一行里带按下态的只能有一个。
		 */
		const html = markup(false, 7);
		assert.ok(html.includes("挑人导出"), html);
		assert.equal((html.match(/aria-pressed/g) ?? []).length, 1, html);
	});

	test("进和出都写成这一下要做的事", () => {
		// 现在在哪一档由名单左边那一列框说，不由一个按下去的样子说
		assert.ok(visibleText(markup(false, 7, CLAIMS, true)).includes("退出挑人"));
	});
});
