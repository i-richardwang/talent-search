/**
 * 四个筛选维度的唯一事实源。
 *
 * URL 里存的是 `kind=internal`、`minMonths=12`，界面上要显示的是「公司内经历」
 * 「1 年」。这两者之间没有任何类型约束，只有一张手写的对照表——写错、漏改、
 * 或者忘了查表把裸值渲染出去，类型检查和构建都不会响。所以这张表只有一份，
 * 放在这里，由 `tests/filters.test.ts` 钉住。
 *
 * 这里给出的是描述，不是组件：谁来渲染、渲染成一列按钮还是别的什么，
 * 由界面层决定；值怎么解释、清空要写回什么，只在这一个文件里定义。
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
	key: "seq" | "companyTag" | "kind" | "minMonths";
	/**
	 * 这一组的标题。有了它，选项文案才能缩短：「经历时长」下面写「1 年」就够了，
	 * 不必每一项都重复成「至少 1 年」。
	 */
	title: string;
	/** 当前值。空串表示未选——URL 里是 undefined，控件要的是 ""。 */
	value: string;
	options: FilterOption[];
	/** 选中或清空时要写回 URL 的更新 */
	set: (v: string | undefined) => Partial<View>;
};

const KIND_LABEL: Record<"internal" | "external", string> = {
	internal: "公司内经历",
	external: "入职前经历",
};

/**
 * 保证当前选中的那一项一定在列表里。
 *
 * 分面只返回还数得出人的选项，所以两个筛选叠在一起把结果打到 0 时，
 * 选中的那一项自己会从列表里消失——然后就没有任何东西能取消它了。
 * 这里把它补回来，计数为 0，界面上照样是选中态。
 */
function ensureSelected(options: FilterOption[], value: string, label: string) {
	if (!value || options.some((o) => o.value === value)) return options;
	return [{ value, label, n: 0 }, ...options];
}

export function filterFields(facets: Facets, view: View): FilterField[] {
	const seq = view.seq ?? "";
	const companyTag = view.companyTag ?? "";
	const kind = view.kind ?? "";
	const minMonths = view.minMonths ? String(view.minMonths) : "";

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
				seq.replace("/", " · "),
			),
			set: (v) => ({ seq: v }),
		},
		{
			key: "companyTag",
			title: "入职前公司",
			value: companyTag,
			options: ensureSelected(
				facets.companyTag.map((t) => ({
					value: t.value,
					label: t.value,
					n: t.n,
				})),
				companyTag,
				companyTag,
			),
			set: (v) => ({ companyTag: v }),
		},
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
				KIND_LABEL[kind as "internal" | "external"] ?? kind,
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
	];
}

type ActiveFilter = {
	key: FilterField["key"];
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
export function activeFilters(fields: FilterField[]): ActiveFilter[] {
	return fields
		.filter((f) => f.value !== "")
		.map((f) => ({
			key: f.key,
			label: f.options.find((o) => o.value === f.value)?.label ?? f.value,
			clear: f.set(undefined),
		}));
}
