/**
 * 手敲查询的一行语法。它只是命令行、验收用例和测试夹具的输入便利，产品里
 * 没有任何一处读写这行字，所以这里只测记号怎么读——收窄归 `requirement.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";

describe("一行查询语法", () => {
	test("没有记号就是「必须」", () => {
		assert.deepEqual(parseQuery("线下渠道运营,带团队"), [
			{ members: ["线下渠道运营"], mode: "must" },
			{ members: ["带团队"], mode: "must" },
		]);
	});

	test("半角逗号分要求，`+` `-` 定强度，`/` 并列说法", () => {
		assert.deepEqual(parseQuery("大模型/推荐系统,+带团队,-实习"), [
			{ members: ["大模型", "推荐系统"], mode: "must" },
			{ members: ["带团队"], mode: "boost" },
			{ members: ["实习"], mode: "exclude" },
		]);
	});

	test("`~` 叠在强度符号前面是停用，强度原样留着", () => {
		assert.deepEqual(parseQuery("~渠道运营,~+带团队,~-实习"), [
			{ members: ["渠道运营"], mode: "must", off: true },
			{ members: ["带团队"], mode: "boost", off: true },
			{ members: ["实习"], mode: "exclude", off: true },
		]);
	});

	test("逗号、斜杠之外的字都是说法的一部分：没有第二套切词", () => {
		assert.deepEqual(parseQuery("+算法、产品"), [
			{ members: ["算法、产品"], mode: "boost" },
		]);
		assert.deepEqual(parseQuery("大模型或推荐系统"), [
			{ members: ["大模型或推荐系统"], mode: "must" },
		]);
		assert.deepEqual(parseQuery("C++/Java"), [
			{ members: ["C++", "Java"], mode: "must" },
		]);
	});

	test("空组、只有记号的组都跳过；两头的空白不算字", () => {
		assert.deepEqual(parseQuery(" 算法 ,,+, ,-,~,~+, machine learning "), [
			{ members: ["算法"], mode: "must" },
			{ members: ["machine learning"], mode: "must" },
		]);
		assert.deepEqual(parseQuery(""), []);
	});
});
