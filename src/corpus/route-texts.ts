/**
 * 一段经历有哪些说法：每一条都在说这个人自己做过什么。
 *
 * 派生与测试夹具共用此拼法；每条说法独立嵌入，判断相关度时整条读。
 *
 * - `role`：公司内的一段任职整句一条，序列、岗位、部门连在一起
 *   （「技术 · 研发 · 后端｜高级工程师｜示例科技/技术中心/推荐算法组」）。三样拆开读
 *   都会误判：岗位名常常太空，部门做什么不等于这个人做什么；放在一起，在推荐部做
 *   HRBP 的人和在推荐算法组写代码的人才分得开。
 * - `title`：入职前的岗位名，原样。入职前的公司名只回答「在哪」，由按名字找的条件
 *   使用，不进这里。
 * - 自述每段只有一种来源：已读段取抽出的能力词（`skill`）和做过的事（`did`），
 *   未读段取原文（`description`）。原文始终保留在经历行上供核对。
 *   模型失败的段不提交派生，保留上一份状态等待重试。
 *
 * 哪一类为空就没有那一类：不嵌空串，也不存零向量。
 */

import type { Route } from "#/db/schema";
import type { Extraction } from "./extract";

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
	const registered: Phrasing[] =
		s.kind === "internal"
			? [{ route: "role", text: roleText(s), involvement: null }]
			: [{ route: "title", text: s.title, involvement: null }];
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
	return [...registered, ...claimed].filter((p) => p.text);
}

const ROLE_SEPARATOR = "｜";

/** 公司内一段任职的整句：序列三级、岗位名、部门路径，缺的那样不写。 */
function roleText(s: RouteSource): string {
	return [
		[s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · "),
		s.title,
		s.orgPath || s.org,
	]
		.filter(Boolean)
		.join(ROLE_SEPARATOR);
}

/**
 * 这份拼法的说明，进派生版本（`derive.ts` 的 `identity`）：拼法一变，所有段按新拼法
 * 重新派生。改了上面的拼法就改这句话。
 */
export const PHRASING =
	"公司内：序列 · 三级｜岗位｜部门路径；入职前：岗位；自述：能力词与做过的事，未读为原文";
