/**
 * 筛选维度的唯一事实源。
 *
 * URL 里存的是 `kind=internal`、`minMonths=12`，界面上要显示的是「公司内经历」
 * 「1 年」。这两者之间没有任何类型约束，只有一张手写的对照表——写错、漏改、
 * 或者忘了查表把裸值渲染出去，类型检查和构建都不会响。所以这张表只有一份，
 * 放在这里，由 `tests/filters.test.ts` 钉住。
 *
 * 这里给出的是描述，不是组件：谁来渲染、渲染成一列按钮还是别的什么，
 * 由界面层决定；值怎么解释、清空要写回什么，只在这一个文件里定义。
 *
 * 两类维度：**分面**（有候选列表和人数）与**文本条件**（公司名 / 学校名，
 * 来自查询理解或链接，没有候选列表，只能看见和清掉）。
 */
import { duration } from "#/lib/format";
import type { Facets } from "#/search/result";
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
	/** 当前值。未选就是 `undefined`——和 `set` 里「清空」用的是同一个写法。 */
	value: string | undefined;
	options: FilterOption[];
	/** 选中或清空时要写回 URL 的更新 */
	set: (v: string | undefined) => Partial<View>;
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
 * 保证当前选中的那一项一定在列表里。
 *
 * 分面的值域由**这次查询**决定（`rank.ts` 的 `facetCount`），而 URL 上的筛选
 * 会跟着人走到下一条查询记录上——上一次搜「算法」时选的序列，在这次搜「财务」
 * 的候选里可能一个人都没有，于是它从列表里消失，然后就没有任何东西能取消它了。
 * 这里把它补回来，计数为 0，界面上照样是选中态、照样点得动。
 */
function ensureSelected(
	options: FilterOption[],
	value: string | undefined,
	label: string,
) {
	if (!value || options.some((o) => o.value === value)) return options;
	return [{ value, label, n: 0 }, ...options];
}

/** 取值即标签的那几维（公司档、职级、招聘渠道、学历）共用这一个形状。 */
function plain(
	key: "companyTag" | "level" | "recruitment" | "education",
	title: string,
	facet: { value: string; n: number }[],
	value: string | undefined,
): FilterField {
	return {
		key,
		title,
		value,
		options: ensureSelected(
			facet.map((f) => ({ value: f.value, label: f.value, n: f.n })),
			value,
			value ?? "",
		),
		set: (v) => ({ [key]: v }),
	};
}

export function filterFields(facets: Facets, view: View): FilterField[] {
	const seq = view.seq;
	const kind = view.kind;
	const minMonths = view.minMonths ? String(view.minMonths) : undefined;

	return [
		{
			key: "seq",
			title: "序列",
			value: seq,
			// 二级序列名跨一级会重名，所以值是 "一级/二级"，展示才拆成 "一级 · 二级"
			options: ensureSelected(
				facets.seq.map((s) => ({
					value: `${s.seqL1}/${s.seqL2}`,
					label: `${s.seqL1} · ${s.seqL2}`,
					n: s.n,
				})),
				seq,
				seq?.replace("/", " · ") ?? "",
			),
			set: (v) => ({ seq: v }),
		},
		plain("level", "职级", facets.level, view.level),
		{
			key: "kind",
			title: "经历来源",
			value: kind,
			options: ensureSelected(
				facets.kind.map((k) => ({
					value: k.value,
					label: KIND_LABEL[k.value],
					n: k.n,
				})),
				kind,
				(kind && KIND_LABEL[kind]) ?? "",
			),
			set: (v) => ({ kind: v as View["kind"] }),
		},
		{
			key: "minMonths",
			title: "经历时长",
			value: minMonths,
			options: ensureSelected(
				facets.minMonths.map((m) => ({
					value: String(m.value),
					label: duration(m.value),
					n: m.n,
				})),
				minMonths,
				minMonths ? duration(Number(minMonths)) : "",
			),
			set: (v) => ({ minMonths: Number(v) || undefined }),
		},
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

type ActiveFilter = {
	key: FilterField["key"] | TextFilter["key"];
	label: string;
	/** 单独摘掉这一个筛选 */
	clear: Partial<View>;
};

/**
 * 已生效的筛选，按维度的固定顺序——摘掉一个不会让其余的重新排队。
 *
 * 找不到对应选项时退回裸值：这只会发生在筛选项列表变了而 URL 还停在旧值上
 * （比如某个公司档在这次检索里一个人都没有）。宁可显示一个丑的原始值，
 * 也不能悄悄当它不存在，否则界面上没有任何东西能解释「为什么只剩 3 个人」。
 */
export function activeFilters(
	fields: FilterField[],
	texts: TextFilter[],
): ActiveFilter[] {
	return [
		...fields.flatMap((f) => {
			if (!f.value) return [];
			return [
				{
					key: f.key,
					label: f.options.find((o) => o.value === f.value)?.label ?? f.value,
					clear: f.set(undefined),
				},
			];
		}),
		...texts.map((t) => ({ key: t.key, label: t.value, clear: t.clear })),
	];
}
