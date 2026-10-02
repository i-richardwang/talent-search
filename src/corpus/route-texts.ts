/**
 * 一段经历有哪些说法。
 *
 * 派生与测试夹具共用此拼法；每类说法独立嵌入。
 *
 * 登记的三类，原文原样：
 *
 * - `seq`：序列三级，用「 · 」连（「技术 · 算法 · 推荐」）；
 * - `title`：岗位名，原样；
 * - `org`：公司内是完整部门路径（「示例科技/技术中心/平台技术部」），入职前
 *   是公司名。
 *
 * 自述证据每段只有一种来源：已读段取抽出的能力词和做过的事，未读段取原文。
 * 原文始终保留在经历行上供核对。模型失败的段不提交派生，保留上一份状态等待重试。
 *
 * 哪一类为空就没有那一类：不嵌空串，也不存零向量。
 */

import type { Route } from "#/db/schema";
import type { Extraction } from "./extract";

/** 拼说法要读经历段上的哪几个字段。 */
export type RouteSource = {
	kind: "internal" | "external";
	unemployed: boolean;
	org: string;
	orgPath: string;
	title: string;
	seqL1: string;
	seqL2: string;
	seqL3: string;
	description: string;
};

/** 一条说法与它属于哪一类。参与方式只有做过的事那一类带。 */
export type Phrasing = {
	route: Route;
	text: string;
	involvement: string | null;
};

/** 这一段的全部说法。`extraction` 为 null 是「没读过」，不是「读了没读出来」。 */
export function phrasesOf(
	s: RouteSource,
	extraction: Extraction | null,
): Phrasing[] {
	if (s.unemployed) return [];
	const registered: [Route, string][] = [
		["seq", [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · ")],
		["title", s.title],
		["org", s.kind === "internal" && s.orgPath ? s.orgPath : s.org],
	];
	const claimed: Phrasing[] = extraction
		? [
				...extraction.skills.map((text) => ({
					route: "skill" as const,
					text,
					involvement: null,
				})),
				...extraction.did.map(({ domain, involvement }) => ({
					route: "did" as const,
					text: domain,
					involvement,
				})),
			]
		: [{ route: "description", text: s.description, involvement: null }];
	return [
		...registered.map(([route, text]) => ({ route, text, involvement: null })),
		...claimed,
	].filter((p) => p.text);
}
