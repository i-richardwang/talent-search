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
import { positiveInt, retryingTimeouts, timeoutFetch } from "./endpoint";

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
 * 推理模型的思考开关，和抽取那一侧同一条规则（`chat.ts`）：设了才随请求发出
 * `enable_thinking`，不设就不发。读一句话成条件不需要思考轨迹，而思考会先把
 * 输出预算烧光、返回空内容，所以带思考的模型应当设成 false。
 */
const ENABLE_THINKING = process.env.LLM_ENABLE_THINKING?.trim();

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
			// 超时装在每一次请求上，每一次尝试各有一份预算（见 `endpoint.ts`）
			fetch: timeoutFetch(TIMEOUT_MS),
			// `enable_thinking` 是网关自己的字段，兼容层的选项里没有，请求体成形后补上
			...(ENABLE_THINKING && {
				transformRequestBody: (body: Record<string, unknown>) => ({
					...body,
					enable_thinking: ENABLE_THINKING === "true",
				}),
			}),
		})(MODEL);
	return model;
}

/**
 * 判断进提示词，阈值与权重进代码。这里写的全是**逐查询的判断**：一个片段是要求、
 * 是范围还是不支持，哪种语气是哪档强度。相似多少算命中、一条要求最多几个说法、
 * 各路证据值多少分，一个数字都不在这里——它们住在 weights.ts 和 requirement.ts。
 *
 * **提示词的读者是模型，不是维护者。** 它只说要做什么、每种片段是什么、拿不准
 * 时怎么办，再给几个完整的例子；不解释我们为什么这么设计。那些论证写在这里的
 * 注释和 `intent.ts` 里：向量空间里公司名和竞品是邻居，所以公司名走精确条件；
 * 补变体是替用户的不准确用词兜底，所以只补同一件事和更具体的事，不补更宽的；
 * 一个只有功能词的片段几乎不筛人，所以要并进旁边的领域词；对不上的取值留空，
 * 由 `toSpec` 降成「没处放的条件」并带着原话。上一版把这些论证写进提示词，
 * 结果是一份几十行、没有一个完整例子的说明，和一张邀请填满的表。
 *
 * 词表只在这里列一遍，不进 schema（`intent.ts` 的 `intentSchema` 是静态的）：
 * 取值在不在词表里由代码查，查不过的片段变成没处放的条件，而不是整句作废。
 */
const SYSTEM = `把 HR 找人的一句话拆成条件。逐个片段判断它是什么，said 照抄原话，不改字。

每个片段是下面之一：
- requirement：做过什么。方向、领域、技能、职责。variants 补库里岗位会用的叫法：
  same 是同一件事的别名（BD / 商务拓展），near 是更具体或相近的事（算法 / 推荐算法）。
  不补更宽的词，拿不准就不补。
- org、school：点名的公司、部门、学校。只填 said。
- level、education、recruitment、companyTag：从下面的取值里挑一个填 value，挑不出就留空。
- kind：value 填 internal（公司内的任职）或 external（入职前的经历）。
- minMonths：value 填月数。
- unsupported：库里没有的条件。地点、年龄、性别、行业、像某某一样。

mode 看语气：默认 must。最好、优先、加分是 boost。不要、排除、没做过是 exclude。

「A 和 B 都」是两条。「A 或 B」「A、B 均可」是一条：said 填 A，B 放 anyOf。
经理、负责人、总监这类词单独不成条，并进旁边的领域词：算法团队负责人。
帮我找、有没有、的人、经验，这些不是条件，跳过。没提到的不写。

例一：算法和后端都做过的，比较资深的，最好是字节来的
- 算法 requirement must，variants 推荐算法 near、机器学习 near
- 后端 requirement must，variants 后端开发 same、服务端 same
- 资深 level must，value 空
- 字节 org boost

例二：入职前在大厂做过三年以上增长，不要实习
- 入职前 kind must，value external
- 大厂 companyTag must，value 从取值里挑最接近的一档
- 三年以上 minMonths must，value 36
- 增长 requirement must，variants 用户增长 same
- 实习 requirement exclude

例三：大模型或推荐系统方向，北京的，硕士
- 大模型 requirement must，anyOf 推荐系统，variants LLM same
- 北京 unsupported
- 硕士 education must，value 从取值里挑`;

function listed(what: string, values: readonly string[]) {
	return `${what}：${values.join("、") || "（无）"}`;
}

/**
 * 一句话 → 模型给出的片段清单。调用方必须再过一遍 `toSpec` 收窄。
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
	/*
	 * 一次检索愿意多等的只有一次：人在等结果。可重试的应答由 SDK 试，
	 * 超时由 `retryingTimeouts` 试，两边给同一个数。
	 */
	const retries = 1;
	try {
		const { output } = await retryingTimeouts(retries, () =>
			generateText({
				model: m,
				output: Output.object({ schema: intentSchema }),
				system: SYSTEM,
				prompt: [
					"取值",
					listed("level", vocab.level),
					listed("education", vocab.education),
					listed("recruitment", vocab.recruitment),
					listed("companyTag", vocab.companyTag),
					`\n这句话：${text}`,
				].join("\n"),
				// 这是一次翻译，不是创作：要的是同一句话每次给同一组条件
				temperature: 0,
				maxRetries: retries,
				maxOutputTokens: MAX_OUTPUT_TOKENS,
			}),
		);
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
