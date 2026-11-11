/**
 * 启动脚本只删认得出是测试临时 schema 的那些：名字认错了，删掉的就是别的 schema。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { catalogOf, ownerOf, tempSchema } from "./temp-schema";

describe("测试临时 schema 的名字", () => {
	test("夹具起的名字和它的数据目录都认得出是哪个进程建的", () => {
		const schema = tempSchema();
		assert.equal(ownerOf(schema), process.pid);
		assert.equal(ownerOf(catalogOf(schema)), process.pid);
	});

	test("别的 schema 一概不认", () => {
		for (const name of [
			"public",
			"catalog",
			"pgboss",
			"talent_test",
			"talent_test_12_zzzzzzzz",
			"talent_test_abc_0123abcd",
			"my_talent_test_12_0123abcd",
			"talent_test_12_0123abcd_other",
		])
			assert.equal(ownerOf(name), null, name);
	});
});
