/**
 * 一条命中的证据算哪一档、怎么念。分档的理由只在 weights.ts 写一遍，这里不复述。
 *
 * 放在检索层而不是组件层：排名比的档和点阵画的档必须是同一份，
 * 组件层只负责把这三档翻译成颜色和文案。
 */
import type { Claim, Hit } from "#/search/result";
import {
	ROUTE_STRENGTH,
	type Route,
	type Strength,
	strengthRank,
} from "#/search/weights";

export type { Strength } from "#/search/weights";

/** 落在范围里本身就是登记事实（公司、来源、时长都是 HR 登记的），和序列、岗位同档。 */
export function strengthOf(route: Route | null): Strength {
	return route === null ? "controlled" : ROUTE_STRENGTH[route];
}

const ROUTE_LABEL: Record<Route, string> = {
	seq: "序列",
	title: "岗位",
	org: "部门或公司",
	description: "简历原文",
	skill: "技能",
	// 做过的事那一路，说法本身已经是「从零搭建 · 推荐系统」，不再另起类型名
	did: "",
};

/**
 * 一条命中的来源怎么念——证据行、时间线、命令行念的是同一个词。不比文本的
 * 命中（「待过字节」那种主张）没有路：这一段本身就是证据，念的是它的任职。
 */
export function routeLabel(route: Route | null) {
	return route === null ? "任职" : ROUTE_LABEL[route];
}

/**
 * 每条主张取展示列表中的第一条命中。hits 已按主张顺序、证据强度、单段时长排好。
 *
 * AND 语义下每条必须的主张必有命中（rank.ts 的 complete）；加分的可以没有，
 * 所以返回值保留 `undefined`，调用方按未命中渲染。
 */
export function bestHitPerClaim(hits: Hit[], claims: readonly Claim[]) {
	return claims.map((_, i) => hits.find((h) => h.claim === i));
}

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
		if (!best || strengthRank(s) < strengthRank(best)) best = s;
	}
	return best;
}
