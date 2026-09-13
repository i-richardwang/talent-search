/**
 * 手敲查询的一行语法。它只是命令行、验收用例和测试夹具的输入便利，产品里
 * 没有任何一处读写这行字，所以这里只测记号怎么读——收窄归 `condition.test.ts`。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Condition, Mode } from "#/search/condition";
import { parseQuery } from "#/search/query-syntax";
import { claim } from "./conditions";

const exp = (mode: Mode, ...what: [string, ...string[]]): Condition =>
	claim(what, { mode });

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

	test("带 `键:` 的项并进同一条主张：它们说的是同一段经历", () => {
		assert.deepEqual(
			parseQuery("增长/用户增长 kind:external companyTag:大厂 minMonths:36"),
			[
				{
					about: "experience",
					mode: "must",
					what: ["增长", "用户增长"],
					companyTag: ["大厂"],
					kind: "external",
					minMonths: 36,
				},
			],
		);
		// 只有键没有词的主张：「待过字节」
		assert.deepEqual(parseQuery("+org:字节/腾讯"), [
			{ about: "experience", mode: "boost", org: ["字节", "腾讯"] },
		]);
	});

	test("人的条件自成一条；认不出的键就是经历词里的字", () => {
		assert.deepEqual(parseQuery("+level:D7/D8,school:清华,x:y"), [
			{ about: "person", mode: "boost", field: "level", values: ["D7", "D8"] },
			{ about: "person", mode: "must", field: "school", values: ["清华"] },
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

	test("逗号、斜杠、键之外的字都是取值的一部分：没有第二套切词", () => {
		assert.deepEqual(parseQuery("+算法、产品"), [exp("boost", "算法、产品")]);
		assert.deepEqual(parseQuery("大模型或推荐系统"), [
			exp("must", "大模型或推荐系统"),
		]);
		assert.deepEqual(parseQuery("C++/Java"), [exp("must", "C++", "Java")]);
		// 没有键的几段字连成一个词，英文词组不会被空格切成两个
		assert.deepEqual(parseQuery("machine learning kind:external"), [
			{ ...exp("must", "machine learning"), kind: "external" },
		]);
	});

	test("空组、只有记号的组都跳过；两头的空白不算字", () => {
		assert.deepEqual(parseQuery(" 算法 ,,+, ,-,~,~+, machine learning "), [
			exp("must", "算法"),
			exp("must", "machine learning"),
		]);
		assert.deepEqual(parseQuery(""), []);
	});
});
