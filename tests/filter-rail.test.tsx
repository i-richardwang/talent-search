/**
 * 筛选栏摊开之后必须看得见的东西。
 *
 * 断言的是 visibleText，属性一律不算数：`aria-label` 会让文案存在于 DOM 里，
 * 按字符串搜 HTML 就能命中一个人眼什么都看不到的空壳。
 *
 * 摊开这条栏换来的是**人数**：每个选项后面「点了还剩几个人」一直在。这个文件
 * 钉的就是这件事——它是把筛选收进弹层时最先丢掉的东西，而丢了之后界面看起来
 * 完全正常。裸值翻译、选中项不消失这些不变量产在 `filterFields`，
 * 钉在 `tests/filters.test.ts`，这里只验证它们真的被画了出来。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterRail } from "#/routes/-components/filter-rail";
import { filterFields, textFilters } from "#/routes/-lib/filters";
import type { View } from "#/routes/-lib/view-params";
import type { Facets } from "#/search/result";
import { visibleText } from "./render";

const SEQ = Array.from({ length: 9 }, (_, i) => ({
	seqL1: "技术",
	seqL2: `序列${i}`,
	n: 100 - i,
}));

const FACETS: Facets = {
	seq: SEQ,
	companyTag: [{ value: "大厂", n: 42 }],
	kind: [
		{ value: "internal", n: 31 },
		{ value: "external", n: 12 },
	],
	minMonths: [
		{ value: 6, n: 40 },
		{ value: 12, n: 33 },
	],
	level: [{ value: "P6", n: 20 }],
	recruitment: [],
	education: [],
	strong: { on: 7, off: 31 },
};

const render = (view: View, facets: Facets = FACETS) =>
	visibleText(
		renderToStaticMarkup(
			<FilterRail
				fields={filterFields(facets, view)}
				onChange={() => {}}
				textFilters={textFilters(view)}
			/>,
		),
	);

describe("不点开就知道能筛什么", () => {
	test("维度名和它的选项同时在场", () => {
		const seen = render({});
		for (const text of ["序列", "经历来源", "公司内经历", "经历时长", "1 年"])
			assert.ok(seen.includes(text), `看不到「${text}」：${seen}`);
	});

	test("选项文案是人话，不是 URL 里的裸值", () => {
		assert.ok(!render({}).includes("internal"));
	});

	test("数不出人的维度整组都不出现", () => {
		// 分面只返回还数得出人的选项，一个都不剩时那一维没有可点的东西
		const seen = render({}, { ...FACETS, companyTag: [] });
		assert.ok(!seen.includes("入职前公司"), `空维度还占着位置：${seen}`);
	});

	test("一个维度都数不出来时整条栏不存在", () => {
		// 空着的栏就是它不该占位的证据
		const empty: Facets = {
			seq: [],
			companyTag: [],
			kind: [],
			minMonths: [],
			level: [],
			recruitment: [],
			education: [],
			strong: { on: 0, off: 0 },
		};
		assert.equal(render({}, empty), "");
	});
});

describe("人数", () => {
	/*
	 * 摊开这条栏，唯一比弹层多买到的就是这份对照：一列数字竖着比，
	 * 「点哪一个能把范围收得最狠」扫一眼就答完了。丢了它，这条栏就只是
	 * 一份摆出来占地方的目录。
	 */
	test("每个选项后面都跟着它还剩几个人", () => {
		const seen = render({});
		assert.match(seen, /公司内经历\s*31/);
		assert.match(seen, /入职前经历\s*12/);
	});
});

describe("形状站得住", () => {
	/*
	 * 这一栏的行只在换查询时变。点一个筛选就让别的行消失，等于列表在手底下
	 * 换形状——而消失的那一行正是用户自己刚做的事的后果，藏起来就没法回头。
	 * 值域和计数分开算这件事钉在 `tests/rank.test.ts`，这里钉它画出来的样子。
	 */
	const ZEROED: Facets = {
		...FACETS,
		kind: [
			{ value: "internal", n: 31 },
			{ value: "external", n: 0 },
		],
	};

	test("数到 0 的选项留在原地，写着 0", () => {
		assert.match(render({}, ZEROED), /入职前经历\s*0/);
	});

	/** 这一行的 `<button>` 上有没有 `disabled` 属性。类名里的 `disabled:` 变体不算。 */
	const isDisabled = (html: string, label: string) => {
		const at = html.indexOf(label);
		return /\sdisabled=""/.test(
			html.slice(html.lastIndexOf("<button", at), at),
		);
	};

	test("它点不动——点下去必然是一份空名单", () => {
		const html = renderToStaticMarkup(
			<FilterRail
				fields={filterFields(ZEROED, {})}
				onChange={() => {}}
				textFilters={[]}
			/>,
		);
		assert.ok(isDisabled(html, "入职前经历"), html);
	});

	test("选中的那一项哪怕归零也点得动，否则取消不掉", () => {
		const html = renderToStaticMarkup(
			<FilterRail
				fields={filterFields(ZEROED, { kind: "external" })}
				onChange={() => {}}
				textFilters={[]}
			/>,
		);
		assert.ok(!isDisabled(html, "入职前经历"), html);
	});
});

describe("不点开就知道现在筛的是什么", () => {
	test("选中的值照常在场", () => {
		const seen = render({ kind: "internal", minMonths: 12 });
		assert.ok(seen.includes("公司内经历"), seen);
		assert.ok(seen.includes("1 年"), seen);
	});

	test("选中的那一项被提到前面，不会掉进「更多」里", () => {
		// 它排第几由人数决定；一旦掉出摊开的那几项，就再也取消不掉了
		const seen = render({ seq: [{ l1: "技术", l2: "序列8" }] });
		assert.ok(seen.includes("技术 · 序列8"), seen);
	});

	test("同一维选中的几项都在场，都不会掉进「更多」里", () => {
		// 一维之内可以多选，选中的每一项都得留着——藏起来的那一项取消不掉
		const seen = render({
			seq: [
				{ l1: "技术", l2: "序列7" },
				{ l1: "技术", l2: "序列8" },
			],
		});
		assert.ok(seen.includes("技术 · 序列7"), seen);
		assert.ok(seen.includes("技术 · 序列8"), seen);
	});

	test("选项多的维度先摊开几项，其余收在「更多」后面", () => {
		assert.match(render({}), /更多 4 项/);
	});
});

describe("清除", () => {
	test("没筛就不出现清除，筛了就说清有几项", () => {
		assert.ok(!render({}).includes("清除"));
		assert.ok(render({ kind: "internal" }).includes("清除 1 项"));
		assert.ok(
			render({ kind: "internal", minMonths: 12 }).includes("清除 2 项"),
		);
		// 同一维里选中的每一个值各算一项
		assert.ok(
			render({
				seq: [
					{ l1: "技术", l2: "序列0" },
					{ l1: "技术", l2: "序列1" },
				],
			}).includes("清除 2 项"),
		);
	});

	test("「只看任职记录可查的」不进计数——它问的不是人群多大", () => {
		// 它也不在这条栏上（见 result-list.tsx 的 ProvenOnly）
		assert.ok(!render({ strong: true }).includes("清除"));
	});
});
