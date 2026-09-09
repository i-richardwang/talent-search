/**
 * 证据强度模型——weights.ts 里那套权重论证的判定形态。
 *
 * 权重回答"这条证据值多少分"，强度回答"这条证据能不能给人看"。两者同源，
 * 所以分档的理由只在 weights.ts 写一遍，这里不复述分数——复述的数字迟早对不上。
 *
 * 放在检索层而不是组件层：这里定的是「一条证据算哪一档」，
 * 组件层只负责把这三档翻译成颜色和文案。
 */
import type { Hit, TermPlan } from "#/search/result";
import { ROUTE_STRENGTH, type Route, type Strength } from "#/search/weights";

export type { Strength } from "#/search/weights";

export function strengthOf(route: Route): Strength {
	return ROUTE_STRENGTH[route];
}

/**
 * 每条条件取展示列表中的第一条命中。hits 已按词序、证据强度、单段时长排好。
 *
 * AND 语义下每个必须词必有命中（rank.ts 的 complete）；加分词可以没有命中，
 * 所以返回值保留 `undefined`，调用方按未命中渲染。
 */
export function bestHitPerTerm(hits: Hit[], terms: TermPlan[]) {
	return terms.map((t) => hits.find((h) => h.term === t.term));
}

/** 强度由强到弱。时间轴节点要用一段经历里最强的那一路来画。 */
const RANK: Record<Strength, number> = { controlled: 0, org: 1, claimed: 2 };

/**
 * 一段经历为若干条条件提供了证据时，这段经历本身有多强。
 *
 * 取最强的一路而不是最弱的：这一段确实用受控字段证明了某个词，
 * 它另外还顺带在原文里提到了别的词，不该因此被降级。
 */
export function bestStrength(hits: Hit[] | undefined): Strength | undefined {
	if (!hits || hits.length === 0) return undefined;
	let best: Strength | undefined;
	for (const h of hits) {
		const s = strengthOf(h.route);
		if (!best || RANK[s] < RANK[best]) best = s;
	}
	return best;
}
