/**
 * 名单为什么是空的——**成因归检索，文案归界面**。
 *
 * 零结果的这几种成因在屏幕上长得一模一样（都是零行），而出路正好相反：
 * 「你自己把条件全停用了」和「真的没有这样的人」要做的事完全不同。说错了
 * 没有任何断言会红，用户只会拿到一句不对症的建议然后无从下手。
 *
 * 所以它由**跑完这次检索的那一侧**回答：候选事实、AND 判定、筛选、证据要求
 * 都在那里，成因是它顺手就知道的一件事。放在界面上反推的话，那里拿到的是
 * 二手输入（chips、scope、几个计数），得把服务端刚做过的判断再做一遍——
 * 两份推理迟早分叉，而分叉的表现是一句说错的话，不是一次报错。
 *
 * 这个文件只答「为什么」，不答「说什么」：每一种成因对应的标题、提示和那条
 * 一键出路住在 `routes/-lib/empty-state.ts`，那是产品文案，跟着界面改。
 * 它是纯函数、不带 `db`，所以页面可以从这里取值（分界见 `result.ts`）。
 */
import { hasPopulationFilters } from "./params";
import { parseChips } from "./parse";
import type { SearchFilters, TermPlan } from "./result";
import { type SearchSpec, unsupportedOf } from "./spec";

/**
 * 取数撞上保险丝。它是检索自己才知道的一件事——`emptyReason` 推不出来，所以
 * 由调用方交进来；单独取个名字是为了让参数说得出「这里只能是这两支」。
 */
export type EmptyOverflow =
	| { kind: "overflowEvidence"; terms: string[] }
	| { kind: "overflowPopulation" };

/**
 * 一份空名单的成因。判别联合而不是一个字符串枚举：有几种成因带着走出去的
 * 数据（点名哪几个要求、关掉证据要求还剩几人），而那正是出路要用的东西。
 */
export type EmptyReason =
	/** 候选事实多到不能完整排名。这是一种**结果**，不是失败，所以排在最前。 */
	| EmptyOverflow
	/** 条件都在，但全被停用了——和「没有这样的人」正好相反。 */
	| { kind: "allDisabled" }
	/** 只写了排除词：它自己不产出候选人。 */
	| { kind: "excludeOnly" }
	/** 只有不支持的条件，一条都没生效。 */
	| { kind: "unsupportedOnly" }
	/** 一个条件都没解析出来。 */
	| { kind: "noConditions" }
	/** 只有结构化范围，范围内没有人。 */
	| { kind: "scopeEmpty" }
	/** 证据要求把人滤空了；`without` 是关掉它能看到多少人。 */
	| { kind: "strongEmpty"; without: number }
	/** 当前筛选下没人。清掉筛选就能看到。 */
	| { kind: "filtered" }
	/** 没有人满足全部必须条件。 */
	| { kind: "unmet" };

/**
 * 这次检索为什么没给出人。有人就是 `null`——判断「要不要画空态」和判断
 * 「空态说什么」是同一个问题，不该在界面上再问一次。
 */
export function emptyReason(input: {
	spec: SearchSpec;
	filters: SearchFilters;
	/** 可执行的正向要求（停用与排除都已经摘掉）。 */
	terms: TermPlan[];
	/** 通过全部必须条件的人数。 */
	total: number;
	/** 关掉证据要求之后还剩多少人。 */
	withoutStrong: number;
	overflow: EmptyOverflow | null;
}): EmptyReason | null {
	const { spec, filters, terms, total, withoutStrong } = input;
	// 取数超限排在最前：它不是「没有人」，是「多到不能排名」，出路正好相反。
	if (input.overflow) return input.overflow;
	if (total > 0) return null;

	if (terms.length === 0) {
		const chips = parseChips(spec.evidence);
		// 排除词的停用不算「我把条件停了」：它本来就不产出人
		if (chips.some((chip) => chip.off && chip.mode !== "exclude"))
			return { kind: "allDisabled" };
		if (chips.length > 0) return { kind: "excludeOnly" };
		if (Object.keys(spec.scope).length > 0)
			return hasPopulationFilters(filters)
				? { kind: "filtered" }
				: { kind: "scopeEmpty" };
		if (unsupportedOf(spec).length > 0) return { kind: "unsupportedOnly" };
		return { kind: "noConditions" };
	}

	if (filters.strong && withoutStrong > 0)
		return { kind: "strongEmpty", without: withoutStrong };
	if (hasPopulationFilters(filters)) return { kind: "filtered" };
	return { kind: "unmet" };
}
