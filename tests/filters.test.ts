/**
 * 筛选维度的值 → 标签映射。
 *
 * 这组测试盯的是一类静默失败：URL 里存的是 `kind=internal`、`minMonths=12`，
 * 界面上要显示的是「公司内经历」「1 年」。两者之间没有类型约束，只有一张手写的
 * 对照表——写错、漏改、或者忘了查表把裸值渲染出去，类型检查和构建都不会响。
 *
 * 映射是纯函数，比 DOM 更该被直接测，所以这一层单独钉一遍。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { activeFilters, filterFields } from "#/routes/-lib/filters";
import type { Facets } from "#/search/result";

const FACETS: Facets = {
	seq: [
		{ seqL1: "技术", seqL2: "数据科学", n: 114 },
		{ seqL1: "商业分析", seqL2: "数据科学", n: 27 },
	],
	companyTag: [{ value: "大厂", n: 42 }],
	kind: [
		{ value: "internal", n: 31 },
		{ value: "external", n: 12 },
	],
	minMonths: [
		{ value: 6, n: 40 },
		{ value: 12, n: 33 },
		{ value: 24, n: 18 },
	],
	level: [
		{ value: "P6", n: 20 },
		{ value: "P7", n: 9 },
	],
	recruitment: [{ value: "校招", n: 5 }],
	education: [{ value: "硕士", n: 8 }],
	strong: { on: 18, off: 43 },
};

const labels = (search: Parameters<typeof filterFields>[1]) =>
	activeFilters(filterFields(FACETS, search), []).map((f) => f.label);

describe("已生效的筛选怎么说人话", () => {
	test("URL 里的裸值一律翻成界面文案", () => {
		assert.deepEqual(labels({ kind: "internal" }), ["公司内经历"]);
		assert.deepEqual(labels({ kind: "external" }), ["入职前经历"]);
		assert.deepEqual(labels({ minMonths: 12 }), ["1 年"]);
		assert.deepEqual(labels({ minMonths: 6 }), ["6 个月"]);
	});

	test("序列的值是「一级/二级」，标签才拆成「一级 · 二级」", () => {
		assert.deepEqual(labels({ seq: "技术/数据科学" }), ["技术 · 数据科学"]);
		// 二级序列名跨一级会重名，一级不能省
		assert.deepEqual(labels({ seq: "商业分析/数据科学" }), [
			"商业分析 · 数据科学",
		]);
	});

	test("标签不带人数——人数说的是选项有多大，不是当前筛的是什么", () => {
		// 同一个维度里两份东西并存：选项自己带 n（左栏要靠它判断值不值得点），
		// 已生效筛选的标签不带。选项的 n 漏进标签会读成「技术 · 数据科学 114」。
		const params = { seq: "技术/数据科学" as const, minMonths: 12 };
		const fields = filterFields(FACETS, params);
		const seqField = fields.find((f) => f.key === "seq");
		assert.equal(
			seqField?.options.find((o) => o.value === params.seq)?.n,
			114,
			"选项那一侧必须带人数",
		);
		for (const label of labels(params)) {
			for (const n of [114, 33]) {
				assert.doesNotMatch(
					label,
					new RegExp(String(n)),
					`标签里混进了人数：${label}`,
				);
			}
		}
	});

	test("多个筛选按固定顺序排，摘掉一个不会让其余的重新排队", () => {
		assert.deepEqual(
			labels({ minMonths: 24, seq: "技术/数据科学", kind: "internal" }),
			["技术 · 数据科学", "公司内经历", "2 年"],
		);
	});

	test("没筛就一个都没有；strong 是服务端筛选，但不计入范围筛选", () => {
		assert.deepEqual(labels({}), []);
		assert.deepEqual(labels({ strong: true }), []);
	});

	test("筛选项列表变了而 URL 停在旧值上时，显示裸值而不是静默消失", () => {
		// 界面上必须有东西解释「为什么只剩这几个人」
		assert.deepEqual(labels({ companyTag: "已经没人的档" }), ["已经没人的档"]);
	});
});

describe("摘掉一个筛选写回什么", () => {
	test("每个标签只清自己那一个字段，别的原样留着", () => {
		const active = activeFilters(
			filterFields(FACETS, { seq: "技术/数据科学", minMonths: 12 }),
			[],
		);
		assert.deepEqual(
			active.map((f) => f.clear),
			[{ seq: undefined }, { minMonths: undefined }],
		);
	});
});

describe("控件侧", () => {
	test("每一组都有标题，选项文案才能缩短", () => {
		assert.deepEqual(
			filterFields(FACETS, {}).map((f) => f.title),
			[
				"序列",
				"职级",
				"经历来源",
				"经历时长",
				"入职前公司",
				"招聘渠道",
				"学历",
			],
		);
	});

	test("未选中时值是 undefined，和「清空」写的是同一个东西", () => {
		for (const f of filterFields(FACETS, {})) assert.equal(f.value, undefined);
	});

	test("选中时值与 URL 一致，包括数字要转成字符串", () => {
		const fields = filterFields(FACETS, { minMonths: 24 });
		assert.equal(fields.find((f) => f.key === "minMonths")?.value, "24");
	});

	test("人数跟着序列选项走，用来判断这个筛选值不值得点", () => {
		const seq = filterFields(FACETS, {}).find((f) => f.key === "seq");
		assert.equal(seq?.options[0]?.n, 114);
	});

	test("每个维度都带人数，没有哪一组是空着的", () => {
		// 同一列里并置的兄弟项出现不同的结构，读起来是「数据缺了」，
		// 而不是「这里本来就没有」
		for (const f of filterFields(FACETS, {})) {
			assert.ok(f.options.length > 0, `${f.title} 没有候选`);
			for (const o of f.options) {
				assert.equal(typeof o.n, "number", `${f.title} / ${o.label} 没有人数`);
			}
		}
	});

	test("分面数不出人的档位直接不出现，左栏因此会变短", () => {
		// FACETS.minMonths 里没有 36：这次检索没人干满三年
		const months = filterFields(FACETS, {}).find((f) => f.key === "minMonths");
		assert.deepEqual(
			months?.options.map((o) => o.label),
			["6 个月", "1 年", "2 年"],
		);
	});

	test("选中的那一项即使被分面滤掉，也必须留在列表里", () => {
		// 两个筛选叠加把结果打到 0 时，选中项自己会从分面里消失——
		// 它要是也从列表里消失，就再没有任何东西能取消它了
		const seq = filterFields(FACETS, { seq: "运营/用户增长" }).find(
			(f) => f.key === "seq",
		);
		assert.equal(seq?.options[0]?.value, "运营/用户增长");
		assert.equal(seq?.options[0]?.label, "运营 · 用户增长");
		assert.equal(seq?.options[0]?.n, 0);
	});
});
