/**
 * 四路原文的拼法。
 *
 * 它决定了库里那些向量是从什么字符串来的：序列三级用「 · 」连、公司内用完整
 * 部门路径、空的那一路不嵌。灌库和测试夹具用的是同一个函数，所以这里测的不是
 * 「两处一不一致」，而是**拼法本身**——改了它，库里的向量和查询词就不再可比，
 * 而症状只是结果悄悄变差。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type RouteSource, routeTexts } from "#/corpus/route-texts";

const of = (row: Partial<RouteSource>) =>
	Object.fromEntries(
		routeTexts({
			kind: "internal",
			org: "",
			orgPath: "",
			title: "",
			seqL1: "",
			seqL2: "",
			seqL3: "",
			description: "",
			...row,
		}),
	);

describe("四路原文的拼法", () => {
	test("公司内经历嵌完整部门路径，序列按级连起来", () => {
		assert.deepEqual(
			of({
				org: "平台技术部",
				orgPath: "示例科技/技术中心/平台技术部",
				title: "算法工程师",
				seqL1: "技术",
				seqL2: "算法",
			}),
			{
				seq: "技术 · 算法",
				title: "算法工程师",
				org: "示例科技/技术中心/平台技术部",
			},
		);
	});

	test("序列有三级就连三级", () => {
		assert.equal(
			of({ seqL1: "技术", seqL2: "算法", seqL3: "推荐" }).seq,
			"技术 · 算法 · 推荐",
		);
	});

	test("公司内经历缺部门路径时落回部门名", () => {
		assert.equal(of({ org: "平台技术部", orgPath: "" }).org, "平台技术部");
	});

	test("入职前经历嵌公司名与简历描述，有部门路径也不用", () => {
		assert.deepEqual(
			of({
				kind: "external",
				org: "云枢智能",
				orgPath: "云枢智能/算法部",
				title: "算法工程师",
				description: "负责推荐系统召回",
			}),
			{
				title: "算法工程师",
				org: "云枢智能",
				description: "负责推荐系统召回",
			},
		);
	});

	test("空的那一路不出现，一行全空就一路都没有", () => {
		assert.deepEqual(of({}), {});
	});
});
