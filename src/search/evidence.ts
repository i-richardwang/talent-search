/**
 * 证据的来源与展示选择；排名与界面共用同一份说法。
 */
import type { Claim } from "#/search/query";
import type { Evidence } from "#/search/result";
import type { Route } from "#/search/weights";

const ROUTE_LABEL: Record<Route, string> = {
	role: "任职记录",
	title: "岗位",
	description: "简历原文",
	skill: "技能",
};

/** 一段证据的来源怎么显示——证据行、时间线、命令行用的是同一个词。 */
export function routeLabel(route: Route) {
	return ROUTE_LABEL[route];
}

/**
 * 每条主张取展示列表中的第一段证据。`evidence` 已按主张顺序、投入、单段时长排好。
 *
 * AND 语义下每条必须的主张必有证据（rank.ts 的 complete）；加分的可以没有，
 * 所以返回值保留 `undefined`，调用方按未命中渲染。
 */
export function bestEvidencePerClaim(
	evidence: Evidence[],
	claims: readonly Claim[],
) {
	return claims.map((_, i) => evidence.find((e) => e.claim === i));
}
