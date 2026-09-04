/** 服务端函数的进程边界：不可信载荷必须先收成领域里的判别联合。 */
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { setup } from "./fixture";

const teardown = await setup();
after(teardown);

const { validateCommit } = await import("#/server/functions");

describe("提交查询的服务端边界", () => {
	test("三种输入各自只接受自己的形状", () => {
		assert.deepEqual(
			validateCommit({ input: { kind: "sentence", text: " 算法 " } }),
			{
				parentTurnId: undefined,
				input: { kind: "sentence", text: "算法" },
			},
		);
		assert.deepEqual(
			validateCommit({
				parentTurnId: "parent",
				input: { kind: "reinterpret" },
			}),
			{
				parentTurnId: "parent",
				input: { kind: "reinterpret" },
			},
		);
		assert.deepEqual(
			validateCommit({
				input: {
					kind: "spec",
					spec: {
						evidence: "~+经理",
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
						evidence: "~+经理",
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
