import type { EmptyReason, Unmet } from "#/search/empty";
import { labelsInSentence, type QueryCondition, withOff } from "#/search/query";
import type { SearchMode } from "#/server/turn";
import { CLEARED_FILTERS, type View } from "./view-params";

/**
 * 名单还没列全时的下一步：句子里说补充条件，按钮是条件不变接着往下找。
 * 名单上方的提示（`completeness.tsx`）和空态说同一句、用同一个按钮。
 */
export const NARROW = "补充职级、部门等条件可以找得更准。";
export const CONTINUE_LABEL = "继续找";

/**
 * 空态给的下一步。HR 不需要懂条件怎么分强度：要么是一个按下去名单就变的按钮，按钮上写
 * 会得到什么；要么请他自己再说一句（`say`），光标进输入框，对话的输入框里换上一句
 * 示范说法（`example`）。
 */
export type EmptyNext =
	| { kind: "act"; label: string; onClick: () => unknown }
	| { kind: "say"; example?: string };

type EmptyCopy = {
	title: string;
	hint: string;
	/** 没有能做的事时为 null（没配 AI 服务的对话，名单又停在要 AI 才能往下走的地方）。 */
	next: EmptyNext | null;
};

type Handlers = {
	/** 对话还是关键词。关键词没有停用，也没有 AI 可以说话，只有框里的词可改。 */
	mode: SearchMode;
	/** 这条查询的条件。「全部启用」「去掉这一项」改的是它。 */
	conditions: readonly QueryCondition[];
	/** 改视图：筛选、翻页。不产生新的查询记录。 */
	onChange: (next: Partial<View>) => void;
	/** 改查询：记一条新记录。 */
	onReviseQuery: (next: QueryCondition[]) => unknown;
	/** 替 HR 对 AI 说一句话，和他自己在输入框里说的一样。没配 AI 服务时不给。 */
	onSay?: (text: string) => unknown;
	/** 条件不变，接着往下找：记一条新记录。没有谁能接着找时（没配 AI 服务）不给。 */
	onContinue?: () => unknown;
	/** 有地方让 HR 自己写：对话配了 AI 服务，或者关键词的框。没有时 `say` 不出现。 */
	canSay: boolean;
};

/** 请 HR 再说一句；没有地方可说时没有下一步。 */
const say = (h: Handlers, example?: string): EmptyNext | null =>
	h.canSay ? { kind: "say", example } : null;

const quoted = (conditions: readonly QueryCondition[]) =>
	conditions.map((c) => `「${c.label}」`).join("");

/**
 * 名单空了该说什么，以及给一条什么样的下一步。成因由检索层判定（`search/empty.ts`
 * 的 `emptyReason`），这里只翻译成文案，不用计数反推。
 * 改视图走 `onChange`，改条件走 `onReviseQuery`，要 AI 改写条件的走 `onSay`。成因在这里穷尽。
 */
const COPY: {
	[K in EmptyReason["kind"]]: (
		reason: Extract<EmptyReason, { kind: K }>,
		h: Handlers,
	) => EmptyCopy;
} = {
	// 太宽的那几项去掉之后还有别的条件，去掉就能出名单；没有别的了，只能换个具体的说法。
	// 太宽的是排除条件时，太常见的是要排除的那种经历
	overflowEvidence: (reason, h) => {
		const wide = new Set(reason.conditions.map((c) => c.id));
		const rest = h.conditions.filter((c) => !c.off && !wide.has(c.id));
		const excluding = reason.conditions.every((c) => c.mode === "exclude");
		const title = excluding
			? `要排除的${quoted(reason.conditions)}太常见，名单列不出来`
			: `${quoted(reason.conditions)}太常见，找到的人太多`;
		if (h.mode === "keyword")
			return {
				title,
				hint: "换一个更具体的词，比如具体的业务或技术。",
				next: say(h),
			};
		if (rest.length > 0)
			return {
				title,
				hint: excluding
					? "去掉后按其余的条件找，或者把要排除的经历说得更具体。"
					: "去掉后按其余的条件找，或者换一个更具体的说法。",
				next: {
					kind: "act",
					label:
						reason.conditions.length > 1
							? "去掉这几项再找"
							: `去掉${quoted(reason.conditions)}再找`,
					onClick: () =>
						h.onReviseQuery(
							h.conditions.map((c) =>
								wide.has(c.id) ? withOff(c, "user") : c,
							),
						),
				},
			};
		return {
			title,
			hint: "换一个更具体的说法，比如做过哪类项目、负责哪块业务。",
			next: say(h, "说得具体一些，比如：做过哪类项目、负责哪块业务"),
		};
	},
	overflowPopulation: (_reason, h) => ({
		title: "找到的人太多，列不出来",
		hint:
			h.mode === "keyword"
				? "再填一个经历或技能，范围就能缩小。"
				: "再补充一句要找什么样的人，比如做过什么工作。",
		next: say(h, "再补充一句，比如：做过招聘的"),
	}),
	allDisabled: (_reason, h) => ({
		title: "搜索条件都停用了",
		hint: "启用后，会按这些条件重新列出名单。",
		next: {
			kind: "act",
			label: "全部启用",
			onClick: () => h.onReviseQuery(h.conditions.map((c) => withOff(c, null))),
		},
	}),
	noConditions: (_reason, h) => {
		if (h.mode === "keyword")
			return {
				title: "还没有填关键词",
				hint: "在上方填一个经历或技能，比如：推荐算法。",
				next: say(h),
			};
		return {
			title: "当前没有搜索条件",
			hint: h.canSay
				? "在对话里说说要找的人做过什么工作。"
				: "可以在对话里查看这次的搜索记录。",
			next: say(h, "比如：做过线下渠道运营、带过团队的人"),
		};
	},
	filtered: (_reason, h) => ({
		title: "筛选后一个人也没有",
		hint: "名单上的人都不在当前筛选里。",
		next: {
			kind: "act",
			label: "清除筛选",
			onClick: () => h.onChange(CLEARED_FILTERS),
		},
	}),
	unmet: (reason, h) => unmet(reason, h),
	incomplete: (reason, h) => ({
		title: reason.above
			? `${reason.above} 及以上没有符合的人`
			: "暂时没有找到符合的人",
		hint: `${reason.above ? "更低职级的还没找完" : "还没找完"}。${NARROW}`,
		next: h.onContinue
			? { kind: "act", label: CONTINUE_LABEL, onClick: h.onContinue }
			: say(h),
	}),
};

/**
 * 决定谁上名单的条件合起来没有人。先说确定的事：有哪几项单独就没有人（`nobody`），标题点名，
 * 去掉它们还剩别的要求时一键去掉再找，不然请 HR 换个说法。每一项单独都有人时，是几项凑不到
 * 同一个人身上：请 AI 改成符合其中一项就行——「或者」要写成一条条件、按新的判据读，只改强度
 * 做不到（加分不缩小候选，名单会变成全公司）。只剩一项要求时是排除条件把人都拦下了。
 * 一项决定去留的都没有还是空的，是人才库里还没有人。
 */
function unmet({ nobody }: Unmet, h: Handlers): EmptyCopy {
	const enabled = h.conditions.filter((c) => !c.off);
	const deciding = enabled.filter((c) => c.mode !== "boost");
	const musts = deciding.filter((c) => c.mode === "must");
	if (deciding.length === 0)
		return {
			title: "人才库里还没有人",
			hint: "管理员同步人才数据之后，就可以在这里找人了。",
			next: null,
		};
	const missing = musts.filter((c) => nobody.includes(c.id));
	if (missing.length > 0) return absent(missing, musts, h);
	const named = labelsInSentence(deciding);
	if (musts.length > 1) {
		if (h.mode === "keyword")
			return {
				title: `没有人同时符合：${named}`,
				hint: "没有人的简历同时写到这几个词，去掉一个词可以扩大范围。",
				next: say(h),
			};
		const { onSay } = h;
		return {
			title: `没有人同时符合：${named}`,
			hint: "可以先看只符合其中一项的人，或者在对话里换个说法再找。",
			next: onSay
				? {
						kind: "act",
						label: "符合其中一项就行",
						onClick: () =>
							onSay(`不用同时符合，${labelsInSentence(musts)}符合其中一项就行`),
					}
				: null,
		};
	}
	return {
		title: musts[0]
			? `符合「${musts[0].label}」的人都被排除了`
			: "人才库里的人都被排除了",
		hint: "可以把要排除的说得窄一点，或者换个说法。",
		next: say(h, "换个说法，或把要排除的说得窄一点"),
	};
}

/** 有几项单独就没有人：这是确定的，标题直接说人才库里没有。 */
function absent(
	missing: readonly QueryCondition[],
	musts: readonly QueryCondition[],
	h: Handlers,
): EmptyCopy {
	const title =
		missing.length > 1
			? `${quoted(missing)}在人才库里都没有符合的人`
			: `人才库里没有符合${quoted(missing)}的人`;
	if (h.mode === "keyword")
		return {
			title,
			hint:
				missing.length > 1
					? "没有简历写到这几个词，去掉它们或者换个说法试试。"
					: "没有简历写到这个词，去掉它或者换个说法试试。",
			next: say(h),
		};
	if (musts.length > missing.length) {
		const gone = new Set(missing.map((c) => c.id));
		return {
			title,
			hint: "去掉后按其余的条件找，或者换个说法。",
			next: {
				kind: "act",
				label:
					missing.length > 1 ? "去掉这几项再找" : `去掉${quoted(missing)}再找`,
				onClick: () =>
					h.onReviseQuery(
						h.conditions.map((c) => (gone.has(c.id) ? withOff(c, "user") : c)),
					),
			},
		};
	}
	const label = missing.length > 1 ? "这几项要求" : quoted(missing);
	return {
		title,
		hint: "可以换个说法，或者把这项要求说得宽一点。",
		next: say(h, `换个说法，或把${label}说得宽一点`),
	};
}

export function emptyState(reason: EmptyReason, handlers: Handlers): EmptyCopy {
	// 每种成因带着自己的数据，TS 推断不出这份对应关系，在这一处断言。
	const copy = COPY[reason.kind] as (r: EmptyReason, h: Handlers) => EmptyCopy;
	return copy(reason, handlers);
}
