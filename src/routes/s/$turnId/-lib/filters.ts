/**
 * 筛选栏的描述：每一维一组标题、候选和选中态，渲染归界面。标题、选项文案、身份、
 * 取值都来自 `search/dimensions.ts`，这里只算点一下要写回什么。
 *
 * 两类：分面（有候选和人数）与文本条件（公司名、学校名，没有候选，只能看见和清掉）。
 */

import { NAME_LABEL } from "#/search/condition-label";
import {
	DIM_KEYS,
	DIMENSIONS,
	type DimKey,
	dimId,
	dimOption,
	dimPicked,
	type Facet,
	isMulti,
} from "#/search/dimensions";
import type { Facets } from "#/search/result";
import type { View } from "./view-params";

type FilterOption = {
	value: string;
	label: string;
	/** 选了这一项之后还剩多少人，和名单表头的人数同一口径（rank.ts 的 computeFacets）。 */
	n: number;
};

export type FilterField = {
	key: DimKey;
	/** 这一组的标题；选项文案靠它缩短，「经历时长」下面写「1 年」即可。 */
	title: string;
	/** 当前选中的值（这一维的内部身份）。一项都没选就是空数组。 */
	values: string[];
	options: FilterOption[];
	/**
	 * 这一维之内能不能同时选好几项（`dimensions.ts` 的 `MULTI_KEYS`）。界面据此
	 * 画复选框或单选，点之前就看得出再点一个是加上还是换掉。
	 */
	multi: boolean;
	/** 这一维现在选中的就是这几个。空数组等于这一维不筛。 */
	set: (values: string[]) => Partial<View>;
};

/** 文本条件：一个已经生效的精确条件，只能看见和清掉。 */
export type TextFilter = {
	key: "org" | "school";
	title: string;
	value: string;
	clear: Partial<View>;
};

/**
 * 候选行：分面给出的那些，加上选中却在这次查询里数不出人的那些，后者补在最前面、
 * 计数 0。地址上的筛选可能是旧链接带来的，候选里已经没有它；补上这一行才取消得了。
 */
function rows(key: DimKey, candidates: Facet[], picked: unknown[]): Facet[] {
	const absent = picked.filter(
		(p) =>
			!candidates.some(
				(c) => dimId(key, c.value) === dimId(key, p as Facet["value"]),
			),
	) as Facet["value"][];
	return [...absent.map((value) => ({ value, n: 0 })), ...candidates];
}

/**
 * 一维的筛选组。集合维可以选多项（之间是「或」），单值维只能有一个值。
 *
 * `set` 接「现在选中的是这几个」，写成地址上的样子；单值维传空数组就是选了「不限」。
 * 写回按候选自己的顺序，同一组选择只有一种写法。
 */
function field(key: DimKey, facets: Facets, view: View): FilterField {
	const picked = dimPicked(view[key]);
	const all = rows(key, facets[key] as Facet[], picked);
	const values = picked.map((v) => dimId(key, v));
	return {
		key,
		title: DIMENSIONS[key].label,
		values,
		options: all.map((r) => ({
			value: dimId(key, r.value),
			label: dimOption(key, r.value),
			n: r.n,
		})),
		multi: isMulti(key),
		set: (next) => write(key, next, all),
	};
}

/** 把选中的那几个身份写回成这一维在 URL 上的样子。 */
function write(key: DimKey, ids: string[], all: Facet[]): Partial<View> {
	const kept = all
		.filter((r) => ids.includes(dimId(key, r.value)))
		.map((r) => r.value);
	if (kept.length === 0) return { [key]: undefined };
	return {
		[key]: isMulti(key) ? kept : kept[0],
	};
}

export function filterFields(facets: Facets, view: View): FilterField[] {
	return DIM_KEYS.map((key) => field(key, facets, view));
}

/** 已生效的文本条件。没生效的不出现——它们没有候选列表可展开。 */
export function textFilters(view: View): TextFilter[] {
	const out: TextFilter[] = [];
	if (view.org)
		out.push({
			key: "org",
			title: NAME_LABEL.org,
			value: view.org.join(" / "),
			clear: { org: undefined },
		});
	if (view.school)
		out.push({
			key: "school",
			title: NAME_LABEL.school,
			value: view.school.join(" / "),
			clear: { school: undefined },
		});
	return out;
}

/** 已生效的筛选有几项，集合维里选中的每个值各算一项。 */
export function activeCount(fields: FilterField[], texts: TextFilter[]) {
	return fields.reduce((n, f) => n + f.values.length, 0) + texts.length;
}
