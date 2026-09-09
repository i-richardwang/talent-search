/**
 * chip 上写什么。代表词露出来，其余取值不上 chip、只留一个记号——一排 chip
 * 得读得过来；经历词和范围是同一种 chip。菜单是弹层，静态渲染画不出来：
 * 菜单里的四个动作各是 `term.ts` 里的一个纯函数，归 `tests/term.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryChips } from "#/routes/s/$turnId/-components/query-chips";
import type { Term } from "#/search/term";
import { visibleText } from "./render";

const seen = (terms: Term[]) =>
	visibleText(
		renderToStaticMarkup(<QueryChips onChange={() => {}} terms={terms} />),
	);

describe("查询 chip", () => {
	test("经历词只写代表词，其余取值不写、只留记号", () => {
		const text = seen([
			{
				field: "experience",
				mode: "must",
				values: ["大模型", "LLM", "推荐系统"],
			},
		]);
		assert.match(text, /大模型/);
		assert.match(text, /≈/);
		assert.doesNotMatch(text, /LLM|推荐系统/, "其余取值不上 chip");
	});

	test("范围条件也只写代表词：十档职级是一枚 chip，不是一行念不完的字", () => {
		const text = seen([
			{
				field: "level",
				mode: "boost",
				values: ["D8", "D9", "D10", "M5", "M6", "S6"],
			},
		]);
		assert.match(text, /当前职级 · D8/);
		assert.match(text, /≈/);
		assert.doesNotMatch(text, /D9|M5|S6/);
	});

	test("只有一个取值就没有记号：默认状态不该有标记", () => {
		const text = seen([
			{ field: "experience", mode: "must", values: ["算法"] },
		]);
		assert.doesNotMatch(text, /≈/);
	});

	test("范围条件带一次维度名，偏好带加号，和加分的经历词同一个记号", () => {
		const text = seen([
			{ field: "org", mode: "boost", values: ["字节"] },
			{ field: "experience", mode: "boost", values: ["带团队"] },
		]);
		assert.match(text, /\+\s*组织 · 字节/);
		assert.match(text, /\+\s*带团队/);
	});

	test("自动停用的写「太宽」，自己停的不写", () => {
		const wide = seen([
			{ field: "experience", mode: "must", values: ["经理"], off: "wide" },
		]);
		assert.match(wide, /太宽/);
		const user = seen([
			{ field: "experience", mode: "must", values: ["经理"], off: "user" },
		]);
		assert.doesNotMatch(user, /太宽/);
	});
});
