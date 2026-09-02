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
				input: { kind: "reinterpret", note: " 指的是推荐算法 " },
			}),
			{
				parentTurnId: "parent",
				input: { kind: "reinterpret", note: "指的是推荐算法" },
			},
		);
		assert.deepEqual(
			validateCommit({ input: { kind: "chips", q: "*+经理" } }),
			{
				parentTurnId: undefined,
				input: {
					kind: "chips",
					chips: [{ term: "经理", mode: "boost", off: true, wide: true }],
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
			() => validateCommit({ input: { kind: "chips", q: {} } }),
			/查询格式无效/,
		);
	});
});
