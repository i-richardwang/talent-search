/**
 * 一段经历在原文四路上说了哪些字。
 *
 * **拼法只有这一份。** 查询侧嵌的是用户的说法（「渠道运营」），语料侧嵌的是
 * 这里拼出来的字符串，两边比的必须是同一种字符串；灌库（`load.ts`）和造语料的
 * 测试夹具（`tests/fixture.ts`）都 import 这个函数，于是「两处拼得不一样」这件事
 * 没有发生的余地，也就不需要任何东西去核对它。
 *
 * - `seq`：序列三级，用「 · 」连（「技术 · 算法 · 推荐」）；
 * - `title`：岗位名，原样；
 * - `org`：公司内是完整部门路径（「示例科技/技术中心/平台技术部」），入职前
 *   是公司名；
 * - `description`：简历描述，原样。
 *
 * 序列和岗位各嵌各的，不拼成一串：短文本的相似度最锐利，「算法」对「算法工程师」
 * 是一回事，对「技术 · 算法 · 推荐 / 高级算法工程师」这一长串就被稀释了。
 *
 * 哪一路原文为空就没有那一路：不嵌空串，也不存零向量。抽取的两路（能力词、
 * 做过的事）不在这里——它们是模型给的短说法，原样入库，没有拼法。
 */

import type { Route } from "#/db/schema";

/** 拼四路原文要读经历段上的哪几个字段。 */
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

/** 这一段的四路原文，空的那一路不出现。 */
export function routeTexts(s: RouteSource): [Route, string][] {
	const texts: Record<string, string> = {
		seq: [s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · "),
		title: s.title,
		org: s.kind === "internal" && s.orgPath ? s.orgPath : s.org,
		description: s.description,
	};
	return Object.entries(texts).filter(([, text]) => text) as [Route, string][];
}
