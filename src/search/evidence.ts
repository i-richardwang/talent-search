/**
 * 证据可信度的纯规则；排名与界面共用同一份档位。
 */
import type { Claim, Hit } from "#/search/result";
import {
	ROUTE_STRENGTH,
	type Route,
	type Strength,
	strengthRank,
} from "#/search/weights";

export type { Strength } from "#/search/weights";

export function strengthOf(route: Route): Strength {
	return ROUTE_STRENGTH[route];
}

const ROUTE_LABEL: Record<Route, string> = {
	seq: "序列",
	title: "岗位",
	org: "部门或公司",
	description: "简历原文",
	skill: "技能",
	// 做过的事那一类，说法本身已经是「从零搭建 · 推荐系统」，不再另起类型名
	did: "",
};

/** 一条命中的来源怎么显示——证据行、时间线、命令行用的是同一个词。 */
export function routeLabel(route: Route) {
	return ROUTE_LABEL[route];
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
