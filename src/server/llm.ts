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
 * 2. **没配就抛，不降级。** 一句话只有模型能读成条件：语气（「最好」「不要」）、
 *    范围（「入职前」「三年以上」）和没处放的条件全靠它分拣。没有第二种读法能
 *    给出同一份结果，所以也没有第二条路——装作能用给出的是一份语义相反的名单，
 *    而它在屏幕上和正确的名单长得一模一样。API key 只在端点需要鉴权时配置。
 * 3. **失败就抛，带着诊断。** 超时、限流、模型输出异常，一律作为错误交给调用方。
 *    调用方（`server/turn.ts`）让这条记录停在「待理解」，界面据此画出错误与重试，
 *    而不是把故障画成「没有这样的人」。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { intentSchema, type Vocabulary } from "#/search/intent";
import { positiveInt } from "./env";

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
 * 根本没出门，模型全靠 prompt 自觉，字段名和取值一走样就整条理解失败。所以这里
 * 默认打开；碰上老网关不认 json_schema，把 `LLM_STRUCTURED_OUTPUTS=false` 设上即可。
 */
const STRUCTURED = process.env.LLM_STRUCTURED_OUTPUTS !== "false";

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
const TIMEOUT_MS = positiveInt(process.env.LLM_TIMEOUT_MS, 60_000);
const MAX_OUTPUT_TOKENS = positiveInt(process.env.LLM_MAX_OUTPUT_TOKENS, 8_000);

// provider 延迟到首次使用时创建，未配置模型的进程可以安全导入本模块。
let model: ReturnType<ReturnType<typeof createOpenAICompatible>> | null = null;
function getModel() {
	if (!BASE_URL || !MODEL)
		throw new Error(
			"查询理解端点未配置：需要 LLM_BASE_URL 与 LLM_MODEL（见 .env.example）",
		);
	if (!model)
		model = createOpenAICompatible({
			name: "talent-llm",
			baseURL: BASE_URL,
			supportsStructuredOutputs: STRUCTURED,
			...(API_KEY && { apiKey: API_KEY }),
		})(MODEL);
	return model;
}

/**
 * 判断进提示词，阈值与权重进代码。这里写的全是**逐查询的判断**：一个片段是要求、
 * 是筛选还是不支持，哪种语气是哪档强度。相似多少算命中、太宽算多宽、
 * 各路证据值多少分，一个数字都不在这里——它们住在 weights.ts。
 */
const SYSTEM = `你在把 HR 的一句大白话翻译成人才库的检索条件。

库里存的是每个人的经历段：公司内的任职（序列、岗位、部门、职级）和入职前的
工作经历（公司、岗位、简历描述）。检索按**语义**匹配：每条说法和每段经历的原文
由模型判定是不是一回事。它判的是「同一件事」，不是「相关领域」：「算法」找得到
「推荐算法工程师」，但「深度学习」找不到只写着「算法」的人。所以每个说法都要
写成库里岗位或序列会用的叫法。

你的工作是**路由**：句子里的每个片段只能去三个地方之一。

一、terms（语义要求）——「做过什么」：方向、领域、技能、职责。
- 每个说法两到十二个字：「渠道运营」「支付风控」「团队管理」，不要写成
  「做过渠道运营的人」。缩写展开成全称（BD → 商务拓展，PM 按上下文写成
  产品经理或项目经理）。
- 一句话里的不同条件拆成不同的条目，不要合并成一个长短语。
- 一条要求是几个 members，满足其一即可。用户自己说的标 said：「大模型或推荐系统」
  「均可」「都行」这种明确并列是同一条里的几个 said，拆成两条就变成了都要。
- **替用户补变体。** 用户用词不一定准，只按原话找会漏人：说「算法」的人也想看到
  岗位只写着「推荐算法」的人。每条要求再补最多四个库里岗位或序列会用的叫法，
  标 same 或 near：same 是同一件事的另一种叫法（BD 与商务拓展、大模型与 LLM），
  near 是相近但不是同一件事（算法与推荐算法、机器学习）。**只有这两档**，
  「相关领域」不补——「增长」补「运营」、「算法」补「后端」会把不相干的人带进来，
  宁可少补。排除词不补变体：排除必须准。
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
语义匹配会把竞品全匹配进来。
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
会让描述里提到过那个词的段被静默匹配进来，而用户以为条件生效了。`;

function listed(what: string, values: readonly string[]) {
	return `${what}的可选取值：${values.join("、") || "（无）"}`;
}

/**
 * 一句话 → 模型给出的原始对象。调用方必须再过一遍 `toSpec` 收窄。
 *
 * 结构化输出失败时真正说明问题的是 `usage` 和 `finishReason`——
 * `finishReason: "length"` 配上 `reasoningTokens` 吃掉几乎整个 `outputTokens`，
 * 一眼就是「预算被思考轨迹烧光」，而异常本身只会说「没有生成对象」。AI SDK
 * 把这些挂在 `NoObjectGeneratedError` 上，这里把它们写进错误消息，查日志的人
 * 不必再去翻一次 SDK 的异常结构。
 */
export async function understand(
	text: string,
	vocab: Vocabulary,
): Promise<unknown> {
	const m = getModel();
	try {
		const { output } = await generateText({
			model: m,
			output: Output.object({ schema: intentSchema(vocab) }),
			system: SYSTEM,
			prompt: [
				listed("companyTag", vocab.companyTag),
				listed("level", vocab.level),
				listed("recruitment", vocab.recruitment),
				listed("education", vocab.education),
				`\n这句话：${text}`,
			].join("\n"),
			// 这是一次翻译，不是创作：要的是同一句话每次给同一组条件
			temperature: 0,
			maxRetries: 1,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
			timeout: TIMEOUT_MS,
		});
		return output;
	} catch (e) {
		if (!NoObjectGeneratedError.isInstance(e)) throw e;
		throw new Error(
			`查询理解模型没有给出合法对象：finishReason=${e.finishReason}，` +
				`usage=${JSON.stringify(e.usage)}，text=${JSON.stringify(e.text?.slice(0, 200))}`,
			{ cause: e },
		);
	}
}
