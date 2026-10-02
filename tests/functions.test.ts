/**
 * 服务端函数的进程边界：不可信载荷必须先转换成领域里的判别联合。
 *
 * 入参校验是纯函数（`search/commit-input.ts`），所以这里不起数据库、不起假端点——
 * 一条校验规则不该要一个 Postgres 才验得动。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { validateCommit } from "#/search/commit-input";

describe("提交查询的服务端边界", () => {
	test("两种输入各自只接受自己的形状", () => {
		assert.deepEqual(
			validateCommit({ input: { kind: "sentence", text: " 算法 " } }),
			{
				from: undefined,
				input: { kind: "sentence", text: "算法" },
			},
		);
		assert.deepEqual(
			validateCommit({
				input: {
					kind: "spec",
					spec: {
						conditions: [
							{
								about: "experience",
								mode: "boost",
								what: ["经理"],
								off: "wide",
							},
						],
					},
				},
			}),
			{
				from: undefined,
				input: {
					kind: "spec",
					spec: {
						conditions: [
							{
								about: "experience",
								mode: "boost",
								what: ["经理"],
								off: "wide",
							},
						],
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
			/查询格式无效/,
		);
	});
	test("删除最后一条条件后仍能保存完整的空表，畸形条件不能伪装为空表", () => {
		assert.deepEqual(
			validateCommit({
				from: "seen",
				input: { kind: "spec", spec: { conditions: [] } },
			}),
			{
				from: "seen",
				input: { kind: "spec", spec: { conditions: [] } },
			},
		);
		assert.throws(
			() =>
				validateCommit({ input: { kind: "spec", spec: { conditions: [{}] } } }),
			/搜索条件无效/,
		);
	});
});
