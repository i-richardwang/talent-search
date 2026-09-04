/**
 * 筛选维度的唯一事实源。
 *
 * URL 里存的是 `kind=internal`、`minMonths=12`，界面上要显示的是「公司内经历」
 * 「1 年」。这两者之间没有任何类型约束，只有一张手写的对照表——写错、漏改、
 * 或者忘了查表把裸值渲染出去，类型检查和构建都不会响。所以这张表只有一份，
 * 放在这里，由 `tests/filters.test.ts` 钉住。
 *
 * 这里给出的是描述，不是组件：谁来渲染、渲染成一列按钮还是别的什么，
 * 由界面层决定；值怎么解释、点一下要写回什么，只在这一个文件里定义。
 *
 * 两类维度：**分面**（有候选列表和人数）与**文本条件**（公司名 / 学校名，
 * 来自查询理解或链接，没有候选列表，只能看见和清掉）。
 */
import { duration } from "#/lib/format";
import type { Facets, SeqPick } from "#/search/result";
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
	key:
		| "seq"
		| "companyTag"
		| "kind"
		| "minMonths"
		| "level"
		| "recruitment"
		| "education";
	/**
	 * 这一组的标题。它是筛选栏里的分区标签，管着下面那几行选项——有了它，
	 * 选项文案才能缩短：「经历时长」下面写「1 年」就够了，不必每一项都重复成
	 * 「至少 1 年」。
	 *
	 * **标题要说清是什么的。** 「来源」「时长」在一栏里挨着排的时候各自都读得通，
	 * 但名单表头上还有一处「匹配来源」（那是证据来自哪个字段，见 `evidence.tsx`），
	 * 同一屏上两个「来源」指的是完全不同的两件事。
	 */
	title: string;
	/** 当前选中的值。一项都没选就是空数组。 */
	values: string[];
	options: FilterOption[];
	/** 点一下这一项：没选的选上，选了的取消。返回这一维的完整新值。 */
	toggle: (v: string) => Partial<View>;
};

/** 文本条件：一个已经生效的精确条件，只能看见和清掉。 */
export type TextFilter = {
	key: "org" | "school";
	title: string;
	value: string;
	clear: Partial<View>;
};

const KIND_LABEL: Record<"internal" | "external", string> = {
	internal: "公司内经历",
	external: "入职前经历",
};

/**
 * 候选行：分面给出的那些，加上**选中却在这次查询里数不出人的**那些——后者补在
 * 最前面，计数 0。
 *
 * 分面的值域由这次查询决定（`rank.ts` 的 `facetCount`），而 URL 上的筛选会跟着
 * 人走到下一条查询记录上：上一次搜「算法」时选的序列，在这次搜「财务」的候选里
 * 可能一个人都没有，于是它从列表里消失，然后就没有任何东西能取消它了。
 */
function rows<T>(
	candidates: { value: T; n: number }[],
	picked: T[],
	id: (v: T) => string,
) {
	const absent = picked.filter(
		(p) => !candidates.some((c) => id(c.value) === id(p)),
	);
	return [...absent.map((value) => ({ value, n: 0 })), ...candidates];
}

/**
 * 集合维度：一维之内可以选多项，它们之间是「或」（口径见 `SearchFilters`）。
 *
 * `T` 是这个值在 URL 和检索条件里的**原样**；行的 `value` 只是它在这一栏里的
 * 身份，不出现在别处。序列那种一对值的东西因此原样进来、原样写回（见 `SeqPick`）。
 *
 * 写回的顺序一律取候选自己的顺序，不是点击先后——同一组选择因此只有一种写法，
 * 粘给同事的链接不会因为「先点哪个」而不同，`viewChanged` 也不会把顺序不同
 * 当成筛选变了。
 */
function multi<T>(
	key: FilterField["key"],
	title: string,
	candidates: { value: T; n: number }[],
	picked: T[],
	id: (v: T) => string,
	label: (v: T) => string,
	write: (values: T[] | undefined) => Partial<View>,
): FilterField {
	const all = rows(candidates, picked, id);
	const values = picked.map(id);
	return {
		key,
		title,
		values,
		options: all.map((r) => ({
			value: id(r.value),
			label: label(r.value),
			n: r.n,
		})),
		toggle: (v) => {
			const next = new Set(values);
			if (!next.delete(v)) next.add(v);
			const kept = all.filter((r) => next.has(id(r.value))).map((r) => r.value);
			return write(kept.length > 0 ? kept : undefined);
		},
	};
}

/**
 * 单值维度。阈值（`minMonths`）和二选一（`kind`）不是集合：「至少 6 个月」或
 * 「至少 1 年」加起来还是「至少 6 个月」，两种来源都要就是不筛。所以点别的直接
 * 换掉，再点选中的那一个是取消。
 *
 * 这个差别只活在这里——左栏画出来的七维长得一模一样。
 */
function single(
	key: FilterField["key"],
	title: string,
	candidates: { value: string; n: number }[],
	picked: string | undefined,
	label: (v: string) => string,
	write: (value: string | undefined) => Partial<View>,
): FilterField {
	const values = picked ? [picked] : [];
	const all = rows(candidates, values, (v) => v);
	return {
		key,
		title,
		values,
		options: all.map((r) => ({
			value: r.value,
			label: label(r.value),
			n: r.n,
		})),
		toggle: (v) => write(v === picked ? undefined : v),
	};
}

/** 取值即标签的那几个集合维度（公司档、职级、招聘渠道、学历）共用这一个形状。 */
function plain(
	key: "companyTag" | "level" | "recruitment" | "education",
	title: string,
	facet: { value: string; n: number }[],
	picked: string[] | undefined,
): FilterField {
	return multi(
		key,
		title,
		facet,
		picked ?? [],
		(v) => v,
		(v) => v,
		(values) => ({ [key]: values }),
	);
}

/**
 * 一条序列在这一栏里的身份。只用来比较和当 React key，不出现在 URL 上，
 * 所以拿一个数据里不可能出现的字符隔开就够了，不必迁就可读性。
 */
const seqId = (s: SeqPick) => `${s.l1}\u0001${s.l2}`;

export function filterFields(facets: Facets, view: View): FilterField[] {
	return [
		multi(
			"seq",
			"序列",
			facets.seq.map((s) => ({ value: { l1: s.seqL1, l2: s.seqL2 }, n: s.n })),
			view.seq ?? [],
			seqId,
			// 二级序列名跨一级会重名，一级省不掉
			(s) => `${s.l1} · ${s.l2}`,
			(seq) => ({ seq }),
		),
		plain("level", "职级", facets.level, view.level),
		single(
			"kind",
			"经历来源",
			facets.kind,
			view.kind,
			(v) => KIND_LABEL[v as keyof typeof KIND_LABEL] ?? v,
			// 值只可能来自上面那份候选，收窄回枚举不需要再验一次
			(kind) => ({ kind: kind as View["kind"] }),
		),
		single(
			"minMonths",
			"经历时长",
			facets.minMonths.map((m) => ({ value: String(m.value), n: m.n })),
			view.minMonths ? String(view.minMonths) : undefined,
			(v) => duration(Number(v)),
			(v) => ({ minMonths: v ? Number(v) : undefined }),
		),
		plain("companyTag", "入职前公司", facets.companyTag, view.companyTag),
		plain("recruitment", "招聘渠道", facets.recruitment, view.recruitment),
		plain("education", "学历", facets.education, view.education),
	];
}

/** 已生效的文本条件。没生效的不出现——它们没有候选列表可展开。 */
export function textFilters(view: View): TextFilter[] {
	const out: TextFilter[] = [];
	if (view.org)
		out.push({
			key: "org",
			title: "待过",
			value: view.org,
			clear: { org: undefined },
		});
	if (view.school)
		out.push({
			key: "school",
			title: "学校",
			value: view.school,
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
