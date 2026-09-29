/**
 * 名单的表头：这份名单有多少人、按什么排、那三颗点各是什么意思。
 *
 * 它上面没有开关——证据的强弱由名次和点阵说，不由一个要先读懂图例才会用的
 * 按钮说（`search/weights.ts`）。所以这里测的是：它说得出这份名单是什么，
 * 没有条件时不去解释不存在的东西。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultHeader } from "#/routes/s/$turnId/-components/result-state";
import { visibleText } from "./render";

const markup = (evidence = true) =>
	renderToStaticMarkup(
		<ResultHeader
			evidence={evidence}
			order="evidence"
			phase={null}
			total={38}
		/>,
	);

const render = (evidence = true) => visibleText(markup(evidence));

describe("这份名单是什么", () => {
	test("人数和排序依据都在", () => {
		const seen = render();
		assert.ok(seen.includes("38"), seen);
		assert.ok(seen.includes("按匹配度排序"), seen);
	});

	test("有证据行时表头带图例的入口，三档的说明悬停才展开", () => {
		const seen = render();
		assert.ok(seen.includes("匹配来源"), seen);
		assert.ok(!seen.includes("简历自述"), seen);
	});

	test("没有证据行时不显示图例", () => {
		// 没有点可对照的时候，图例解释的是不存在的东西
		assert.ok(!render(false).includes("匹配来源"));
	});
});
