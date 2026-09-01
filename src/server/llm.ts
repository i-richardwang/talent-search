/**
 * 唯一一处调用大模型的地方。**薄到没有逻辑**——形状与收窄在 `#/search/intent`，
 * 那一半是纯函数、有测试；这里只负责「把话发出去、把 JSON 拿回来」。
 *
 * 三条硬约束：
 *
 * 1. **发出去的只有两样东西**：用户自己敲的那句话，以及语料里的公司档取值。
 *    姓名、工号、任何一个人的经历都不出这台机器。这也正是「查询理解可以做、
 *    结果重排不做」的分界：重排必须把候选人的经历发给模型。
 * 2. **没配就当没有。** 端点或模型名缺失时自动退回本地规则解析；API key
 *    只在端点需要鉴权时配置。
 * 3. **不抛。** 超时、限流、模型抽风、返回一坨不是 JSON 的东西，一律返回 null
 *    交给上层降级。降级之后检索照常可用，只是语气（「最好」「不要」）没人翻译。
 *    这一条的份量来自它站在关键路径上：查询理解**同步挡在用户和结果之间**，
 *    人敲完那句话要等它回来才看得见结果，一次抛出就是一次白等。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { intentSchema } from "#/search/intent";

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

const SYSTEM = `你在把 HR 的一句大白话翻译成人才库的检索条件。

库里存的是每个人的经历段：公司内的任职（序列、岗位、部门）和入职前的工作经历。
检索按**概念词**逐个匹配这些字段。

规则：
- 每个概念词是一个岗位、方向或能力，两到八个字。用库里会写的说法，
  比如「渠道运营」「风控」「团队管理」，不要写成「做过渠道运营的人」。
- 一句话里的不同条件拆成不同的词，不要合并成一个长短语。
- 用户明确说「或」「均可」「都行」的并列选项放进同一条的 alts——它们满足其一
  即可，拆成两条就变成了都要。没有明确并列就填 null。
- near 是你替库补的**相近说法**：库里可能写「深度学习」「机器学习」而用户说的是
  「算法」。最多两个，宁缺毋滥——它用来放宽召回，按降档计分，给错了会把不相干
  的人抬进名单。exclude 条件的 near 一律 null：排除是否决，否决的词必须是用户
  自己说的。
- 强度按语气判断：默认 must；「最好」「优先」「加分」是 boost；
  「不要」「排除」「没做过」是 exclude——exclude 的意思是这类经历不作为证据，
  不是把沾过的人拉黑。
- 句式词（帮我找、有没有、的人、经验、背景）不是概念词，丢掉。
- 只在句子里明确说了的时候才填 kind / minMonths / companyTag，否则一律 null。
  不要从概念词去推断它们。`;

/**
 * 一句话 → 模型给出的原始对象。调用方必须再过一遍 `toIntent` 收窄。
 *
 * 返回 null 表示「这次用不了模型」，不区分是没配置还是失败——对调用方来说
 * 两者要做的事完全一样（退回规则解析），区分只会多一个没人用的分支。
 */
export async function understand(
	text: string,
	companyTags: readonly string[],
): Promise<unknown | null> {
	const m = getModel();
	if (!m) return null;
	try {
		const { output } = await generateText({
			model: m,
			output: Output.object({ schema: intentSchema(companyTags) }),
			system: SYSTEM,
			prompt: `公司档的可选取值：${companyTags.join("、") || "（无）"}\n\n这句话：${text}`,
			// 这是一次翻译，不是创作：要的是同一句话每次给同一组条件
			temperature: 0,
			maxRetries: 1,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			abortSignal: AbortSignal.timeout(TIMEOUT_MS),
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
