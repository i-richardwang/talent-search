/**
 * 筛选栏的描述：每一维一组标题、候选和选中态。
 *
 * 这里给出的是描述，不是组件：谁来渲染、渲染成一列按钮还是别的什么，由界面层
 * 决定。**维度本身不在这里声明**——标题、选项文案、身份、取值全部来自
 * `search/dimensions.ts` 那一张表，这个文件只回答「点一下要写回什么」。
 *
 * 两类维度：**分面**（有候选列表和人数）与**文本条件**（公司名 / 学校名，
 * 来自查询理解或链接，没有候选列表，只能看见和清掉）。
 */
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
import { NAME_LABEL } from "../../../-lib/term-label";
import type { View } from "./view-params";

type FilterOption = {
	value: string;
	label: string;
	/**
	 * 选了这一项之后还剩多少**人**——口径由 rank.ts 的 computeFacets 保证，
	 * 和名单表头那个人数是同一个单位。全站计数只有「人」这一个单位。
	 */
	n: number;
};

export type FilterField = {
	key: DimKey;
	/**
	 * 这一组的标题。它是筛选栏里的分区标签，管着下面那几行选项——有了它，
	 * 选项文案才能缩短：「经历时长」下面写「1 年」就够了，不必每一项都重复成
	 * 「至少 1 年」。
	 */
	title: string;
	/** 当前选中的值（这一维的内部身份）。一项都没选就是空数组。 */
	values: string[];
	options: FilterOption[];
	/**
	 * 这一维之内能不能同时选好几项。
	 *
	 * 它得说出来，因为**界面要拿它挑控件**：能多选的画成复选框，只能选一个的
	 * 画成单选。一维之内能选几项是这一维的定义（`dimensions.ts` 的 `MULTI_KEYS`），
	 * 而「再点一个是加上去还是换掉刚才那个」得在点之前就看得出来——所以它必须
	 * 走到屏幕上，不能只活在写回 URL 的那一步里。
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
 * 候选行：分面给出的那些，加上**选中却在这次查询里数不出人的**那些——后者补在
 * 最前面，计数 0。
 *
 * 分面的值域由这次查询在**当下这一版语料**上的结果决定（`rank.ts` 的
 * `facetRows`），而 URL 上的筛选是链接的一部分：它会被收藏、被粘给同事，也会
 * 被人手改。语料重灌过一次之后，同一条记录跑出来的候选里可能已经没有那个值了。
 * 不补这一行，那个筛选照旧生效（名单里少了人），列表里却没有任何东西能取消它。
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
 * 一维的筛选组。
 *
 * 集合维一维之内可以选多项（它们之间是「或」）；单值维只能有一个值。这个差别
 * 由 `multi` 报出去，界面照它挑控件（复选框还是单选），写回的形状由
 * `dimensions.ts` 说了算。
 *
 * 这里不做「点一下会怎样」的推算：谁选中了由控件自己管着，这一层只接一份
 * 「现在选中的是这几个」，把它写成 URL 上的样子。单值维要取消就传空数组——
 * 屏幕上那一下是选中了那枚写着「不限」的单选。
 *
 * 写回的顺序一律取候选自己的顺序，不是点击先后——同一组选择因此只有一种写法，
 * 粘给同事的链接不会因为「先点哪个」而不同，`viewChanged` 也不会把顺序不同
 * 当成筛选变了。
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

/**
 * 已生效的筛选有几项——集合维度里选中的每一个值各算一项。
 *
 * 界面上要的就是这个数：摘掉一个筛选是回到它自己那一行再点一次，而那一行永远
 * 在场（`rows`），所以「现在筛了什么」由那几行的选中态说，这里只说「几项」。
 */
export function activeCount(fields: FilterField[], texts: TextFilter[]) {
	return fields.reduce((n, f) => n + f.values.length, 0) + texts.length;
}
