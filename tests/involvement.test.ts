import assert from "node:assert/strict";
import test from "node:test";
import {
	INVOLVEMENTS,
	involvementRank,
	isInvolvement,
} from "#/lib/involvement";

test("参与方式的合法值与显示顺序由同一份契约定义", () => {
	assert.equal(isInvolvement("负责建设"), true);
	assert.equal(isInvolvement("临时值"), false);
	assert.deepEqual(
		[...INVOLVEMENTS].sort((a, b) => involvementRank(a) - involvementRank(b)),
		INVOLVEMENTS,
	);
	assert.equal(involvementRank(null), INVOLVEMENTS.length);
	assert.equal(involvementRank("临时值"), INVOLVEMENTS.length);
});
