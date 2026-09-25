import { type Condition, withOff } from "#/search/condition";
import { claimName, SEARCHABLE } from "#/search/condition-label";
import type { EmptyReason } from "#/search/empty";
import type { SearchMode } from "#/server/turn";
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
	/**
	 * 对话还是关键词。出路按各自手里有的东西说：关键词没有「加分」也没有停用，
	 * 只有框里的词可改；「修改需求」只属于 AI 搜索。
	 */
	mode: SearchMode;
	/** 这条查询的条件。「把停用的全部启用」改的是它。 */
	conditions: readonly Condition[];
	/** 改视图：筛选、翻页。不产生新的查询记录。 */
	onChange: (next: Partial<View>) => void;
	/** 改查询：派生一条新记录。 */
	onReviseQuery: (next: Condition[]) => void;
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
		title: "条件范围过大",
		hint: `「${reason.claims.map(claimName).join("」「")}」几乎所有人都满足，${h.mode === "keyword" ? "请换一个更具体的词" : "请描述得更具体，或先停用这一项"}。`,
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
	overflowPopulation: (_reason, h) => ({
		title: "范围过大",
		hint: "请再添加一项更具体的条件。",
		action: { label: "添加条件", onClick: h.onEditQuery },
	}),
	allDisabled: (_reason, h) => ({
		title: "没有启用的条件",
		hint: "请启用已停用的条件，或添加新条件。",
		action: {
			label: "启用全部",
			// 启用是**改查询**，不是改视图：条件变了，找的就是另一批人。所以它
			// 派生一条新记录。
			onClick: () => h.onReviseQuery(h.conditions.map((c) => withOff(c, null))),
		},
	}),
	excludeOnly: (_reason, h) => ({
		title: "还缺一项条件",
		hint: "目前只有排除条件，请再添加一项要找的条件。",
		action: { label: "添加条件", onClick: h.onEditQuery },
	}),
	// 只在一整句都搜不了时出现：为什么搜不了，线程里那一轮底下已经逐条说了
	noConditions: (_reason, h) => ({
		title: "没有可用的搜索条件",
		hint: `目前支持${SEARCHABLE}，请换一种描述。`,
		action: { label: "修改需求", onClick: h.onEditQuery },
	}),
	gatesUnmet: (_reason, h) => ({
		title: "没有符合条件的人",
		hint: "请移除一项条件后再搜索。",
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
	filtered: (_reason, h) => ({
		title: "当前筛选下没有结果",
		hint: "请清除筛选后再查看。",
		action: {
			label: "清除筛选",
			onClick: () => h.onChange(CLEARED_FILTERS),
		},
	}),
	unmet: (_reason, h) => ({
		title: "没有同时满足必须条件的人",
		hint:
			h.mode === "keyword"
				? "移除一个关键词可以扩大范围。"
				: "把次要条件改为「加分」可以扩大范围。",
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
	noHits: (_reason, h) => ({
		title: "没有相关的人",
		hint: "所有条件都是加分项，但没有人满足其中任何一项。",
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
};

export function emptyState(reason: EmptyReason, handlers: Handlers): EmptyCopy {
	// 联合的每一支各自带着自己的数据（点名哪几个词、还剩几人），
	// 而 TS 收不拢这份对应关系，只能在这一处断言。
	const copy = COPY[reason.kind] as (r: EmptyReason, h: Handlers) => EmptyCopy;
	return copy(reason, handlers);
}
