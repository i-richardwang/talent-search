/**
 * 手敲查询的一行语法。它只是命令行、验收用例和测试夹具的输入便利，产品里
 * 没有任何一处读写这行字，所以这里只测记号怎么读——收窄归 `requirement.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { Member } from "#/search/requirement";

const said = (text: string): Member => ({ text, tier: "said" });

describe("一行查询语法", () => {
	test("没有记号就是「必须」、用户自己的说法", () => {
		assert.deepEqual(parseQuery("线下渠道运营,带团队"), [
			{ members: [said("线下渠道运营")], mode: "must" },
			{ members: [said("带团队")], mode: "must" },
		]);
	});

	test("半角逗号分要求，`+` `-` 定强度，`/` 并列说法", () => {
		assert.deepEqual(parseQuery("大模型/推荐系统,+带团队,-实习"), [
			{ members: [said("大模型"), said("推荐系统")], mode: "must" },
			{ members: [said("带团队")], mode: "boost" },
			{ members: [said("实习")], mode: "exclude" },
		]);
	});

	test("说法前的 `=` 是同义变体、`~` 是相近变体", () => {
		assert.deepEqual(parseQuery("算法/=算法工程/~推荐算法,+带团队/~带项目"), [
			{
				members: [
					said("算法"),
					{ text: "算法工程", tier: "same" },
					{ text: "推荐算法", tier: "near" },
				],
				mode: "must",
			},
			{
				members: [said("带团队"), { text: "带项目", tier: "near" }],
				mode: "boost",
			},
		]);
	});

	test("要求开头的 `~` 是停用，叠在强度符号前面；说法里的 `~` 是相近，两者不混", () => {
		assert.deepEqual(parseQuery("~渠道运营,~+带团队/~带项目,~-实习"), [
			{ members: [said("渠道运营")], mode: "must", off: true },
			{
				members: [said("带团队"), { text: "带项目", tier: "near" }],
				mode: "boost",
				off: true,
			},
			{ members: [said("实习")], mode: "exclude", off: true },
		]);
	});

	test("逗号、斜杠之外的字都是说法的一部分：没有第二套切词", () => {
		assert.deepEqual(parseQuery("+算法、产品"), [
			{ members: [said("算法、产品")], mode: "boost" },
		]);
		assert.deepEqual(parseQuery("大模型或推荐系统"), [
			{ members: [said("大模型或推荐系统")], mode: "must" },
		]);
		assert.deepEqual(parseQuery("C++/Java"), [
			{ members: [said("C++"), said("Java")], mode: "must" },
		]);
	});

	test("空组、只有记号的组都跳过；两头的空白不算字", () => {
		assert.deepEqual(parseQuery(" 算法 ,,+, ,-,~,~+, machine learning "), [
			{ members: [said("算法")], mode: "must" },
			{ members: [said("machine learning")], mode: "must" },
		]);
		assert.deepEqual(parseQuery(""), []);
	});
});
