/**
 * 一段经历有哪些说法。
 *
 * 它决定了库里那些向量是从什么字符串来的：公司内一段任职是序列、岗位、部门连成的一句，
 * 入职前只有岗位名，公司名不进，空的那一样不写、全空就没有，自述每一段只取一种来源。
 * 写库和测试夹具用的是同一个函数，所以这里测的不是「两处一不一致」，而是**拼法本身**
 * ——改了它，库里的向量和查询词就不再可比，而症状只是结果悄悄变差。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Extraction } from "#/corpus/extract";
import { PHRASING, phrasesOf, type RouteSource } from "#/corpus/route-texts";

const of = (row: Partial<RouteSource>, extraction: Extraction | null = null) =>
	Object.fromEntries(
		phrasesOf(
			{
				kind: "internal",
				unemployed: false,
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

describe("公司内一段任职整句一条", () => {
	test("序列、岗位、部门路径连成一句：放在一起才分得清这个人做的是什么", () => {
		assert.deepEqual(
			of({
				org: "平台技术部",
				orgPath: "示例科技/技术中心/平台技术部",
				title: "算法工程师",
				seqL1: "技术",
				seqL2: "算法",
				seqL3: "推荐",
			}),
			{ role: "技术 · 算法 · 推荐｜算法工程师｜示例科技/技术中心/平台技术部" },
		);
	});

	test("缺的那样不写，不留空的分隔", () => {
		assert.equal(of({ seqL1: "技术", seqL2: "算法" }).role, "技术 · 算法");
		assert.equal(
			of({ title: "算法工程师", org: "平台技术部" }).role,
			"算法工程师｜平台技术部",
		);
	});

	test("缺部门路径时落回部门名", () => {
		assert.equal(of({ org: "平台技术部", orgPath: "" }).role, "平台技术部");
	});

	test("空的 route 不出现，一行全空就没有 route", () => {
		assert.deepEqual(of({}), {});
	});
});

describe("入职前的岗位", () => {
	test("岗位名原样一条；公司名只回答「在哪」，不进说法", () => {
		assert.deepEqual(
			of({
				kind: "external",
				org: "云枢智能",
				orgPath: "云枢智能/算法部",
				title: "推荐算法工程师",
			}),
			{ title: "推荐算法工程师" },
		);
	});
});

describe("自述每一段只取一种来源", () => {
	const external: Partial<RouteSource> = {
		kind: "external",
		unemployed: false,
		org: "云枢智能",
		description: "负责推荐系统召回，配合算法团队完成上线",
	};

	test("没读过的段，整段原文就是说法", () => {
		assert.deepEqual(of(external), {
			description: "负责推荐系统召回，配合算法团队完成上线",
		});
	});

	test("读过的段，说法是读出来的能力词与做过的事，原文不再是说法", () => {
		const phrasings = phrasesOf(
			{
				kind: "external",
				unemployed: false,
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
			{ route: "skill", text: "召回", involvement: null },
			{ route: "did", text: "推荐系统", involvement: "负责建设" },
		]);
	});

	test("读过但什么都没读出来，也不退回原文：那是模型说这段没有可找的能力", () => {
		assert.deepEqual(of(external, { skills: [], did: [] }), {});
	});
});

test("待业属性阻止登记和抽取说法进入语料，不依赖岗位文字", () => {
	assert.deepEqual(
		of(
			{
				kind: "external",
				unemployed: true,
				title: "算法",
				org: "某公司",
				description: "算法开发",
			},
			{ skills: ["算法"], did: [] },
		),
		{},
	);
});

test("拼法的身份由样例走一遍拼法得出，每一类说法都在里面", () => {
	// 新加一类说法而样例没覆盖到它，改这一类的拼法就不会触发重新派生
	const routes = new Set(
		(JSON.parse(PHRASING) as { route: string }[][]).flat().map((p) => p.route),
	);
	assert.deepEqual([...routes].sort(), [
		"description",
		"did",
		"role",
		"skill",
		"title",
	]);
});
