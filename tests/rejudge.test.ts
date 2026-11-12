import assert from "node:assert/strict";
import { test } from "node:test";
import { rejudgeOf } from "#/lib/task";

test("重新判定的范围只认三种，形状不对的是 null", () => {
	assert.deepEqual(rejudgeOf({ scope: "all", word: "多余的" }), {
		scope: "all",
	});
	assert.deepEqual(rejudgeOf({ scope: "excluded" }), { scope: "excluded" });
	assert.deepEqual(rejudgeOf({ scope: "term", word: "培训" }), {
		branch: false,
		scope: "term",
		word: "培训",
	});
	assert.deepEqual(rejudgeOf({ branch: true, scope: "term", word: "培训" }), {
		branch: true,
		scope: "term",
		word: "培训",
	});
	for (const raw of [
		null,
		"all",
		{},
		{ scope: "term" },
		{ scope: "term", word: "" },
		{ scope: "别的" },
	])
		assert.equal(rejudgeOf(raw), null);
});
