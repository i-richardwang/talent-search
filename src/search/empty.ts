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
 * 一键出路住在 `routes/s/$turnId/-lib/empty-state.ts`，那是产品文案，跟着界面改。
 * 它是纯函数、不带 `db`，所以页面可以从这里取值（分界见 `result.ts`）。
 */
import { narrowsPopulation } from "./params";
import type { SearchFilters, TermPlan } from "./result";
import type { SearchSpec } from "./spec";
import { experienceTerms, scopeOf } from "./term";

/**
 * 取数撞上保险丝。它是检索自己才知道的一件事——`emptyReason` 推不出来，所以
 * 由调用方交进来；单独取个名字是为了让参数说得出「这里只能是这两支」。
 */
type EmptyOverflow =
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
	/** 一个条件都没解析出来。 */
	| { kind: "noConditions" }
	/** 只有必须的结构化范围，范围内没有人。 */
	| { kind: "scopeEmpty" }
	/** 证据要求把人滤空了；`without` 是关掉它能看到多少人。 */
	| { kind: "strongEmpty"; without: number }
	/** 当前筛选下没人。清掉筛选就能看到。 */
	| { kind: "filtered" }
	/** 没有人满足全部必须条件。 */
	| { kind: "unmet" }
	/** 没有一条条件是必须的，而没有人沾上任何一条。 */
	| { kind: "noHits" };

/**
 * 这次检索为什么没给出人。有人就是 `null`——判断「要不要画空态」和判断
 * 「空态说什么」是同一个问题，不该在界面上再问一次。
 */
export function emptyReason(input: {
	spec: SearchSpec;
	filters: SearchFilters;
	/** 可执行的正向条件（停用与排除都已经摘掉）。 */
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

	// **跑过一次检索，就报这次检索的结果。** 下面那几支答的是「什么都没能产出
	// 候选人」，而经历条件和结构化范围各自都是一份完整的候选定义——只要有一份
	// 在场，检索就真的跑过了，成因得从它找出来的那批人里说。顺序反过来的话，
	// 「只看入职前经历，不要实习」会被报成「你只写了排除词」，而那句话的出路
	// （补一条条件）和真正的出路（放宽范围）正好不是一回事。
	const ran =
		terms.length > 0 ||
		narrowsPopulation(scopeOf(spec.terms, "must")) ||
		narrowsPopulation(scopeOf(spec.terms, "boost"));
	if (ran) {
		if (terms.length > 0 && filters.strong && withoutStrong > 0)
			return { kind: "strongEmpty", without: withoutStrong };
		if (narrowsPopulation(filters)) return { kind: "filtered" };
		// 出路跟着「有没有必须的东西」走：有必须词就是它们没被同时满足，
		// 只有必须范围就是范围里没人；什么都不是必须的（只有加分词、只有偏好
		// 的范围）就是没有人沾上任何一条，改法是换词，不是放宽——没有可放宽的。
		if (terms.some((t) => t.mode === "must")) return { kind: "unmet" };
		if (terms.length === 0 && narrowsPopulation(scopeOf(spec.terms, "must")))
			return { kind: "scopeEmpty" };
		return { kind: "noHits" };
	}

	// 什么都没跑：条件要么被自己停用了，要么本来就产不出候选人。
	// 排除词的停用不算「我把条件停了」：它本来就不产出人
	if (spec.terms.some((t) => t.off && t.mode !== "exclude"))
		return { kind: "allDisabled" };
	if (experienceTerms(spec.terms).length > 0) return { kind: "excludeOnly" };
	return { kind: "noConditions" };
}
