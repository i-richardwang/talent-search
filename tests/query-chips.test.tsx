/**
 * chip 上写什么。每一项只显示代表取值，其余不上 chip、只留一个记号——一排 chip
 * 得读得过来；经历主张和人的条件是同一种 chip。菜单是弹层，静态渲染画不出来：
 * 菜单里的几个动作各是 `condition.ts` 里的一个纯函数，归 `tests/condition.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryChips } from "#/routes/s/$turnId/-components/query-chips";
import type { Condition } from "#/search/condition";
import { visibleText } from "./render";

const seen = (conditions: Condition[]) =>
	visibleText(
		renderToStaticMarkup(
			<QueryChips conditions={conditions} onChange={() => {}} />,
		),
	);

describe("查询 chip", () => {
	test("经历词只写代表词，其余取值不写、只留记号", () => {
		const text = seen([
			{
				about: "experience",
				mode: "must",
				what: ["大模型", "LLM", "推荐系统"],
			},
		]);
		assert.match(text, /大模型/);
		assert.match(text, /≈/);
		assert.doesNotMatch(text, /LLM|推荐系统/, "其余取值不上 chip");
	});

	test("人的条件也只写代表词：十档职级是一个 chip，不是一行放不下的文字", () => {
		const text = seen([
			{
				about: "person",
				mode: "boost",
				field: "level",
				values: ["D8", "D9", "D10", "M5", "M6", "S6"],
			},
		]);
		assert.match(text, /当前职级 · D8/);
		assert.match(text, /≈/);
		assert.doesNotMatch(text, /D9|M5|S6/);
	});

	test("一条主张的各项都在 chip 上，读起来就是那句话", () => {
		const text = seen([
			{
				about: "experience",
				mode: "must",
				what: ["增长"],
				companyTag: ["大厂"],
				kind: "external",
				minMonths: 36,
			},
		]);
		assert.match(text, /入职前经历 · 大厂 · 增长 · ≥ 3 年/);
		assert.doesNotMatch(text, /≈/, "每项只有一个取值，没有「还有」");
	});

	test("只有一个取值就没有记号：默认状态不该有标记", () => {
		const text = seen([{ about: "experience", mode: "must", what: ["算法"] }]);
		assert.doesNotMatch(text, /≈/);
	});

	test("「待过字节」是一条只有公司名的主张，偏好带加号，和加分的经历词同一个记号", () => {
		const text = seen([
			{ about: "experience", mode: "boost", org: ["字节"] },
			{ about: "experience", mode: "boost", what: ["带团队"] },
		]);
		assert.match(text, /\+\s*字节/);
		assert.match(text, /\+\s*带团队/);
	});

	test("自动停用的写「太宽」，自己停的不写", () => {
		const wide = seen([
			{ about: "experience", mode: "must", what: ["经理"], off: "wide" },
		]);
		assert.match(wide, /太宽/);
		const user = seen([
			{ about: "experience", mode: "must", what: ["经理"], off: "user" },
		]);
		assert.doesNotMatch(user, /太宽/);
	});
});
