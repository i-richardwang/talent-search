/**
 * 名单的表头：这份名单有多少人、按什么排、那三颗点各是什么意思，以及「选择」。
 *
 * 它上面没有开关——证据的成色由名次和点阵说，不由一个要先读懂图例才会用的
 * 按钮说（`search/weights.ts`）。所以这里测的是：它说得出这份名单是什么，
 * 没有条件时不去解释不存在的东西，而「选择」是一次动作、不是名单的一种性质。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultHeader } from "#/routes/s/$turnId/-components/result-list";
import type { Claim } from "#/search/result";
import { visibleText } from "./render";

const CLAIMS: Claim[] = [{ about: "experience", mode: "must", what: ["算法"] }];

const markup = (claims = CLAIMS, picking = false) =>
	renderToStaticMarkup(
		<ResultHeader
			claims={claims}
			loading={false}
			onPicking={() => {}}
			order="evidence"
			pickable
			picking={picking}
			planned={claims.length > 0}
			total={38}
		/>,
	);

const render = (claims = CLAIMS) => visibleText(markup(claims));

describe("这份名单是什么", () => {
	test("人数和排序依据都在", () => {
		const seen = render();
		assert.ok(seen.includes("38"), seen);
		assert.ok(seen.includes("按证据排序"), seen);
	});

	test("图例说的是三档证据，最弱那一档叫自述不叫原文", () => {
		// 「简历原文」是路的名字，只指还没读过的段；图例说的是整整一档
		const seen = render();
		assert.ok(seen.includes("匹配来源"), seen);
		assert.ok(seen.includes("简历自述"), seen);
		assert.ok(!seen.includes("简历原文"), seen);
	});

	test("一个条件都没有时不显示图例", () => {
		// 没有点可对照的时候，图例解释的是不存在的东西
		assert.ok(!render([]).includes("匹配来源"));
	});
});

describe("选择", () => {
	test("它是一次动作，不是这份名单的一种性质", () => {
		// 按下去名单一个人不少、顺序不变，所以它没有按下态
		const html = markup();
		assert.ok(html.includes("选择"), html);
		assert.ok(!html.includes("aria-pressed"), html);
	});

	test("进和出都写成这一下要做的事", () => {
		// 现在在哪一档由名单左边那一列框说，不由一个按下去的样子说
		assert.ok(visibleText(markup(CLAIMS, true)).includes("取消选择"));
	});
});
