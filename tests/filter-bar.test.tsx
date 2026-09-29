/**
 * 名单上方的筛选：钮上看得见的字，和点开之后每一项的样子。
 *
 * 钮上的字断言 visibleText，属性一律不算数：`aria-label` 会让文案存在于 DOM 里，
 * 按字符串搜 HTML 就能命中一个肉眼什么都看不到的空壳。菜单关着时不在 DOM 里，
 * 它的项由 `fieldItems` 给出，直接测这份项：每一项后面「选了还剩几个人」、数到 0 的
 * 点不了、选中的归零了照样点得动。裸值翻译、选中项不消失这些不变量由
 * `filterFields` 保证，在 `tests/filters.test.ts` 里测。
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DropdownItem } from "#/components/ui/dropdown-menu";
import {
	FilterBar,
	fieldItems,
} from "#/routes/s/$turnId/-components/filter-bar";
import {
	type FilterField,
	filterFields,
	textFilters,
} from "#/routes/s/$turnId/-lib/filters";
import type { View } from "#/routes/s/$turnId/-lib/view-params";
import type { Facets } from "#/search/result";
import { visibleText } from "./render";

const FACETS: Facets = {
	seq: [
		{ value: { l1: "技术", l2: "算法" }, n: 100 },
		{ value: { l1: "技术", l2: "工程" }, n: 80 },
	],
	companyTag: [],
	kind: [
		{ value: "internal", n: 31 },
		{ value: "external", n: 0 },
	],
	minMonths: [{ value: 12, n: 33 }],
	level: [{ value: "P6", n: 20 }],
	recruitment: [],
	skill: [],
	education: [],
};

const seen = (view: View) =>
	visibleText(
		renderToStaticMarkup(
			<FilterBar
				fields={filterFields(FACETS, view)}
				onChange={() => {}}
				textFilters={textFilters(view)}
			/>,
		),
	);

const field = (key: FilterField["key"], view: View = {}) =>
	filterFields(FACETS, view).find((f) => f.key === key) as FilterField;

/** 菜单里一项的名字、行尾人数和点不点得动；「不限」和「清除」没有人数。 */
const rows = (items: DropdownItem[]) =>
	items.flatMap((item) =>
		item.type === "radio"
			? item.options.map((o) => ({
					disabled: Boolean(o.disabled),
					extra: o.extra,
					label: o.label,
				}))
			: item.type === "checkbox"
				? [
						{
							disabled: Boolean(item.disabled),
							extra: item.extra,
							label: item.label,
						},
					]
				: item.type === undefined
					? [{ disabled: false, extra: undefined, label: item.label }]
					: [],
	);

describe("钮上的字", () => {
	test("数得出人的维一维一个钮，数不出的不出现", () => {
		const text = seen({});
		for (const title of ["序列", "经历来源", "经历时长", "职级"])
			assert.ok(text.includes(title), `看不到「${title}」：${text}`);
		assert.ok(!text.includes("入职前公司"), text);
	});

	test("选了一项，钮上跟着那一项，不是地址里的裸值", () => {
		const text = seen({ kind: "internal" });
		assert.ok(text.includes("经历来源：公司内经历"), text);
		assert.ok(!text.includes("internal"), text);
	});

	test("选了几项，钮上写几项", () => {
		const text = seen({
			seq: [
				{ l1: "技术", l2: "算法" },
				{ l1: "技术", l2: "工程" },
			],
		});
		assert.ok(text.includes("序列：2 项"), text);
	});

	test("公司、学校这类名称条件写出它的值", () => {
		assert.ok(seen({ org: ["某甲科技"] }).includes("某甲科技"));
	});
});

describe("菜单里的项", () => {
	test("每一项后面是选了之后还剩几个人", () => {
		const kind = rows(fieldItems(field("kind"), () => {}));
		assert.deepEqual(
			kind.filter((r) => r.extra !== undefined).map((r) => r.extra),
			[31, 0],
		);
	});

	test("单选的维最前面是「不限」", () => {
		assert.equal(rows(fieldItems(field("kind"), () => {}))[0]?.label, "不限");
	});

	test("数到 0 的一项留在原地、点不了", () => {
		const zero = rows(fieldItems(field("kind"), () => {})).find(
			(r) => r.extra === 0,
		);
		assert.equal(zero?.disabled, true);
	});

	test("选中的那一项归零了照样点得动，否则取消不掉", () => {
		const zero = rows(
			fieldItems(field("kind", { kind: "external" }), () => {}),
		).find((r) => r.extra === 0);
		assert.equal(zero?.disabled, false);
	});

	test("多选的维选了东西，末尾有「清除」，它清空这一维", () => {
		const picked = field("seq", { seq: [{ l1: "技术", l2: "算法" }] });
		let written: Partial<View> | null = null;
		const items = fieldItems(picked, (next) => {
			written = next;
		});
		const clear = items.at(-1);
		assert.ok(clear && clear.type === undefined && clear.label === "清除");
		clear.onClick?.();
		assert.deepEqual(written, { seq: undefined });
		assert.ok(
			!fieldItems(field("seq"), () => {}).some(
				(i) => i.type === undefined && i.label === "清除",
			),
		);
	});
});
