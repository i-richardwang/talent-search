/**
 * 一段经历有哪些说法：每一条都在说这个人自己做过什么。
 *
 * 解析与测试夹具共用这份组合方式；每条说法独立嵌入，判断相关度时整条读。
 *
 * - `role`：公司内的一段任职一条，序列和岗位连成一句（「技术 · 研发 · 后端｜高级工程师」）：
 *   岗位名常常太空，有了序列才说得清做的是哪一行。部门只回答「在哪」，由按名字找的
 *   条件使用，不进这里：部门做什么不等于这个人做什么，而重排模型读到部门名时，
 *   既会把坐在推荐算法组的后端判成做推荐算法，又会因为一长串路径压低对得上的分数。
 * - `title`：入职前的岗位名，原样。入职前的公司名只回答「在哪」，由按名字找的条件
 *   使用，不进这里。
 * - 自述每段只有一种来源：已读段取抽出的能力词（`skill`）和做过的事（`did`），
 *   未读段取原文（`description`）。原文始终保留在经历行上供核对。
 *   模型失败的段不提交解析结果，保留上一份状态等待重试。
 *
 * 哪一类为空就没有那一类：不嵌空串，也不存零向量。
 */

import type { Route } from "#/db/schema";
import type { Extraction } from "./extract";

export type RouteSource = {
	kind: "internal" | "external";
	unemployed: boolean;
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

/** 公司内一段任职的一句：序列三级和岗位名，缺的那样不写。 */
function roleText(s: RouteSource): string {
	return [[s.seqL1, s.seqL2, s.seqL3].filter(Boolean).join(" · "), s.title]
		.filter(Boolean)
		.join(ROLE_SEPARATOR);
}

const SAMPLE: RouteSource = {
	kind: "internal",
	unemployed: false,
	title: "岗位",
	seqL1: "一级",
	seqL2: "二级",
	seqL3: "三级",
	description: "原文",
};

/**
 * 组合方式的身份，进解析版本（`derive.ts` 的 `identity`）：几段写满各项的样例经历走一遍
 * 组合方式，得到的说法就是身份。组合方式一变，这串字跟着变，所有段按新组合方式重新解析。
 */
export const PHRASING = JSON.stringify(
	[
		SAMPLE,
		{ ...SAMPLE, seqL3: "" },
		{ ...SAMPLE, kind: "external" as const },
	].flatMap((s) => [
		phrasesOf(s, null),
		phrasesOf(s, {
			skills: ["能力"],
			did: [{ involvement: "负责建设", domain: "领域" }],
		}),
	]),
);
