/**
 * 查询理解模型的唯一调用点。**薄到没有逻辑**——形状与收窄在
 * `#/search/intent`，那一半是纯函数、有测试；这里只负责「把话发出去、
 * 把 JSON 拿回来」。
 *
 * 三条硬约束：
 *
 * 1. **发出去的只有两样东西**：用户自己敲的那句话，以及语料里几维筛选的取值
 *    （公司档、职级、招聘渠道、学历）。姓名、工号、任何一个人的经历都不出这台
 *    机器。因此查询理解可以直接使用公网端点；重排必须发送候选经历，端点位置
 *    需要由部署方的数据政策决定。
 * 2. **没配就当没有。** 端点或模型名缺失时自动退回本地规则解析；API key
 *    只在端点需要鉴权时配置。
 * 3. **不抛。** 超时、限流、模型抽风、返回一坨不是 JSON 的东西，一律返回 null
 *    交给上层降级。降级之后检索照常可用，只是语气（「最好」「不要」）没人翻译。
 *    这一条的份量来自它站在结果的关键路径上：工作台虽然已经打开，名单仍要等
 *    它回来才成立。一次抛出不能让界面把服务故障误报成「没有这样的人」。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { intentSchema, type Vocabulary } from "#/search/intent";
import type { SearchDelta } from "#/search/spec";
import { unsupportedOf } from "#/search/spec";

/**
 * OpenAI 兼容端点。用兼容层而不是绑某一家的 SDK：换模型（公网 provider、
 * 公司内网关、本地部署）只改环境变量，这个文件一行不动。
 */
const BASE_URL = process.env.LLM_BASE_URL;
const API_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL;

/**
 * 端点支不支持 `response_format: json_schema`。
 *
 * 兼容层默认**关**这个开关，关着的时候它只发 `{"type":"json_object"}`——schema
 * 根本没出门，模型全靠 prompt 自觉，字段名和取值一走样就整条降级。所以这里默认
 * 打开；碰上老网关不认 json_schema，把 `LLM_STRUCTURED_OUTPUTS=false` 设上即可。
 * 两种情况都不会坏事：不支持时请求报错，照样退回规则解析。
 */
const STRUCTURED = process.env.LLM_STRUCTURED_OUTPUTS !== "false";

/** 正整数环境变量。缺失、空、非法一律用默认值——配错一个数不该让整条降级。 */
function intEnv(name: string, fallback: number) {
	const n = Number(process.env[name]);
	return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * 超时与输出预算。这两个值描述的是**端点后面那个模型有多慢、多啰嗦**，
 * 和 base URL、模型名一样属于端点配置，不是产品常量——这个文件不该知道
 * 对面是谁。
 *
 * 输出预算按「思考轨迹也算输出」来给：推理模型在吐出第一个字符之前先烧掉
 * 几百到上千 token，那部分同样计入 `max_tokens`。给小了它在思考阶段就撞上限，
 * 返回 `finish_reason: "length"` 加一个**空 content**——不报错，安静地什么都
 * 没有，只有 `usage` 说得出为什么（见下面那条 warn）。
 *
 * 超时同理：同一个模型单次可以从几秒跳到几十秒，该给多少只有部署那一侧知道。
 * 两个默认值都取宽，让「配上端点就能用」先成立。
 */
const TIMEOUT_MS = intEnv("LLM_TIMEOUT_MS", 60_000);
const MAX_OUTPUT_TOKENS = intEnv("LLM_MAX_OUTPUT_TOKENS", 8_000);

// provider 延迟到首次使用时创建，未配置模型的进程可以安全导入本模块。
let model: ReturnType<ReturnType<typeof createOpenAICompatible>> | null = null;
function getModel() {
	if (!model && BASE_URL && MODEL) {
		const provider = createOpenAICompatible({
			name: "talent-llm",
			baseURL: BASE_URL,
			supportsStructuredOutputs: STRUCTURED,
			...(API_KEY && { apiKey: API_KEY }),
		});
		model = provider(MODEL);
	}
	return model;
}

/**
 * 判断进提示词，度量衡进代码。这里写的全是**逐查询的判断**：一个片段是要求、
 * 是筛选还是不支持，哪种语气是哪档强度。相似多少算命中、太宽算多宽、
 * 各路证据值多少分，一个数字都不在这里——它们住在 weights.ts。
 */
const SYSTEM = `你在把 HR 的一句大白话翻译成人才库的检索条件。

库里存的是每个人的经历段：公司内的任职（序列、岗位、部门、职级）和入职前的
工作经历（公司、岗位、简历描述）。检索按**语义**匹配：每条要求和每段经历的原文
由模型判定是不是一回事——所以「算法」自己就能找到岗位写着「推荐算法工程师」
的人，你不必替库补同义词。但模型判定的是「同一件事」，不是「相关领域」：
「深度学习」找不到只写着「算法」的人，所以尽量用库里岗位或序列会用的说法，
不要为了扩大召回补同义词，语义匹配本身负责这件事。

你的工作是**路由**：句子里的每个片段只能去三个地方之一。

一、terms（语义要求）——「做过什么」：方向、领域、技能、职责。
- 每条写成库里岗位或序列会用的说法，两到十二个字：「渠道运营」「支付风控」
  「团队管理」，不要写成「做过渠道运营的人」。缩写展开成全称（BD → 商务拓展，
  PM 按上下文写成产品经理或项目经理）。
- 一句话里的不同条件拆成不同的条目，不要合并成一个长短语。
- 用户明确说「或」「均可」「都行」的并列选项放进同一条的 alts——它们满足其一
  即可，拆成两条就变成了都要。没有明确并列就填 null。
- 强度按语气判断：默认 must；「最好」「优先」「加分」是 boost；
  「不要」「排除」「没做过」是 exclude——exclude 的意思是这类经历不作为证据，
  不是把沾过的人拉黑。
- 只有功能词的片段**不能单独成条**：「经理」「负责人」「总监」「运营」「技术」
  「管理」单独出现时几乎不筛人。要么把它并进相邻的领域词（「算法团队负责人」
  而不是「算法」+「负责人」），要么按下面的规则送去 level；实在无处可去就放进
  unsupported 让用户补充。
- 句式词（帮我找、有没有、的人、经验、背景）不是要求，丢掉。

二、结构化范围——「是谁、在哪、多久、什么级别」。有字段就走对应字段，
**专有名词永远不进 terms**：公司名、学校名在向量空间里和同类名字是邻居，
语义匹配会把竞品全捞进来。
- kind：internal 是当前公司的内部任职；external 是加入当前公司之前的外部工作经历。
  「入职前」「外部经历」只能填 external，「公司内」「内部任职」只能填 internal。
- minMonths：「三年以上」「至少两年」→ 单段最短月数。
- companyTag：「大厂」「外企」这类公司档，只能从给定取值里选。
- level：只接受用户明确说出的一个精确当前职级，且只能从给定取值里选。
  「P7 以上 / 以下」是范围，当前结构不能准确表示，整段放进 unsupported；
  「高级」「资深」「总监」对不上唯一取值时也放进 unsupported，不要硬凑。
- recruitment：「校招进来的」「社招」，只能从给定取值里选。
- education：「硕士」「博士」，只能从给定取值里选。
- org：用户点名的公司或部门，原样照抄（「待过字节」「在增长中心干过」）。
- school：用户点名的学校，原样照抄。
- 只在句子里明确说了的时候才填，否则一律 null。不要从要求去推断筛选。

三、unsupported——库里没有这一维的条件：地点、年龄、性别、行业、性质、
「像某某一样」、对不上取值的职级。**原样照抄到这里**，绝不折进 terms：折进去
会让描述里提到过那个词的段被无声捞进来，而用户以为条件生效了。`;

/**
 * 纠正理解的上下文：上一版对这句话的完整理解，以及用户的纠正说明。范围条件
 * 也必须带上，否则「P7 被理解成岗位词」这类路由错误没有可供模型修正的旧结果。
 * 两样都来自用户自己的输入和它的派生物，不会多发送个人数据。
 */
export type Correction = { previous: SearchDelta; note: string };

function listed(what: string, values: readonly string[]) {
	return `${what}的可选取值：${values.join("、") || "（无）"}`;
}

/**
 * 一句话 → 模型给出的原始对象。调用方必须再过一遍 `toDelta` 收窄。
 *
 * 返回 null 表示「这次用不了模型」，不区分是没配置还是失败——对调用方来说
 * 两者要做的事完全一样（退回规则解析），区分只会多一个没人用的分支。
 *
 * 带 `correction` 时是**纠正理解**：同一句话重来一遍没有意义（温度为 0，
 * 重跑就是重掷一枚灌了铅的骰子），有意义的是把用户指出的差错交给模型。
 * 输出仍然是这句话的**完整**理解，不是只翻译那句纠正——纠正是修改意见，
 * 不是新查询。
 */
export async function understand(
	text: string,
	vocab: Vocabulary,
	correction?: Correction,
): Promise<unknown | null> {
	const m = getModel();
	if (!m) return null;
	// 上一版按模型的输出字段还原，不把内部的 evidence/scope/notices 名字泄漏进提示词。
	const corrected = correction
		? `\n\n上一次对这句话的理解（字段含义与你的输出相同）：${JSON.stringify({
				terms: correction.previous.evidence.map((item) => ({
					term: item.term,
					mode: item.mode,
					alts: item.alts ?? null,
				})),
				kind: correction.previous.scope.kind ?? null,
				minMonths: correction.previous.scope.minMonths ?? null,
				companyTag: correction.previous.scope.companyTag ?? null,
				level: correction.previous.scope.level ?? null,
				recruitment: correction.previous.scope.recruitment ?? null,
				education: correction.previous.scope.education ?? null,
				org: correction.previous.scope.org ?? null,
				school: correction.previous.scope.school ?? null,
				unsupported: unsupportedOf(correction.previous),
			})}` +
			`\n用户指出理解得不对，补充说：${correction.note}` +
			"\n请据此重新给出这句话的完整理解，不要只翻译补充说明本身。"
		: "";
	try {
		const { output } = await generateText({
			model: m,
			output: Output.object({ schema: intentSchema(vocab) }),
			system: SYSTEM,
			prompt: [
				listed("companyTag", vocab.companyTags),
				listed("level", vocab.levels),
				listed("recruitment", vocab.recruitments),
				listed("education", vocab.educations),
				`\n这句话：${text}${corrected}`,
			].join("\n"),
			// 这是一次翻译，不是创作：要的是同一句话每次给同一组条件
			temperature: 0,
			maxRetries: 1,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			timeout: TIMEOUT_MS,
		});
		return output;
	} catch (e) {
		/*
		 * 降级是正常路径的一部分，但不该静默：查不出「今天模型一直在超时」
		 * 会让人以为是解析变笨了。
		 *
		 * 光打异常不够。结构化输出失败时真正说明问题的是 `usage` 和
		 * `finishReason`——`finishReason: "length"` 配上 `reasoningTokens`
		 * 吃掉几乎整个 `outputTokens`，一眼就是「预算被思考轨迹烧光」，
		 * 而异常本身只会说「没有生成对象」。AI SDK 把这些挂在
		 * `NoObjectGeneratedError` 上。
		 */
		if (NoObjectGeneratedError.isInstance(e))
			console.warn("[llm] 查询理解失败，退回规则解析：模型没有给出合法对象", {
				finishReason: e.finishReason,
				usage: e.usage,
				// 截断：这是模型原样的输出，只用来判断「它到底说了什么」
				text: e.text?.slice(0, 200),
				cause: e.cause,
			});
		else console.warn("[llm] 查询理解失败，退回规则解析：", e);
		return null;
	}
}
