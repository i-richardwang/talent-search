/**
 * 服务端函数的进程边界：不可信载荷必须先收成领域里的判别联合。
 *
 * 收窄是纯函数（`search/commit-input.ts`），所以这里不起数据库、不起假端点——
 * 一条收窄规则不该要一个 Postgres 才验得动。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCommit } from "#/search/commit-input";

describe("提交查询的服务端边界", () => {
	test("两种输入各自只接受自己的形状", () => {
		assert.deepEqual(
			validateCommit({ input: { kind: "sentence", text: " 算法 " } }),
			{
				parentTurnId: undefined,
				input: { kind: "sentence", text: "算法" },
			},
		);
		assert.deepEqual(
			validateCommit({
				input: {
					kind: "spec",
					spec: {
						requirements: [
							{
								members: [{ text: "经理", tier: "said" }],
								mode: "boost",
								off: true,
							},
						],
						scope: {},
						notices: [{ kind: "wide", term: "经理" }],
					},
				},
			}),
			{
				parentTurnId: undefined,
				input: {
					kind: "spec",
					spec: {
						requirements: [
							{
								members: [{ text: "经理", tier: "said" }],
								mode: "boost",
								off: true,
							},
						],
						scope: {},
						notices: [{ kind: "wide", term: "经理" }],
					},
				},
			},
		);
	});

	test("未知类型和非字符串查询不能落成垃圾条件", () => {
		assert.throws(
			() => validateCommit({ input: { kind: "unknown", q: "算法" } }),
			/查询格式无效/,
		);
		assert.throws(
			() => validateCommit({ input: { kind: "spec", spec: {} } }),
			/查询为空/,
		);
	});
});
