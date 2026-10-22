/**
 * 读取入职前经历中能拿来找人的能力，以及这个人在每一项上投入多深；自述证据只来自这份抽取。
 * 模型负责领域判断，schema 校验回答形状，conform 按领域规则过滤单条说法。
 * 未调用、未能作答与成功抽取分别返回，成功的空抽取也是已读结果。
 */

import { z } from "zod";
import { ENGAGEMENTS, type Engagement, isEngagement } from "#/lib/engagement";
import { complete, extractModel, standardOf } from "#/server/chat";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";
import { MAX_TAG_LEN, tag } from "./tag";

/**
 * 一段最多几项。这是防模型逐句复述描述的上限，不是取舍：正常回答远低于它，
 * 哪些该写由提示词决定。
 */
const MAX_ITEMS = 30;

/** 一段经历抽出来的能力。词是说法；投入档存在边上，模型没给出合法档时是 null。 */
export type Extraction = {
	items: { text: string; engagement: Engagement | null }[];
};

export type ExtractionResult =
	| { status: "skipped" }
	| { status: "failed" }
	| { status: "done"; value: Extraction };

export const SYSTEM = `你在帮 HR 整理员工入职前的工作经历。HR 会按能力找人，比如「找做过跨境支付风控的人」，所以要把每段经历里能拿来找人的能力列出来，并说明这个人在每一项上投入有多深。

下面会给你一段经历的岗位、公司和描述。回答 items，每项是一个词和它的档。

词：这个人在这段经历里用到的技能、工具、方法或业务方向。写成简短的名词，一般不超过八个字，就是招聘 JD 里「熟悉___」「有___经验」那一空会填的词。
- 原文提到的都写上，不要只挑几个；一句话里有几项就拆成几个词，一串工具或技术就一个一个写。
- 只写这个人自己做的，不写团队或公司的。
- 留着说明业务类型的词：写「跨境支付风控」，不要简化成「风控」；写「售后客服」，不要简化成「客服」。
- 去掉动作：「从 0 到 1 搭建数据平台」写「数据平台」，「营销方案制定」写「营销方案」。
- 同一项能力只写一次，用最常见的那个说法：写了「用户增长」，就不再写「用户和订单增长」「用户增长路径」。

这些不是能力，不要写：
- 目标、指标和结果：年度销售目标、GMV 目标、核心指标、业绩完成情况、投放效率、软件性能。原文说「提升转化率」，能力是「转化率优化」，不是「转化率」。
- 顺带产出的日常材料和经手的数据：周报、月报、订单数据、会议纪要。做出它本身就是一门手艺的照写，比如「销售报表」「授信报告」「策划案」「讲义」。
- 谁都会做的泛泛动作：需求澄清、方案制定、目标制定、问题诊断、报告编写、项目推进、重要事项，以及沟通、协作、协调。
- 只交代场景的名词：三甲医院、手游、汽车零部件、微信公众号。也不要把它们加到别的词前面：「汽车零部件的采购谈判」写「采购谈判」，「注塑车间的来料检验」写「来料检验」。
- 公司名、产品名、项目名、活动名和内部业务线的名字，只写它背后的业务，比如「某某商城」写「电商运营」。

档：看原文里直接说这一项的那句话，这个人自己对它做了什么，三档选一：
- 主导：这一项的结果归他。原文说负责、主导、牵头、从零搭建，或带人做。
- 做过：他亲手做了其中的活。原文说开发、实现、用它做事、执行、维护，或参与、协助、配合。
- 提到：只说会、熟悉、了解、掌握，或只列在技术栈里，没说用它做了什么。
开头一句「负责某某」只决定某某本身；后面分点列出的工作，各按那一点自己的说法定档。拿不准就是做过。

只根据原文，没写的不要补。没有可写的就给空列表。

例子：

岗位：数据工程师
公司：某电商
描述：负责搭建公司数据仓库，用 Spark、Hive 开发 ETL 任务，每周输出数据质量周报，配合算法团队优化推荐效果，支撑年度 GMV 目标。熟悉 Flink。

回答：
{"items": [{"text": "数据仓库", "depth": "主导"}, {"text": "ETL", "depth": "做过"}, {"text": "Spark", "depth": "做过"}, {"text": "Hive", "depth": "做过"}, {"text": "数据质量", "depth": "做过"}, {"text": "推荐算法优化", "depth": "做过"}, {"text": "Flink", "depth": "提到"}]}`;

/** 回答形状；取值规则由 conform 校验。 */
const SCHEMA = z.object({
	items: z.array(z.object({ text: z.string(), depth: z.string() })),
});

/** 送给模型的那段话。它也是缓存的键：同一段话永远得到同一份抽取。 */
export function promptInput(row: {
	title: string;
	company: string;
	description: string;
}): string {
	return `岗位：${row.title}\n公司：${row.company}\n描述：${row.description}`;
}

function keep(word: string, company: string): boolean {
	// 公司名不进说法：专有名词在向量空间里和同类名字是邻居。描述里也会写公司名，
	// 抽出的词含这段的公司名或被它包含的都丢掉。
	if (!word || [...word].length > MAX_TAG_LEN) return false;
	return !(company && (word.includes(company) || company.includes(word)));
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
export function conform(raw: unknown, company: string): Extraction {
	const found: Extraction["items"] = [];
	// 只认数组：字符串也可迭代，"Python" 会被拆成六个单字标签
	for (const item of items(field(raw, "items"))) {
		if (found.length === MAX_ITEMS) break;
		const text = tag(field(item, "text"));
		if (!keep(text, company)) continue;
		// 回答里这一项叫 depth：给模型看的是「投入多深」
		const said = tag(field(item, "depth"));
		const engagement = isEngagement(said) ? said : null;
		// 边的主键是（段、路、说法）：同一个词只留一条，档取最深的那次
		const seen = found.find((one) => one.text === text);
		if (!seen) found.push({ text, engagement });
		else if (
			engagement &&
			(!seen.engagement || deeper(engagement, seen.engagement))
		)
			seen.engagement = engagement;
	}
	return { items: found };
}

function deeper(a: Engagement, b: Engagement): boolean {
	return ENGAGEMENTS.indexOf(a) < ENGAGEMENTS.indexOf(b);
}

/** 抽取标准，只由提示词和回答形状决定，不随执行模型变化。 */
export function extractIdentity(): string {
	return standardOf(SYSTEM, SCHEMA);
}

/** 按入参顺序返回调用状态与抽取；验收和解析共用此入口。 */
export async function extract(
	rows: Pick<
		ExperienceRow,
		"kind" | "unemployed" | "title" | "company" | "description"
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
		return { status: "done", value: conform(payloads.get(text), row.company) };
	});
}
