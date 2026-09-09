/**
 * 手敲查询的一行语法。它只是命令行、验收用例和测试夹具的输入便利，产品里
 * 没有任何一处读写这行字，所以这里只测记号怎么读——收窄归 `term.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseQuery } from "#/search/query-syntax";
import type { Term } from "#/search/term";

const exp = (mode: Term["mode"], ...values: [string, ...string[]]): Term => ({
	field: "experience",
	mode,
	values,
});

describe("一行查询语法", () => {
	test("没有记号就是「必须」的经历词", () => {
		assert.deepEqual(parseQuery("线下渠道运营,带团队"), [
			exp("must", "线下渠道运营"),
			exp("must", "带团队"),
		]);
	});

	test("半角逗号分条件，`+` `-` 定强度，`/` 并列取值", () => {
		assert.deepEqual(parseQuery("大模型/推荐系统,+带团队,-实习"), [
			exp("must", "大模型", "推荐系统"),
			exp("boost", "带团队"),
			exp("exclude", "实习"),
		]);
	});

	test("`字段:` 前缀是范围维度；认不出的前缀就是经历词里的字", () => {
		assert.deepEqual(parseQuery("+org:字节,level:D7/D8,kind:external,x:y"), [
			{ field: "org", mode: "boost", values: ["字节"] },
			{ field: "level", mode: "must", values: ["D7", "D8"] },
			{ field: "kind", mode: "must", values: ["external"] },
			exp("must", "x:y"),
		]);
	});

	test("条件开头的 `~` 是停用，叠在强度符号前面", () => {
		assert.deepEqual(parseQuery("~渠道运营,~+带团队/带项目,~-实习"), [
			{ ...exp("must", "渠道运营"), off: "user" },
			{ ...exp("boost", "带团队", "带项目"), off: "user" },
			{ ...exp("exclude", "实习"), off: "user" },
		]);
	});

	test("逗号、斜杠之外的字都是取值的一部分：没有第二套切词", () => {
		assert.deepEqual(parseQuery("+算法、产品"), [exp("boost", "算法、产品")]);
		assert.deepEqual(parseQuery("大模型或推荐系统"), [
			exp("must", "大模型或推荐系统"),
		]);
		assert.deepEqual(parseQuery("C++/Java"), [exp("must", "C++", "Java")]);
	});

	test("空组、只有记号的组都跳过；两头的空白不算字", () => {
		assert.deepEqual(parseQuery(" 算法 ,,+, ,-,~,~+, machine learning "), [
			exp("must", "算法"),
			exp("must", "machine learning"),
		]);
		assert.deepEqual(parseQuery(""), []);
	});
});
