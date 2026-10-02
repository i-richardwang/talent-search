/**
 * 读取入职前经历中的能力词和做过的事；自述证据只来自这份穷尽抽取。
 * 模型负责领域判断，schema 校验回答形状，conform 按领域规则过滤单条说法。
 * 未调用、未能作答与成功抽取分别返回，成功的空抽取也是已读结果。
 */

import { z } from "zod";
import {
	INVOLVEMENT_GUIDE,
	type Involvement,
	isInvolvement,
} from "#/lib/involvement";
import { complete, extractModel, identityOf } from "#/server/chat";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import { MAX_TAG_LEN, tag } from "./tag";

/** 一段最多几条能力词、几件事。多于此数的段几乎总是模型在逐句复述描述。 */
const MAX_SKILLS = 12;
const MAX_DID = 8;

/**
 * 一段经历抽出来的东西。`did` 的每一项是（参与方式，领域）：领域是说法，
 * 参与方式存在边上，模型判断不出时是空。
 */
export type Extraction = {
	skills: string[];
	did: { involvement: Involvement | null; domain: string }[];
};

export type ExtractionResult =
	| { status: "skipped" }
	| { status: "failed" }
	| { status: "done"; value: Extraction };

const EMPTY: Extraction = { skills: [], did: [] };

export const SYSTEM = `## 背景

这是一家公司内部的人才库。招聘的人手里有一个岗位，要从几千名在职员工里找出入职前就做过相关工作的人。他们的用法是：在筛选栏里点一个能力词，看有这项能力的人，再读每个人简历里的原话确认。所以每一个能力词都是一个将来会被点的筛选项，它的好坏只有一个标准：**招聘的人会不会拿这个词来找人。**

招聘的人要的粗细每次都不一样：招销售分析师的人要「销售数据分析」，招通用分析师的人要「数据分析」。系统会把细的词自动归到宽的词下面，所以你只需要写最细的那一档；反过来，你写宽了，细的那一档就永远找不到了。

两种错的代价不一样：漏写一个词，这个人在那个筛选项下就不存在，搜索也找不到他——你写的词就是这段经历在搜索里的全部自述证据，原文不再参与匹配；多写一个没人会点的词，只是筛选栏多一个没用的选项，后面还能清掉。所以这段经历里每一项能拿来找人的能力都要写到，拿不准的写上；工具、技术、方法一长串列出来的，一个一个写，不合并、不挑。

## 任务

读一段员工入职前的工作经历（岗位、公司、描述），标出两类短说法：能力词（skills）和做过的事（did）。只根据给出的文字，不补充、不推断没有写的事。

## 能力词

能力词是这个人在这段经历里实际用到或负责的技能、工具、方法或业务领域，写成招聘要求里「熟悉 ___」「有 ___ 经验」能填进去的名词，一般不超过八个字。判断一个词写不写、怎么写，用下面四条：

1. **是本人做的。** 主语是别人或团队的（「配合算法团队」「公司拥有……」）不算这个人的能力。
2. **招聘的人会拿它来找人。** 任何岗位都会写的通用协作（跨部门协作、多方协调、沟通）和自评（责任心强）不是筛选项；一次性的具体事（准备发布会物料、协调客户提车上牌）也不是，它属于 did，能力词是这件事用到的技能或所在的业务领域。
3. **写最细的那一档业务通名。** 说明是哪一种业务的限定留着，因为招聘的人可能就要这一种：「跨境支付风控」不写成「风控」，「售后客服团队管理」不写成「客服团队管理」，「配送员管理」不写成「人员管理」。
4. **只留领域本身。** 去掉动作、程度词、项目名、公司名、产品名、级别和年限：「推荐专项需求核心开发」写「推荐系统」，「从 0 到 1 打造数据平台」写「数据平台」。动作也不挂在词尾：「营销方案制定」写「营销方案」，「培训体系搭建」写「培训体系」。

一段话里同一项能力只写一次；一句描述里有几项能力就拆成几个词；岗位名本身不是能力词；没有可写的就给空数组。

## 做过的事

did 是这个人在这段经历里做过的具体事，每件写成一种参与方式加一个领域。
- involvement 只能取以下五种之一：${Object.entries(INVOLVEMENT_GUIDE)
	.map(([name, guide]) => `${name}（${guide}）`)
	.join("；")}。
- domain 是这件事的对象的通名，例如「推荐系统」「支付成功率」「数据平台」；不带公司名、产品名和「核心」「专项」「国际」这类修饰，动作已经在 involvement 里，不再写进 domain。
- 判断不出参与方式就把 involvement 写成空字符串，不要硬选。
- 没有具体的事就给空数组。`;

/** 回答形状；取值规则由 conform 校验。 */
const SCHEMA = z.object({
	skills: z.array(z.string()),
	did: z.array(z.object({ involvement: z.string(), domain: z.string() })),
});

/** 送给模型的那段话。它也是缓存的键：同一段话永远得到同一份抽取。 */
export function promptInput(row: {
	title: string;
	org: string;
	description: string;
}): string {
	return `岗位：${row.title}\n公司：${row.org}\n描述：${row.description}`;
}

function keep(word: string, org: string): boolean {
	// 公司名永远不进向量：专有名词在向量空间里和同类名字是邻居。模型偶尔会把
	// 公司名当领域返回，这里按原文的公司名再过滤一遍。
	if (!word || [...word].length > MAX_TAG_LEN) return false;
	return !(org && (word.includes(org) || org.includes(word)));
}

function items(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function field(value: unknown, name: string): unknown {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)[name]
		: undefined;
}

/** 校验模型的原话，得到一份合法的抽取。不合规的只丢单条，不丢整段。 */
export function conform(raw: unknown, org: string): Extraction {
	if (typeof raw !== "object" || raw === null) return EMPTY;
	const skills: string[] = [];
	// 只认数组：字符串也可迭代，"Python" 会被拆成六个单字标签
	for (const item of items(field(raw, "skills"))) {
		if (skills.length === MAX_SKILLS) break;
		const skill = tag(item);
		if (keep(skill, org) && !skills.includes(skill)) skills.push(skill);
	}
	const did: Extraction["did"] = [];
	// 一段对同一个领域只留第一条：边的主键是（段、路、说法），领域就是说法
	for (const item of items(field(raw, "did"))) {
		if (did.length === MAX_DID) break;
		const involvement = tag(field(item, "involvement"));
		const domain = tag(field(item, "domain"));
		if (keep(domain, org) && !did.some((d) => d.domain === domain))
			did.push({
				involvement: isInvolvement(involvement) ? involvement : null,
				domain,
			});
	}
	return { skills, did };
}

/** 抽取这一步的身份：模型、提示词、schema。派生版本的一部分。 */
export function extractIdentity(): string {
	return identityOf(extractModel(), SYSTEM, SCHEMA);
}

/** 按入参顺序返回调用状态与抽取；验收和派生共用此入口。 */
export async function extract(
	rows: Pick<
		ExperienceRow,
		"kind" | "unemployed" | "title" | "org" | "description"
	>[],
	report: Report,
): Promise<ExtractionResult[]> {
	const asked = rows.map((row) =>
		row.kind === "external" && !row.unemployed && row.description
			? promptInput(row)
			: null,
	);
	const payloads = await complete(
		extractModel(),
		SYSTEM,
		SCHEMA,
		asked.filter((text): text is string => text !== null),
		"抽取",
		report,
	);
	return rows.map((row, index) => {
		const text = asked[index];
		if (text == null) return { status: "skipped" };
		if (!payloads.has(text)) return { status: "failed" };
		return { status: "done", value: conform(payloads.get(text), row.org) };
	});
}
