/**
 * 证据的来源与展示选择；排名与界面共用同一份说法。
 */
import type { Claim, Hit } from "#/search/result";
import type { Route } from "#/search/weights";

const ROUTE_LABEL: Record<Route, string> = {
	role: "任职记录",
	title: "岗位",
	description: "简历原文",
	skill: "技能",
	// 做过的事那一类，说法已经是「从零搭建 · 推荐系统」，不再另起类型名
	did: "",
};

/** 一条命中的来源怎么显示——证据行、时间线、命令行用的是同一个词。 */
export function routeLabel(route: Route) {
	return ROUTE_LABEL[route];
}

/**
 * 每条主张取展示列表中的第一条命中。hits 已按主张顺序、相关度、单段时长排好。
 *
 * AND 语义下每条必须的主张必有命中（rank.ts 的 complete）；加分的可以没有，
 * 所以返回值保留 `undefined`，调用方按未命中渲染。
 */
export function bestHitPerClaim(hits: Hit[], claims: readonly Claim[]) {
	return claims.map((_, i) => hits.find((h) => h.claim === i));
}
