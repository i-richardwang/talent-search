/**
 * 一段经历有哪些说法。
 *
 * **拼法只有这一份。** 查询侧嵌的是用户的说法（「渠道运营」），语料侧嵌的是
 * 这里拼出来的字符串，两边比的必须是同一种字符串；派生（`derive.ts`）和造语料的
 * 测试夹具（`tests/fixture.ts`）都 import 这个函数，于是「两处拼得不一样」这件事
 * 没有发生的余地，也就不需要任何东西去核对它。
 *
 * 登记的三路，原文原样：
 *
 * - `seq`：序列三级，用「 · 」连（「技术 · 算法 · 推荐」）；
 * - `title`：岗位名，原样；
 * - `org`：公司内是完整部门路径（「示例科技/技术中心/平台技术部」），入职前
 *   是公司名。
 *
 * 序列和岗位各嵌各的，不拼成一串：短文本的相似度最锐利，「算法」对「算法工程师」
 * 是一回事，对「技术 · 算法 · 推荐 / 高级算法工程师」这一长串就被稀释了。
 *
 * 自述只有**一种读法**。模型读过这一段（`extract.ts`），自述证据就是它读出来的
 * 能力词（`skill`）和做过的事（`did`），整段原文不再作为说法——整段原文分不清
 * 主语和重点，「配合算法团队完成上线」会和「算法」相近，抽取就是为了挡住它，
 * 再让原文并行投票等于白抽。没读过的段（抽取没配、这一段模型没作答）才把整段
 * 原文当说法（`description`）。原文照样存在经历行上供核对，只是不参与匹配。
 *
 * 哪一路为空就没有那一路：不嵌空串，也不存零向量。
 */

import type { Route } from "#/db/schema";
import type { Extraction } from "./extract";

/** 拼说法要读经历段上的哪几个字段。 */
export type RouteSource = {
	kind: "internal" | "external";
	org: string;
	orgPath: string;
	title: string;
	seqL1: string;
	seqL2: string;
	seqL3: string;
	description: string;
};

/** 一条说法与它落在哪一路。参与方式只有做过的事那一路带。 */
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
