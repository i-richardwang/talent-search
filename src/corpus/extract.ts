/**
 * 入职前经历 → 能力词与做过的事。
 *
 * 原文四路里只有简历描述是自由文本，而它整段池化成一个向量分不清主语和重点：
 * 「配合算法团队完成上线」会和「算法」相近，主语却是别人。这里让模型把一段
 * 描述读成两类**短说法**，每条说法和原文四路一样存进 `phrase`、指回这一段
 * （`experience_phrase` 的 `skill` / `did` 两路），检索链路对它们一视同仁：
 * 向量召回、重排判定、按路权重打分。它们的来源仍是自述，所以强度和
 * `description` 同档（`src/search/weights.ts`）。
 *
 * **判断进提示词，阈值进代码**：什么算能力词、哪种语气是哪种参与方式，是逐段的
 * 判断，写在下面的提示词里，可以大改（缓存按提示词键入，改了旧抽取自然失效）；
 * 一条说法最长几个字、一段最多几条、参与方式只认哪几种，是全站的阈值，写在
 * `conform` 里，改了不必换 id——缓存里存的是模型的原话（`src/server/chat.ts`），
 * `conform` 每次派生都重新收窄一遍。
 *
 * **模型输出是不可信输入。** schema 里不写枚举、不写长度上限：写了，模型多给
 * 一个字整条响应就作废，而收窄只会丢掉那一条（AGENTS.md「限制只写在收窄的
 * 地方」）。参与方式不在枚举里的那一件事留下领域、参与方式记空——它只是证据行上
 * 的标签，不参与检索（为什么不进向量见 `src/db/schema.ts` 的 `involvement` 列）。
 *
 * 只对入职前、有描述的段调用；公司内任职段没有自由文本，抽不出东西也不该去问。
 */

import { z } from "zod";
import { complete, extractModel, identityOf } from "#/server/chat";
import type { ExperienceRow } from "./pipeline";
import type { Report } from "./report";

/**
 * 一条说法最长几个字。能力词和领域都是短名词；超过这个数的通常是模型把
 * 半句话原样抄了下来，那不是标签，是另一段原文。
 */
const MAX_TAG_LEN = 16;
/** 一段最多几条能力词、几件事。多于此数的段几乎总是模型在逐句复述描述。 */
const MAX_SKILLS = 12;
const MAX_DID = 8;

/**
 * 一段经历抽出来的东西。`did` 的每一项是（参与方式，领域）：领域是说法，
 * 参与方式落在边上，模型判断不出时是空。
 */
export type Extraction = {
	skills: string[];
	did: { involvement: string | null; domain: string }[];
};

export const EMPTY: Extraction = { skills: [], did: [] };

/**
 * 参与方式的几种取值与每种对应的语气。这是「做过的事」唯一的枚举，只写在
 * 这里：提示词从这里生成给模型，`conform` 用它收窄，库里那一列不设约束。
 */
const INVOLVEMENT_GUIDE: Record<string, string> = {
	从零搭建: "从无到有做出来的",
	负责建设: "主责、主导、负责的",
	优化改进: "提升、改造、迭代已有东西的",
	参与执行: "参与、协助、配合、支持的",
	带队管理: "带团队、管理人的",
};
const INVOLVEMENTS = Object.keys(INVOLVEMENT_GUIDE);

export const SYSTEM = `你在读一段员工入职前的工作经历，把它整理成人才库能检索的两类短说法。只根据给出的文字，不补充、不推断没有写的事。

输出 JSON：{"skills": ["..."], "did": [{"involvement": "...", "domain": "..."}]}

skills（能力词）：这个人在这段经历里实际用到或负责的技能、技术、方法与业务领域，写成招聘要求里会出现的那种词。
- 一个词只是一项技能、一种工具、一种方法或一个业务领域的通名，一般不超过八个字，例如「推荐算法」「Python」「支付风控」「渠道拓展」「数据仓库」。
- 去掉动作、修饰语和项目名，只留领域本身：「国际风控系统搭建」写「风控」，「推荐专项需求核心开发」写「推荐系统」，「从 0 到 1 打造数据平台」写「数据平台」。
- 一段话里同一项能力只写一次；一句描述里有几项能力就拆成几个词。
- 只写本人做的事。主语是别人或团队的（「配合算法团队」「公司拥有……」）不算这个人的能力。
- 不写：公司名、产品名、学校名；年限、职级、「高级」「资深」这类级别词；「沟通能力强」「责任心」这类自评；岗位名本身；「搭建」「优化」「提升」「推进」「落地」这类动作。
- 没有可写的就给空数组。

did（做过的事）：这个人在这段经历里做过的具体事，每件写成一种参与方式加一个领域。
- involvement 只能取以下五种之一：${Object.entries(INVOLVEMENT_GUIDE)
	.map(([name, guide]) => `${name}（${guide}）`)
	.join("；")}。
- domain 是这件事的对象的通名，例如「推荐系统」「支付成功率」「数据平台」；不带公司名、产品名和「核心」「专项」「国际」这类修饰，动作已经在 involvement 里，不再写进 domain。
- 判断不出参与方式就把 involvement 写成空字符串，不要硬选。
- 没有具体的事就给空数组。`;

/**
 * schema 只描述形状，不描述取值：枚举和长度上限一律留给 `conform`。
 * 结构化输出是「整条响应要么合法要么作废」的，写进去等于让模型多说一个字就
 * 丢掉一整段。
 */
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

/** 一条说法的规范写法：NFKC 折叠全半角，压掉多余空白。 */
export function tag(value: unknown): string {
	if (typeof value !== "string") return "";
	return value
		.normalize("NFKC")
		.replace(/\s+/g, " ")
		.replace(/^[ ·,，;；]+|[ ·,，;；]+$/g, "");
}

function keep(word: string, org: string): boolean {
	// 公司名永远不进向量：专有名词在向量空间里和同类名字是邻居。模型偶尔会把
	// 公司名当领域吐回来，这里按原文的公司名兜一道。
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

/** 把模型的原话收窄成一份合法的抽取。收窄只丢单条，不丢整段。 */
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
				involvement: INVOLVEMENTS.includes(involvement) ? involvement : null,
				domain,
			});
	}
	return { skills, did };
}

/** 抽取这一步的身份：模型、提示词、schema。派生版本的一部分。 */
export function extractIdentity(): string {
	return identityOf(extractModel(), SYSTEM, SCHEMA);
}

/**
 * 按入参顺序返回每段的抽取。只有入职前且有描述的段会去问端点。
 */
export async function extract(
	rows: ExperienceRow[],
	report: Report,
): Promise<Extraction[]> {
	const asked = rows.map((row) =>
		row.kind === "external" && row.description ? promptInput(row) : null,
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
		if (text === null || text === undefined || !payloads.has(text))
			return EMPTY;
		return conform(payloads.get(text), row.org);
	});
}
