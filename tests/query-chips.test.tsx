/**
 * chip 上写什么。用户自己的说法露出来，模型补的变体不上 chip、只留一个记号——
 * 「我说的」和「它补的」不能在同一排混成一样的字。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryChips } from "#/routes/s/$turnId/-components/query-chips";
import type { Requirement } from "#/search/requirement";
import { visibleText } from "./render";

const seen = (requirements: Requirement[]) =>
	visibleText(
		renderToStaticMarkup(
			<QueryChips
				onChange={() => {}}
				requirements={requirements}
				wide={new Set()}
			/>,
		),
	);

describe("查询 chip", () => {
	test("用户的几个说法平着写，变体不写、只留记号", () => {
		const text = seen([
			{
				members: [
					{ text: "大模型", tier: "said" },
					{ text: "推荐系统", tier: "said" },
					{ text: "LLM", tier: "same" },
					{ text: "推荐算法", tier: "near" },
				],
				mode: "must",
			},
		]);
		assert.match(text, /大模型 \/ 推荐系统/);
		assert.match(text, /≈/);
		assert.doesNotMatch(text, /LLM|推荐算法/, "变体收在菜单里，不上 chip");
	});

	test("没有变体就没有记号：默认状态不该有标记", () => {
		const text = seen([
			{ members: [{ text: "算法", tier: "said" }], mode: "must" },
		]);
		assert.doesNotMatch(text, /≈/);
	});
});
