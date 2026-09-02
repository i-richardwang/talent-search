import type { Chip } from "#/search/parse";
import type { SearchOverflow, TermPlan } from "#/search/result";
import type { SearchScope } from "#/search/spec";
import { CLEARED_FILTERS, hasFilters, type View } from "./view-params";

/**
 * 名单空了该说什么，以及给一条什么样的出路。
 *
 * 每一支都配一个能一键走的动作——空态最要命的不是没有结果，是没人知道下一步
 * 该改哪。`overflow` 排在最前：它表示候选事实多到不能完整排名，和
 * 「一个人都没有」正相反，所以不能并进下面那几支。
 */
export function emptyState({
	terms,
	chips,
	scope,
	unsupported,
	overflow,
	withoutStrong,
	view,
	onChange,
	onReviseQuery,
	onFocusQuery,
}: {
	terms: TermPlan[];
	chips: Chip[];
	scope: SearchScope;
	unsupported: string[];
	overflow: SearchOverflow | null;
	withoutStrong: number;
	view: View;
	/** 改视图：筛选、翻页。不产生新的查询记录。 */
	onChange: (next: Partial<View>) => void;
	/** 改查询：派生一条新记录。「把停用的条件全启用」走这条。 */
	onReviseQuery: (next: Chip[]) => void;
	onFocusQuery: () => void;
}) {
	if (overflow?.kind === "evidence") {
		return {
			title: "匹配证据过多",
			hint: `「${overflow.terms.join("」「")}」产生的匹配证据最多，请换成更具体的说法，或先停用。`,
			action: { label: "调整条件", onClick: onFocusQuery },
		};
	}
	if (overflow?.kind === "population")
		return {
			title: "查询范围过大",
			hint: "请添加更具体的范围条件或经历要求，再查看完整结果。",
			action: { label: "添加条件", onClick: onFocusQuery },
		};
	if (terms.length === 0) {
		if (chips.some((chip) => chip.off && chip.mode !== "exclude")) {
			return {
				title: "当前没有启用的搜索条件",
				hint: "请重新启用条件，或添加岗位、经验或能力。",
				action: {
					label: "启用全部条件",
					onClick: () =>
						// 启用是**改查询**，不是改视图：条件变了，找的就是另一批人。
						// 所以它派生一条新记录，而不是改几个 URL 参数。
						onReviseQuery(
							chips.map((chip) => ({ term: chip.term, mode: chip.mode })),
						),
				},
			};
		}
		if (chips.length > 0) {
			return {
				title: "缺少搜索条件",
				hint: "当前只有排除条件，请添加至少一项岗位、经验或能力。",
				action: { label: "添加条件", onClick: onFocusQuery },
			};
		}
		if (Object.keys(scope).length > 0) {
			if (hasFilters(view))
				return {
					title: "当前筛选下无结果",
					hint: "清除筛选后可查看符合查询范围的结果。",
					action: {
						label: "清除筛选",
						onClick: () => onChange(CLEARED_FILTERS),
					},
				};
			return {
				title: "没有符合查询范围的员工",
				hint: "请移除一项范围条件，或添加经历要求重新搜索。",
				action: { label: "调整条件", onClick: onFocusQuery },
			};
		}
		if (unsupported.length > 0)
			return {
				title: "这些条件暂不支持",
				hint: "请补充岗位、经验或能力；未支持的条件不会参与搜索。",
				action: { label: "添加条件", onClick: onFocusQuery },
			};
		return {
			title: "未识别到有效的搜索条件",
			hint: "请输入岗位、经验或能力，例如「渠道运营、带团队」。",
			action: { label: "重新输入", onClick: onFocusQuery },
		};
	}
	if (withoutStrong > 0) {
		return {
			title: "没有符合当前匹配来源要求的结果",
			hint: `放宽匹配来源后可查看 ${withoutStrong} 人。`,
			action: {
				label: "放宽匹配来源",
				onClick: () => onChange({ strong: undefined }),
			},
		};
	}
	if (hasFilters(view)) {
		return {
			title: "当前筛选下无结果",
			hint: "清除筛选后可查看符合搜索条件的结果。",
			action: {
				label: "清除筛选",
				onClick: () => onChange(CLEARED_FILTERS),
			},
		};
	}
	return {
		title: "没有符合全部必选条件的结果",
		hint: "把较次要的条件改为「加分」，可以保留没有这段经历的人。",
		action: { label: "调整条件", onClick: onFocusQuery },
	};
}
