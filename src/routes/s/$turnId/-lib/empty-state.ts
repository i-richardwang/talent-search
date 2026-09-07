import type { EmptyReason } from "#/search/empty";
import { type Requirement, withOff } from "#/search/requirement";
import { CLEARED_FILTERS, type View } from "./view-params";

/**
 * 名单空了该说什么，以及给一条什么样的出路。
 *
 * **这里只有文案和出路，没有判断。** 「为什么是空的」由检索层给出
 * （`search/empty.ts` 的 `emptyReason`）——那一侧手里有候选事实、AND 判定和
 * 筛选，成因是它顺手就知道的；在这里拿几个二手计数反推，等于把服务端刚做过的
 * 判断再做一遍，两份推理迟早分叉，而分叉的表现是一句说错的话，不是一次报错。
 *
 * 每一支都配一个能一键走的动作——空态最要命的不是没有结果，是没人知道下一步
 * 该改哪。动作分两类，走错了不会报错：改视图走 `onChange`（同一条查询，换个
 * 看法），改条件走 `onReviseQuery`（换一个问题，派生一条新的查询记录）。
 *
 * 表是**穷尽的** `Record`：检索层多一种成因，这里少写一句话，`tsc` 当场就红。
 */
type EmptyCopy = {
	title: string;
	hint: string;
	action: { label: string; onClick: () => void };
};

type Handlers = {
	/** 这条查询的证据要求。「把停用的全部启用」改的是它。 */
	requirements: readonly Requirement[];
	/** 改视图：筛选、翻页。不产生新的查询记录。 */
	onChange: (next: Partial<View>) => void;
	/** 改查询：派生一条新记录。 */
	onReviseQuery: (next: Requirement[]) => void;
	onEditQuery: () => void;
};

/** 成因 → 说什么、给哪条出路。 */
const COPY: {
	[K in EmptyReason["kind"]]: (
		reason: Extract<EmptyReason, { kind: K }>,
		h: Handlers,
	) => EmptyCopy;
} = {
	overflowEvidence: (reason, h) => ({
		title: "匹配证据过多",
		hint: `「${reason.terms.join("」「")}」产生的匹配证据最多，请换成更具体的说法，或先停用。`,
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
	overflowPopulation: (_reason, h) => ({
		title: "查询范围过大",
		hint: "请添加更具体的范围条件或经历要求，再查看完整结果。",
		action: { label: "添加条件", onClick: h.onEditQuery },
	}),
	allDisabled: (_reason, h) => ({
		title: "当前没有启用的搜索条件",
		hint: "请重新启用条件，或添加岗位、经验或能力。",
		action: {
			label: "启用全部条件",
			// 启用是**改查询**，不是改视图：条件变了，找的就是另一批人。所以它
			// 派生一条新记录。
			onClick: () =>
				h.onReviseQuery(h.requirements.map((r) => withOff(r, false))),
		},
	}),
	excludeOnly: (_reason, h) => ({
		title: "缺少搜索条件",
		hint: "当前只有排除条件，请添加至少一项岗位、经验或能力。",
		action: { label: "添加条件", onClick: h.onEditQuery },
	}),
	unsupportedOnly: (_reason, h) => ({
		title: "这些条件暂不支持",
		hint: "请补充岗位、经验或能力；未支持的条件不会参与搜索。",
		action: { label: "添加条件", onClick: h.onEditQuery },
	}),
	noConditions: (_reason, h) => ({
		title: "未识别到有效的搜索条件",
		hint: "请用一句话说要找什么样的人，例如「做过渠道运营、带过团队」。",
		action: { label: "重新输入", onClick: h.onEditQuery },
	}),
	scopeEmpty: (_reason, h) => ({
		title: "没有符合查询范围的员工",
		hint: "请移除一项范围条件，或添加经历要求重新搜索。",
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
	strongEmpty: (reason, h) => ({
		title: "没有任职记录能证明的结果",
		hint: `关掉「只看任职记录可查的」后可查看 ${reason.without} 人。`,
		action: {
			label: "关掉这项要求",
			onClick: () => h.onChange({ strong: undefined }),
		},
	}),
	filtered: (_reason, h) => ({
		title: "当前筛选下无结果",
		hint: "清除筛选后可查看符合搜索条件的结果。",
		action: {
			label: "清除筛选",
			onClick: () => h.onChange(CLEARED_FILTERS),
		},
	}),
	unmet: (_reason, h) => ({
		title: "没有符合全部必选条件的结果",
		hint: "把较次要的条件改为「加分」，可以保留没有这段经历的人。",
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
};

export function emptyState(reason: EmptyReason, handlers: Handlers): EmptyCopy {
	// 联合的每一支各自带着自己的数据（点名哪几个词、还剩几人），
	// 而 TS 收不拢这份对应关系，只能在这一处断言。
	const copy = COPY[reason.kind] as (r: EmptyReason, h: Handlers) => EmptyCopy;
	return copy(reason, handlers);
}
