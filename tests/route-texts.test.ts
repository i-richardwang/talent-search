/**
 * 一段经历有哪些说法。
 *
 * 它决定了库里那些向量是从什么字符串来的：序列三级用「 · 」连、公司内用完整
 * 部门路径、空的那一类不嵌、自述只有一份读法。灌库和测试夹具用的是同一个函数，
 * 所以这里测的不是「两处一不一致」，而是**拼法本身**——改了它，库里的向量和
 * 查询词就不再可比，而症状只是结果悄悄变差。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Extraction } from "#/corpus/extract";
import { phrasesOf, type RouteSource } from "#/corpus/route-texts";

const of = (row: Partial<RouteSource>, extraction: Extraction | null = null) =>
	Object.fromEntries(
		phrasesOf(
			{
				kind: "internal",
				org: "",
				orgPath: "",
				title: "",
				seqL1: "",
				seqL2: "",
				seqL3: "",
				description: "",
				...row,
			},
			extraction,
		).map((p) => [p.route, p.text]),
	);

describe("登记的三类 route", () => {
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

	test("序列有三级就三级都写出来", () => {
		assert.equal(
			of({ seqL1: "技术", seqL2: "算法", seqL3: "推荐" }).seq,
			"技术 · 算法 · 推荐",
		);
	});

	test("公司内经历缺部门路径时落回部门名", () => {
		assert.equal(of({ org: "平台技术部", orgPath: "" }).org, "平台技术部");
	});

	test("入职前经历嵌公司名，有部门路径也不用", () => {
		assert.equal(
			of({ kind: "external", org: "云枢智能", orgPath: "云枢智能/算法部" }).org,
			"云枢智能",
		);
	});

	test("空的 route 不出现，一行全空就没有 route", () => {
		assert.deepEqual(of({}), {});
	});
});

describe("自述只有一份读法", () => {
	const external: Partial<RouteSource> = {
		kind: "external",
		org: "云枢智能",
		description: "负责推荐系统召回，配合算法团队完成上线",
	};

	test("没读过的段，整段原文就是说法", () => {
		assert.deepEqual(of(external), {
			org: "云枢智能",
			description: "负责推荐系统召回，配合算法团队完成上线",
		});
	});

	test("读过的段，说法是读出来的能力词与做过的事，原文不再是说法", () => {
		const phrasings = phrasesOf(
			{
				kind: "external",
				org: "云枢智能",
				orgPath: "",
				title: "",
				seqL1: "",
				seqL2: "",
				seqL3: "",
				description: external.description as string,
			},
			{
				skills: ["召回"],
				did: [{ involvement: "负责建设", domain: "推荐系统" }],
			},
		);
		assert.deepEqual(phrasings, [
			{ route: "org", text: "云枢智能", involvement: null },
			{ route: "skill", text: "召回", involvement: null },
			{ route: "did", text: "推荐系统", involvement: "负责建设" },
		]);
	});

	test("读过但什么都没读出来，也不退回原文：那是模型说这段没有可找的能力", () => {
		assert.deepEqual(of(external, { skills: [], did: [] }), {
			org: "云枢智能",
		});
	});
});
