/**
 * 关键词模式的框和条件表之间的往返。纯规则，不起数据库。
 *
 * 结果页把当前的条件表填回框里接着改，所以框写出的表必须原样读得回来；
 * 框写不出的表必须读不回来，不能拿删掉几条的框冒充它（`server/turn.ts` 据此拒收）。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	conditionsOfKeywords,
	type Keywords,
	keywordsOf,
	keywordTitle,
	NO_KEYWORDS,
} from "#/search/keywords";
import { parseQuery } from "#/search/query-syntax";

const k = (over: Partial<Keywords>): Keywords => ({ ...NO_KEYWORDS, ...over });

describe("框 → 条件表", () => {
	test("做过什么每个词一条必须主张；公司、学校各一条，词之间满足其一", () => {
		assert.deepEqual(
			conditionsOfKeywords(
				k({
					what: ["推荐", "机器学习"],
					org: ["字节", "快手"],
					school: ["浙大"],
				}),
			),
			[
				{ about: "experience", mode: "must", what: ["推荐"] },
				{ about: "experience", mode: "must", what: ["机器学习"] },
				{ about: "experience", mode: "must", org: ["字节", "快手"] },
				{ about: "person", mode: "must", field: "school", values: ["浙大"] },
			],
		);
	});

	test("年限挂在做过什么的每一条上，各自累计；没有做过什么就不起作用", () => {
		assert.deepEqual(
			conditionsOfKeywords(k({ what: ["推荐", "搜索"], minMonths: 36 })),
			[
				{ about: "experience", mode: "must", what: ["推荐"], minMonths: 36 },
				{ about: "experience", mode: "must", what: ["搜索"], minMonths: 36 },
			],
		);
		assert.deepEqual(
			conditionsOfKeywords(k({ org: ["字节"], minMonths: 36 })),
			[{ about: "experience", mode: "must", org: ["字节"] }],
		);
	});

	test("什么都没填就是一条条件都没有", () => {
		assert.deepEqual(conditionsOfKeywords(NO_KEYWORDS), []);
	});
});

describe("条件表 → 框", () => {
	test("框写出的表原样读回来", () => {
		const cases = [
			k({
				what: ["推荐", "机器学习"],
				org: ["字节"],
				school: ["浙大", "清华"],
			}),
			k({ what: ["推荐"], minMonths: 30 }),
			k({ school: ["浙大"] }),
		];
		for (const one of cases)
			assert.deepEqual(keywordsOf(conditionsOfKeywords(one)), one);
	});

	test("框写不出的表读不回来", () => {
		for (const query of ["+算法", "-实习", "~算法", "算法/推荐"])
			assert.equal(keywordsOf(parseQuery(query)), null, query);
		// 一条主张里既有公司又有做过什么：同一段经历，框说不出来
		assert.equal(
			keywordsOf([
				{ about: "experience", mode: "must", what: ["推荐"], org: ["字节"] },
			]),
			null,
		);
	});
});

test("标题是框里的词，按框的顺序", () => {
	assert.equal(
		keywordTitle(
			k({
				what: ["推荐", "搜索"],
				org: ["字节"],
				school: ["浙大"],
				minMonths: 36,
			}),
		),
		"推荐、搜索 · 字节 · 浙大 · 累计 ≥ 3 年",
	);
});
