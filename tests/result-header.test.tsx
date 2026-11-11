/**
 * 名单的表头：这份名单有多少人、按什么排；等待时写在做什么。
 *
 * 它上面没有开关，也没有图例：点只说命中没有，来源用字写在证据行上。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { internalWordsIn } from "#/lib/internal-words";
import { ResultHeader } from "#/routes/s/$turnId/-components/result-state";
import type { ListWait } from "#/routes/s/$turnId/-lib/nav-phase";
import { visibleText } from "./render";

const render = (wait: ListWait | null = null, total = 38) =>
	visibleText(
		renderToStaticMarkup(
			<ResultHeader order="evidence" total={total} wait={wait} />,
		),
	);

describe("这份名单是什么", () => {
	test("人数和排序依据都在", () => {
		assert.match(render(), /^38\s*人 · 按匹配度排序$/);
		assert.match(render(null, 1_200), /^1,200\s*人/);
	});

	test("等待时这一格只说在做什么，不写人数", () => {
		const seen = render({ list: "dim", phase: "searching", since: null });
		assert.match(seen, /正在搜索/);
		assert.doesNotMatch(seen, /38/);
	});

	test("AI 在补人：名单上已有的人照常成立，人数照写，后面跟着在做什么；一个人都还没有时只说在做什么", () => {
		const completing = {
			list: "keep",
			phase: "completing",
			since: null,
		} as const;
		const seen = render(completing);
		assert.match(seen, /^38\s*人 · 按匹配度排序 · 正在补充符合新条件的人…$/);
		assert.deepEqual(internalWordsIn(seen), []);
		assert.equal(render(completing, 0), "正在补充符合新条件的人…");
	});
});
