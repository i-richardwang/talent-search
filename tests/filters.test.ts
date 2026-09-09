/**
 * 筛选维度的值 → 标签映射，以及点一下要写回什么。
 *
 * 这组测试盯的是一类静默失败：URL 里存的是 `kind=internal`、`minMonths=12`，
 * 界面上要显示的是「公司内经历」「1 年」。念法由维度自己声明
 * （`search/dimensions.ts`），但「查没查表」没有类型约束——忘了查、把裸值渲染
 * 出去，类型检查和构建都不会响。
 *
 * 另一半是**多选**：一维之内选中哪几项、再点一次减掉哪一项、写回 URL 的是什么。
 * 这些是纯函数，比 DOM 更该被直接测；画出来的样子在 `tests/filter-rail.test.tsx` 里测。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	activeCount,
	filterFields,
	textFilters,
} from "#/routes/s/$turnId/-lib/filters";
import type { View } from "#/routes/s/$turnId/-lib/view-params";
import type { Facets } from "#/search/result";

const FACETS: Facets = {
	seq: [
		{ value: { l1: "技术", l2: "数据科学" }, n: 114 },
		{ value: { l1: "商业分析", l2: "数据科学" }, n: 27 },
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
	skill: [{ value: "推荐系统", n: 3 }],
	education: [{ value: "硕士", n: 8 }],
	strong: { on: 18, off: 43 },
};

const fields = (view: View) => filterFields(FACETS, view);
const field = (view: View, key: string) =>
	fields(view).find((f) => f.key === key);

/**
 * 按看得见的文案找一行。行的 `value` 是它在这一栏里的内部身份（序列那一维尤其
 * 不是一个能手写出来的字符串），测试照着文案拿，不去猜它长什么样。
 */
const rowOf = (view: View, key: string, label: string) =>
	field(view, key)?.options.find((o) => o.label === label);

/** 界面上会读到的、当前选中项的文案。 */
const labels = (view: View) =>
	fields(view).flatMap((f) =>
		f.values.map((v) => f.options.find((o) => o.value === v)?.label ?? v),
	);

describe("选中的东西怎么说人话", () => {
	test("URL 里的裸值一律翻成界面文案", () => {
		assert.deepEqual(labels({ kind: "internal" }), ["公司内经历"]);
		assert.deepEqual(labels({ kind: "external" }), ["入职前经历"]);
		assert.deepEqual(labels({ minMonths: 12 }), ["1 年"]);
		assert.deepEqual(labels({ minMonths: 6 }), ["6 个月"]);
	});

	test("序列是一对值，标签把两级都写出来", () => {
		assert.deepEqual(labels({ seq: [{ l1: "技术", l2: "数据科学" }] }), [
			"技术 · 数据科学",
		]);
		// 二级序列名跨一级会重名，一级不能省
		assert.deepEqual(labels({ seq: [{ l1: "商业分析", l2: "数据科学" }] }), [
			"商业分析 · 数据科学",
		]);
	});

	test("标签不带人数——人数说的是选项有多大，不是当前筛的是什么", () => {
		// 同一个维度里两份东西并存：选项自己带 n（左栏要靠它判断值不值得点），
		// 标签不带。选项的 n 漏进标签会读成「技术 · 数据科学 114」。
		const view = { seq: [{ l1: "技术", l2: "数据科学" }], minMonths: 12 };
		assert.equal(
			rowOf(view, "seq", "技术 · 数据科学")?.n,
			114,
			"选项那一侧必须带人数",
		);
		for (const label of labels(view))
			for (const n of [114, 33])
				assert.doesNotMatch(
					label,
					new RegExp(String(n)),
					`混进了人数：${label}`,
				);
	});

	test("维度按固定顺序排，摘掉一个不会让其余的重新排队", () => {
		assert.deepEqual(
			labels({
				minMonths: 24,
				seq: [{ l1: "技术", l2: "数据科学" }],
				kind: "internal",
			}),
			["技术 · 数据科学", "公司内经历", "2 年"],
		);
	});

	test("没筛就一个都没有；strong 是服务端筛选，但不计入范围筛选", () => {
		assert.deepEqual(labels({}), []);
		assert.deepEqual(labels({ strong: true }), []);
	});

	test("筛选项列表变了而 URL 停在旧值上时，显示裸值而不是静默消失", () => {
		// 界面上必须有东西解释「为什么只剩这几个人」
		assert.deepEqual(labels({ companyTag: ["已经没人的档"] }), [
			"已经没人的档",
		]);
	});
});

describe("一维之内可以选几项", () => {
	test("集合维度：再点一个是加上去，不是换掉", () => {
		const next = field({ level: ["P6"] }, "level")?.toggle("P7");
		assert.deepEqual(next, { level: ["P6", "P7"] });
	});

	test("写回的顺序按选项走，不按点击先后——同一组选择只有一种 URL 写法", () => {
		// 先点 P7 再点 P6，和反过来点，得到的必须是同一个地址
		assert.deepEqual(field({ level: ["P7"] }, "level")?.toggle("P6"), {
			level: ["P6", "P7"],
		});
	});

	test("再点一次是取消，取消掉最后一项就是这一维不筛了", () => {
		assert.deepEqual(field({ level: ["P6", "P7"] }, "level")?.toggle("P6"), {
			level: ["P7"],
		});
		assert.deepEqual(field({ level: ["P6"] }, "level")?.toggle("P6"), {
			level: undefined,
		});
	});

	test("阈值维度只能选一个：点别的直接换掉", () => {
		// 「至少 6 个月」或「至少 1 年」加起来还是「至少 6 个月」
		assert.deepEqual(field({ minMonths: 6 }, "minMonths")?.toggle("12"), {
			minMonths: 12,
		});
		assert.deepEqual(field({ minMonths: 12 }, "minMonths")?.toggle("12"), {
			minMonths: undefined,
		});
	});

	test("二选一的维度也只能选一个：两个都要就是不筛", () => {
		assert.deepEqual(field({ kind: "internal" }, "kind")?.toggle("external"), {
			kind: "external",
		});
		assert.deepEqual(field({ kind: "internal" }, "kind")?.toggle("internal"), {
			kind: undefined,
		});
	});

	test("每一维只写自己那一个字段，别的原样留着", () => {
		const view = { seq: [{ l1: "技术", l2: "数据科学" }], minMonths: 12 };
		const row = rowOf(view, "seq", "技术 · 数据科学");
		assert.deepEqual(
			Object.keys(field(view, "seq")?.toggle(row?.value ?? "") ?? {}),
			["seq"],
		);
	});

	test("序列写回的是一对值，不是一个拼起来的名字", () => {
		const view = { seq: [{ l1: "技术", l2: "数据科学" }] };
		const other = rowOf(view, "seq", "商业分析 · 数据科学");
		assert.deepEqual(field(view, "seq")?.toggle(other?.value ?? ""), {
			seq: [
				{ l1: "技术", l2: "数据科学" },
				{ l1: "商业分析", l2: "数据科学" },
			],
		});
	});
});

describe("生效了几项", () => {
	test("集合维度里选中的每一个值各算一项", () => {
		const view = { level: ["P6", "P7"], kind: "internal" as const };
		assert.equal(activeCount(fields(view), textFilters(view)), 3);
	});

	test("文本条件也算，没筛就是 0", () => {
		assert.equal(activeCount(fields({}), textFilters({})), 0);
		assert.equal(
			activeCount(fields({ org: ["字节"] }), textFilters({ org: ["字节"] })),
			1,
		);
	});
});

describe("控件侧", () => {
	test("每一组都有标题，选项文案才能缩短", () => {
		assert.deepEqual(
			fields({}).map((f) => f.title),
			[
				"序列",
				"职级",
				"经历来源",
				"经历时长",
				"入职前公司",
				"入职前技能",
				"招聘渠道",
				"学历",
			],
		);
	});

	test("未选中时是空的，和「这一维不筛」是同一件事", () => {
		for (const f of fields({})) assert.deepEqual(f.values, []);
	});

	test("选中时值与 URL 一致，包括数字要转成字符串", () => {
		assert.deepEqual(field({ minMonths: 24 }, "minMonths")?.values, ["24"]);
		assert.deepEqual(field({ level: ["P6", "P7"] }, "level")?.values, [
			"P6",
			"P7",
		]);
	});

	test("人数跟着选项走，用来判断这个筛选值不值得点", () => {
		assert.equal(field({}, "seq")?.options[0]?.n, 114);
	});

	test("每个维度都带人数，没有哪一组是空着的", () => {
		// 同一列里并置的兄弟项出现不同的结构，读起来是「数据缺了」，
		// 而不是「这里本来就没有」
		for (const f of fields({})) {
			assert.ok(f.options.length > 0, `${f.title} 没有候选`);
			for (const o of f.options)
				assert.equal(typeof o.n, "number", `${f.title} / ${o.label} 没有人数`);
		}
	});

	test("分面数不出人的档位直接不出现，左栏因此会变短", () => {
		// FACETS.minMonths 里没有 36：这次检索没人干满三年
		assert.deepEqual(
			field({}, "minMonths")?.options.map((o) => o.label),
			["6 个月", "1 年", "2 年"],
		);
	});

	test("选中的项即使被分面滤掉，也必须留在列表里", () => {
		// 两个筛选叠加把结果打到 0 时，选中项自己会从分面里消失——
		// 它要是也从列表里消失，就再没有任何东西能取消它了
		const seq = field({ seq: [{ l1: "运营", l2: "用户增长" }] }, "seq");
		assert.equal(seq?.options[0]?.label, "运营 · 用户增长");
		assert.equal(seq?.options[0]?.n, 0);
		assert.deepEqual(seq?.values, [seq?.options[0]?.value]);
	});

	test("被滤掉的选中项不止一个时，一个都不能少", () => {
		const level = field({ level: ["P8", "P9"] }, "level");
		assert.deepEqual(
			level?.options.slice(0, 2).map((o) => o.value),
			["P8", "P9"],
		);
	});
});
