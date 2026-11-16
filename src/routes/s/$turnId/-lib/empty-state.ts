import { SEARCHABLE } from "#/search/condition-label";
import type { EmptyReason } from "#/search/empty";
import { labelsInSentence, type QueryCondition, withOff } from "#/search/query";
import type { SearchMode } from "#/server/turn";
import { CLEARED_FILTERS, type View } from "./view-params";

/**
 * 符合的人较多、名单还没列全时的下一步：句子里说补充条件，按钮是条件不变接着往下找。
 * 名单上方的提示（`completeness.tsx`）和空态说同一句、用同一个按钮。
 */
export const NARROW = "补充职级、部门等条件可以找得更准。";
export const CONTINUE_LABEL = "继续找";

type EmptyCopy = {
	title: string;
	hint: string;
	/** 下一步。要等结果的动作交回它的 Promise，按钮等它（`Button` 的 `onClick`）。 */
	action: { label: string; onClick: () => unknown };
};

type Handlers = {
	/**
	 * 对话还是关键词。下一步按各自手里有的东西说：关键词没有「加分」也没有停用，
	 * 只有框里的词可改；「修改需求」只属于 AI 搜索。
	 */
	mode: SearchMode;
	/** 这条查询的条件。「把停用的全部启用」改的是它。 */
	conditions: readonly QueryCondition[];
	/** 改视图：筛选、翻页。不产生新的查询记录。 */
	onChange: (next: Partial<View>) => void;
	/** 改查询：记一条新记录。 */
	onReviseQuery: (next: QueryCondition[]) => unknown;
	onEditQuery: () => void;
	/** 条件不变，接着往下找：记一条新记录。没有谁能接着找时（没配 AI 服务）不给。 */
	onContinue?: () => unknown;
};

/**
 * 名单空了该说什么，以及给一条什么样的下一步。成因由检索层判定（`search/empty.ts`
 * 的 `emptyReason`），这里只翻译成文案，不用计数反推。
 * 改视图走 `onChange`，改条件走 `onReviseQuery`。成因在这里穷尽。
 */
const COPY: {
	[K in EmptyReason["kind"]]: (
		reason: Extract<EmptyReason, { kind: K }>,
		h: Handlers,
	) => EmptyCopy;
} = {
	overflowEvidence: (reason, h) => ({
		title: "条件范围过大",
		hint: `「${reason.claims.map((claim) => claim.label).join("」「")}」几乎所有人都满足，${h.mode === "keyword" ? "请换一个更具体的词" : "请描述得更具体，或先停用这一项"}。`,
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
			onClick: () => h.onReviseQuery(h.conditions.map((c) => withOff(c, null))),
		},
	}),
	// 搜索条件为空时仍保留查询记录，用户可以继续添加需求或回退。
	noConditions: (_reason, h) => ({
		title: "没有可用的搜索条件",
		hint: `目前支持${SEARCHABLE}，请添加搜索条件。`,
		action: {
			label: h.mode === "keyword" ? "填写关键词" : "修改需求",
			onClick: h.onEditQuery,
		},
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
	// 决定谁上名单的是启用着、不是加分的那几项：只有一项时是这一项没有人，几项时是没有人都符合
	unmet: (_reason, h) => {
		const deciding = h.conditions.filter((c) => !c.off && c.mode !== "boost");
		const named = labelsInSentence(deciding);
		const [title, hint] =
			deciding.length > 1
				? [
						"没有人同时符合这几项条件",
						h.mode === "keyword"
							? "没有人的简历同时写到这几个关键词，移除一个关键词可以扩大范围。"
							: `${named}，这几项要都符合才会列出。把其中一项改为「加分」，符合其余几项的人也会列出，都符合的排在前面。`,
					]
				: [
						"没有找到符合的人",
						h.mode === "keyword"
							? "人才库里没有简历写到这个词，换一个说法试试。"
							: `人才库里没有找到符合「${named}」的人，可以换一种说法，或把要求放宽一些。`,
					];
		return {
			title,
			hint,
			action: { label: "调整条件", onClick: h.onEditQuery },
		};
	},
	noneMatched: (_reason, h) => ({
		title: "没有相关的人",
		hint: "所有条件都是加分项，但没有人满足其中任何一项。",
		action: { label: "调整条件", onClick: h.onEditQuery },
	}),
	incomplete: (reason, h) => ({
		title: reason.above
			? `${reason.above} 及以上没有符合的人`
			: "暂时没有找到符合的人",
		hint: `符合的人较多，${reason.above ? "更低职级的" : ""}还没找完。${NARROW}`,
		action: h.onContinue
			? { label: CONTINUE_LABEL, onClick: h.onContinue }
			: { label: "补充需求", onClick: h.onEditQuery },
	}),
};

export function emptyState(reason: EmptyReason, handlers: Handlers): EmptyCopy {
	// 每种成因带着自己的数据，TS 推断不出这份对应关系，在这一处断言。
	const copy = COPY[reason.kind] as (r: EmptyReason, h: Handlers) => EmptyCopy;
	return copy(reason, handlers);
}
