/**
 * 名单的表头：这份名单有多少人、按什么排。
 *
 * 它上面没有开关，也没有图例：点只说命中没有，来源用字写在证据行上。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ResultHeader } from "#/routes/s/$turnId/-components/result-state";
import { visibleText } from "./render";

const render = () =>
	visibleText(
		renderToStaticMarkup(
			<ResultHeader order="evidence" total={38} wait={null} />,
		),
	);

describe("这份名单是什么", () => {
	test("人数和排序依据都在", () => {
		const seen = render();
		assert.ok(seen.includes("38"), seen);
		assert.ok(seen.includes("按匹配度排序"), seen);
	});
});
