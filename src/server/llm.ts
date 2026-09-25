/**
 * 查询理解模型的唯一调用点。**薄到没有逻辑**——形状与收窄在
 * `#/search/intent`，那一半是纯函数、有测试；这里只负责「把话发出去、
 * 把 JSON 拿回来」。
 *
 * 三条硬约束：
 *
 * 1. **发出去的只有三样东西**：用户自己敲的那句话、这条搜索当前的条件，以及
 *    语料里几维筛选的取值（公司档、职级、招聘渠道、学历）。姓名、工号、任何一个
 *    人的经历都不出这台机器。因此查询理解可以直接使用公网端点；重排必须发送
 *    候选经历，端点位置需要由部署方的数据政策决定。
 * 2. **没配就抛，不降级。** 一句话只有模型能读成条件：语气（「最好」「不要」）、
 *    修饰语挂在哪件事上（「入职前」「三年以上」）和该搜什么词全靠它。没有第二种读法能
 *    给出同一份结果，所以也没有第二条路——装作能用给出的是一份语义相反的名单，
 *    而它在屏幕上和正确的名单长得一模一样。API key 只在端点需要鉴权时配置。
 * 3. **失败就抛，带着诊断。** 超时、限流、模型输出异常，一律作为错误交给调用方。
 *    调用方（`server/turn.ts`）让这条记录停在「待理解」，界面据此画出错误与重试，
 *    而不是把故障画成「没有这样的人」。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	extractJsonMiddleware,
	generateText,
	NoObjectGeneratedError,
	Output,
	stepCountIs,
	type ToolSet,
	wrapLanguageModel,
} from "ai";
import { type Condition, withOff } from "#/search/condition";
import { intentSchema, jsonText, type Vocabulary } from "#/search/intent";
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
const MAX_OUTPUT_TOKENS = positiveInt(
	process.env.LLM_MAX_OUTPUT_TOKENS,
	16_000,
);

/**
 * 交表之前最多走几步：每一步是一次模型调用，中间可以调几个工具。正常一轮查一次词、
 * 试一次搜、交表，三步。试搜总是很少人时模型会一直放宽再试，所以最后一步不许用工具，
 * 并在消息里明说（`LAST_STEP`）：有的端点不理会 `toolChoice`，会把工具调用写成正文。
 * 步数用完必须落在一张表上，而不是一次没有下文的工具调用。
 */
const AGENT_STEPS = 6;

const LAST_STEP =
	"查词和试搜的次数用完了。不要再调用工具，按已经得到的数，现在只输出那个 JSON 对象。";

/**
 * 查询理解配好了没有。没配时只有关键词搜索，界面不给那个说一句话的框：
 * 让人把话敲完再报「端点未配置」，等于先收下一件做不了的事。
 */
export function understandingConfigured(): boolean {
	return Boolean(BASE_URL && MODEL);
}

// provider 延迟到首次使用时创建，未配置模型的进程可以安全导入本模块。
let model: ReturnType<typeof wrapLanguageModel> | null = null;
function getModel() {
	if (!BASE_URL || !MODEL)
		throw new Error(
			"查询理解端点未配置：需要 LLM_BASE_URL 与 LLM_MODEL（见 .env.example）",
		);
	if (!model)
		model = wrapLanguageModel({
			// 用过工具之后模型爱在 JSON 前后说话；只取正文里那一个对象（`jsonText`）
			middleware: extractJsonMiddleware({ transform: jsonText }),
			model: createOpenAICompatible({
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
			})(MODEL),
		});
	return model;
}

/**
 * 判断进提示词，阈值与权重进代码。这里写的全是**逐查询的判断**：一句话里哪些
 * 是条件、修饰语挂在哪个动词上、哪种语气是哪档强度、这句话改的是哪一条。
 * 相似多少算命中、一条主张最多几个词、说明最多几条，一个数字都不在这里——
 * 它们住在 weights.ts、condition.ts 和 intent.ts。
 *
 * **提示词的读者是模型，不是维护者。** 它只说要做什么、两种条件各是什么、拿不准
 * 时怎么办，再给几个完整的例子；不解释我们为什么这么设计。那些论证写在这里的
 * 注释和 `condition.ts` 里：向量空间里公司名和竞品是邻居，所以公司名走精确条件；
 * 一条主张里放几个词是替用户的不准确用词兜底，所以只放同一件事和更具体的
 * 事，不放更宽的；一个只有功能词的主张几乎不筛人，所以要并进旁边的领域词。
 *
 * 模型交回整张表而不是一串编辑：没提到的条件原样抄回来，用户就能从前后两张表
 * 的差别里看见它动了什么（`changesOf`）。搜不了的要求写进 `declined`：用户说了的
 * 话要么变成条件，要么得到一句为什么。
 *
 * 词表有哪些取值只在这里说一遍，不进 schema（`intent.ts` 的 `intentSchema` 是
 * 静态的）：取值在不在词表里由代码查，查不过的取值丢掉，而不是整句作废。
 *
 * 输出形状和例子写成 JSON 放在提示词里，不只靠 schema：不认 json_schema 的网关
 * （`LLM_STRUCTURED_OUTPUTS=false`）根本不把 schema 发出去，模型能看到的形状只有
 * 这里写的。例子写成别的样子，它就照着那个样子交回来。
 */
const SYSTEM = `你在帮 HR 维护一张找人的搜索条件表。给你的是当前的条件表（第一句话时是空的）
和 HR 这一次说的话。交回整张新表，再加两样说明。

改表的规则：
- 这句话没提到的条件原样抄回来，一个字都不改。
- 要改的改那一条，要去掉的不写，要加的加上。「再资深一点」改职级那一条；
  「不要外包」是加一条；「运营那条不要了」是去掉。
- 这句话和当前的表说的是另一件事（换了一个岗位、一类人），就按这句话重写整张表。

条件只有两种：

经历（about: experience）：这个人有一段经历，同时满足写下的每一项。
- what：做过什么。方向、领域、技能、职责。写库里岗位和简历会用的说法，可以放几个：
  同一件事的别名、更具体的叫法，任一命中即可。不放更宽的词。
- org：在哪家公司、哪个部门。写名字，可以几个。
- companyTag：在哪一档公司，从给出的取值里挑。
- kind：internal 是公司内的任职，external 是入职前的经历。
- minMonths：这样的经历累计至少多少个月，三年以上就是 36。
没提到的项不写。修饰语挂在它修饰的那件事上。在哪、哪一档、入职前还是公司内、多久，
和一件做过的事说在一起时，默认说的是同一段经历，写成一条：「入职前在大厂做过三年增长」
四项都写在一条里。用户把它们说成两件事（「做过推荐，也待过字节」），或者修饰的是整个人
而不是某一件事（例一的「最好是字节来的」）时才分开写，一条只有 what，一条只有 org。
拿不准挂在哪时按同一段写，并在 assumed 里说一句是怎么读的。

人（about: person）：这个人本身。field 是 level、education、recruitment 之一，
values 从给出的取值里挑，可以几个；或者 school，values 写学校名。

mode 看语气：默认 must。最好、优先、加分是 boost。不要、排除、没做过是 exclude，只用于经历。

「A 和 B 都做过」是两条经历。「A 或 B」「A、B 均可」是一条，what 里放两个。
经理、负责人、总监单独不成条，并进旁边的领域词：算法团队负责人。
帮我找、有没有、的人、经验，这些不是条件。

两样说明，原样显示给 HR 看。用 HR 的话写：说「人才库」「简历」「职级」，不说表、词表、
库、字段、工具、模型；不说你做了什么操作（改表、重写、查词、试搜）。

assumed：一个词有几种读法、读法不同会找出不同的人，你替 HR 选了一种时，用一句话写下
你是怎么理解的。比如「资深」按职级的高几档理解、作为加分项；「大厂」按哪一档公司理解。
把条件复述一遍不算，读法没有分歧就不写；换了一件事、整张表重写时也不用说明。

declined：库里只有经历（做过什么、在哪、哪一档公司、公司内还是入职前、多久）和
人的职级、学历、招聘渠道、学校。说到这之外的——地点、年龄、性别、薪资、绩效、
性格、潜力、像某某一样——不写进表，写进 declined：said 是原话，why 用一句话说
暂不支持按什么筛选，或者简历里看不出什么。经历里有相近的线索就把它写成 instead，
HR 可以一键改成这样找；没有就空着。

只输出一个 JSON 对象，不要别的文字：
{"conditions": [条件……], "assumed": [一句一条……], "declined": [{"said": "", "why": "", "instead": [条件……]}]}
没有的就写空数组。下面的例子假设取值是 level：P5、P6、P7、P8；companyTag：头部大厂、知名公司；
education：本科、硕士、博士。

例一。当前的条件表：[]。这句话：算法和后端都做过的，比较资深的，最好是字节来的
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["算法", "推荐算法", "机器学习"]},
  {"about": "experience", "mode": "must", "what": ["后端", "后端开发", "服务端"]},
  {"about": "person", "mode": "boost", "field": "level", "values": ["P7", "P8"]},
  {"about": "experience", "mode": "boost", "org": ["字节"]}],
 "assumed": ["「比较资深」按职级 P7、P8 理解，作为加分项"],
 "declined": []}

例二。当前的条件表：[]。这句话：入职前在大厂做过三年以上增长，不要实习
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["增长", "用户增长"], "kind": "external", "companyTag": ["头部大厂"], "minMonths": 36},
  {"about": "experience", "mode": "exclude", "what": ["实习"]}],
 "assumed": ["「大厂」按「头部大厂」理解"],
 "declined": []}

例三。当前的条件表：[]。这句话：北京的大模型或推荐系统方向，有管理潜力，硕士
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["大模型", "LLM", "推荐系统"]},
  {"about": "person", "mode": "must", "field": "education", "values": ["硕士"]}],
 "assumed": [],
 "declined": [
  {"said": "北京的", "why": "暂不支持按工作地点筛选", "instead": []},
  {"said": "有管理潜力", "why": "简历中看不出管理潜力，可以看是否带过团队", "instead": [
    {"about": "experience", "mode": "boost", "what": ["团队管理", "带团队"]}]}]}

你有两个工具，交表之前先用：
- look_up_words：查几个词库里叫什么、多少人写过、按意思搜会不会太宽。写 what 之前把打算写的词
  查一遍，用库里的写法；太宽的词换更具体的。
- try_conditions：拿打算交的表试搜一次，看多少人。一个人都没有时，放宽你自己补的词和替用户选的
  读法（换库里有的写法、去掉补上的一条、把补的必须改成加分）再试；用户明说的要求不去掉、不改成
  加分，没有这样的人也是一个结果，HR 会在名单那里看到怎么放宽。上千人就收紧。试过之后再交表。
工具只给数，不给人；名单由检索决定，你写的是条件。

例四。当前的条件表是例一交回的四条。这句话：再加上带过团队的，不用非得是字节
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["算法", "推荐算法", "机器学习"]},
  {"about": "experience", "mode": "must", "what": ["后端", "后端开发", "服务端"]},
  {"about": "person", "mode": "boost", "field": "level", "values": ["P7", "P8"]},
  {"about": "experience", "mode": "must", "what": ["团队管理", "带团队"]}],
 "assumed": [],
 "declined": []}`;

function listed(what: string, values: readonly string[]) {
	return `${what}：${values.join("、") || "（无）"}`;
}

/**
 * 端点答了，但没按约定作答：没给出合法对象，或给的东西收窄之后什么都不剩。
 * 和连不上、报错分开，是因为只有这一种换个说法可能有用。
 */
export class UnansweredError extends Error {
	override name = "UnansweredError";
}

/**
 * 当前条件 + 一句话 → 模型写出的新条件表与说明。调用方必须再过一遍 `understood` 收窄。
 *
 * 交表之前模型可以用 `tools` 查词、试搜（`agent-tools.ts`），最多 `AGENT_STEPS` 步；
 * 最后一步的正文就是那张表。工具用不用由模型定：不用也是合法的一轮。
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
	base: readonly Condition[],
	tools: ToolSet,
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
				tools,
				stopWhen: stepCountIs(AGENT_STEPS),
				prepareStep: ({ stepNumber, messages }) =>
					stepNumber === AGENT_STEPS - 1
						? {
								toolChoice: "none",
								messages: [...messages, { role: "user", content: LAST_STEP }],
							}
						: undefined,
				system: SYSTEM,
				prompt: [
					"取值",
					listed("level", vocab.level),
					listed("education", vocab.education),
					listed("recruitment", vocab.recruitment),
					listed("companyTag", vocab.companyTag),
					// 停用是用户在 chip 上的操作，模型写不出也不必看见：它交回同一条，
					// 停用由 `understood` 带回去
					`\n当前的条件表：${JSON.stringify(base.map((c) => withOff(c, null)))}`,
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
		throw new UnansweredError(
			`查询理解模型没有给出合法对象：finishReason=${e.finishReason}，` +
				`usage=${JSON.stringify(e.usage)}，text=${JSON.stringify(e.text?.slice(0, 200))}`,
			{ cause: e },
		);
	}
}
