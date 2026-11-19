/** 组织路径的规则：规范写法、包含关系、一个账号的几个组织和组织树。纯规则，不启动数据库。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { orgPathOf, orgsOf, orgTree, within } from "#/lib/org";

test("规范写法：每一级去掉空白，空的级不算", () => {
	assert.equal(orgPathOf(" 甲 > 乙 >> 丙 "), "甲>乙>丙");
	assert.equal(orgPathOf("  "), "");
});

test("包含按整级比：名字相同开头的兄弟组织不算在下面", () => {
	assert.equal(within("甲>技术中心>平台部", "甲>技术中心"), true);
	assert.equal(within("甲>技术中心", "甲>技术中心"), true);
	assert.equal(within("甲>技术中心二部", "甲>技术中心"), false);
});

test("一个账号的几个组织去掉重复和被包含的；有一个是空的或一个都没有不收", () => {
	assert.deepEqual(orgsOf(["甲>乙>丙", "甲>乙", " 甲>乙 ", "丁"]), [
		"丁",
		"甲>乙",
	]);
	assert.equal(orgsOf([]), null);
	assert.equal(orgsOf(["甲", " > "]), null);
});

test("组织树：上级在前，人数连同下面的各级", () => {
	assert.deepEqual(
		orgTree([
			{ path: "甲>乙>丙", people: 2 },
			{ path: "甲>乙", people: 1 },
			{ path: "甲>丁", people: 4 },
		]).map((n) => [n.path, n.depth, n.people]),
		[
			["甲", 0, 7],
			["甲>丁", 1, 4],
			["甲>乙", 1, 3],
			["甲>乙>丙", 2, 2],
		],
	);
});
