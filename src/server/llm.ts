/**
 * 查询理解的端点适配层：发送需求、当前条件与语料词表，消费提交工具的条件表。
 * 工具回答只提供人数与写法，不发送个人信息或经历。模型不可增删或重排候选人。
 * 未配置或未能作答时抛出错误，查询记录保持待理解供重试。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, isStepCount } from "ai";
import { type Condition, withOff } from "#/search/condition";
import type { Submission, Vocabulary } from "#/search/intent";
import { type AgentTools, SUBMIT } from "./agent-tools";
import { positiveInt, retryingTimeouts, timeoutFetch } from "./endpoint";

/** OpenAI 兼容工具调用端点，配置由环境提供。 */
const BASE_URL = process.env.LLM_BASE_URL;
const API_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL;

/**
 * 推理模型的思考开关，和抽取那一侧同一条规则（`chat.ts`）：设了才随请求发出
 * `enable_thinking`，不设就不发。读一句话成条件不需要思考轨迹，而思考会先把
 * 输出预算烧光、返回空内容，所以带思考的模型应当设成 false。
 */
const ENABLE_THINKING = process.env.LLM_ENABLE_THINKING?.trim();

/** 单次请求的超时与输出预算；输出包含推理模型的思考 token。 */
const TIMEOUT_MS = positiveInt(process.env.LLM_TIMEOUT_MS, 60_000);
const MAX_OUTPUT_TOKENS = positiveInt(
	process.env.LLM_MAX_OUTPUT_TOKENS,
	16_000,
);

/**
 * 一轮理解最多调用几次模型，每次调用里模型可以用几个工具。通常查一次、提交一次，
 * 两次调用；提交没通过检查、改完再提交，三次。最后一次只留提交这一个工具，并在
 * 消息里明说（`LAST_STEP`），保证用完次数时模型提交了一份搜索条件。
 */
const AGENT_STEPS = 6;

const LAST_STEP =
	"查询的次数用完了。不要再查，按已经查到的结果，现在用 submit 提交搜索条件。";

/** 未配置时界面只提供关键词搜索。 */
export function understandingConfigured(): boolean {
	return Boolean(BASE_URL && MODEL);
}

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
 * 模型提交整张条件表和本轮说明；未提到的条件保持原样，无法表达的需求说明原因。
 * 领域判断写在提示词中，取值来自语料；schema 与领域规则校验由 intent.ts 负责。
 */
const SYSTEM = `你在帮 HR 维护一张找人的搜索条件表。给你的是当前的条件表（第一句话时是空的）
和 HR 这一次说的话。用 submit 提交整张新表，再加两样说明。

改表的规则：
- 这句话没提到的条件原样抄回来，一个字都不改。
- 要改的改那一条，要去掉的不写，要加的加上。「再资深一点」改职级那一条；
  「不要外包」是加一条；「运营那条不要了」是去掉。
- 这句话和当前的表说的是另一件事（换了一个岗位、一类人），就按这句话重写整张表。

条件只有两种：

经历（about: experience）：这个人有一段经历，同时满足写下的每一项。
- what：做过什么。方向、领域、技能、职责。写人才库里岗位和简历会用的说法，可以放几个：
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
level 和 education 的取值按从低到高给出。说「某档以上」「至少某档」时写 atLeast，
只写那一档，不写 values，也不把以上的每一档列出来。学历说一档（「要硕士」「本科学历」）
是最低要求，也写 atLeast；只有说「只要」某几档时才写 values。职级说具体的一两档就写 values。

mode 看语气：默认 must。最好、优先、加分是 boost。不要、排除、没做过是 exclude，只用于经历。

「A 和 B 都做过」是两条经历。「A 或 B」「A、B 均可」是一条，what 里放两个。
经理、负责人、总监单独不成条，并进旁边的领域词：算法团队负责人。
帮我找、有没有、的人、经验，这些不是条件。

两样说明，原样显示给 HR 看。用 HR 的话写：说「人才库」「简历」「职级」，不说表、词表、
库、字段、工具、模型；不说你做了什么操作（改表、重写、查词、查名字）。

assumed：一个词有几种读法、读法不同会找出不同的人，你替 HR 选了一种时，用一句话写下
你是怎么理解的。比如「资深」按职级的高几档理解、作为加分项；「大厂」按哪一档公司理解。
把条件复述一遍不算，读法没有分歧就不写；换了一件事、整张表重写时也不用说明。

declined：人才库里只有经历（做过什么、在哪、哪一档公司、公司内还是入职前、多久）和
人的职级、学历、招聘渠道、学校。说到这之外的——地点、年龄、性别、薪资、绩效、
性格、潜力、像某某一样——不写进表，写进 declined：said 是原话，why 用一句话说
暂不支持按什么筛选，或者简历里看不出什么。经历里有相近的线索就把它写成 instead，
HR 可以一键改成这样找；没有就空着。

表里的每个词、每个名字，搜索都会拿去人才库里找：太宽的几乎不筛人，人才库里没人这么写的
等于没写。提交之前你可以在人才库里查：
- find_terms：几个经历词按搜索的方式各能找到多少人、会不会太宽（几乎人人都沾边）、
  命中了人才库里哪些能力词。太宽的换更具体的说法；一个人都找不到的，换成人才库里的写法。
- find_names：几个公司名或学校名各能匹配到多少人、匹配到人才库里哪些公司或学校。名字按包含匹配，
  匹配到不相干的就写全称。
查什么、查几次由你判断；当前表里原样留下的条件已经查过。工具只给人数和人才库里的写法，不给人；
名单由搜索决定，你写的是条件。

写好了用 submit 提交，检查通过这一轮就结束。没通过会告诉你哪里有问题，改好再提交；问题出在
用户明说的要求上、人才库里本来就没有这样的人时，把同一张表原样再提交一次：没有这样的人也是一个结果。

提交给 submit 的是一个这样的对象：
{"conditions": [条件……], "assumed": [一句一条……], "declined": [{"said": "", "why": "", "instead": [条件……]}]}
没有的就写空数组。下面的例子假设取值是 level：P5、P6、P7、P8；companyTag：头部大厂、知名公司；
education：大专、本科、硕士、博士；例子里的词和名字都已经查过，人才库里就是这样写的。

例一。当前的条件表：[]。这句话：算法和后端都做过的，比较资深的，最好是字节来的
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["算法", "推荐算法", "机器学习"]},
  {"about": "experience", "mode": "must", "what": ["后端", "后端开发", "服务端"]},
  {"about": "person", "mode": "boost", "field": "level", "atLeast": "P7"},
  {"about": "experience", "mode": "boost", "org": ["字节"]}],
 "assumed": ["「比较资深」按职级 P7 及以上理解，作为加分项"],
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
  {"about": "person", "mode": "must", "field": "education", "atLeast": "硕士"}],
 "assumed": [],
 "declined": [
  {"said": "北京的", "why": "暂不支持按工作地点筛选", "instead": []},
  {"said": "有管理潜力", "why": "简历中看不出管理潜力，可以看是否带过团队", "instead": [
    {"about": "experience", "mode": "boost", "what": ["团队管理", "带团队"]}]}]}

例四。当前的条件表是例一提交的四条。这句话：再加上带过团队的，不用非得是字节
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["算法", "推荐算法", "机器学习"]},
  {"about": "experience", "mode": "must", "what": ["后端", "后端开发", "服务端"]},
  {"about": "person", "mode": "boost", "field": "level", "atLeast": "P7"},
  {"about": "experience", "mode": "must", "what": ["团队管理", "带团队"]}],
 "assumed": [],
 "declined": []}`;

function listed(what: string, values: readonly string[]) {
	return `${what}：${values.join("、") || "（无）"}`;
}

/**
 * 端点答了，但没按约定作答：没提交搜索条件，或提交的条件校验之后什么都不剩。
 * 和连不上、报错分开，是因为只有这一种换个说法可能有用。
 */
export class UnansweredError extends Error {
	override name = "UnansweredError";
}

/**
 * 当前条件 + 一句话 → 模型提交的新条件表与说明。调用方必须再用 `understood` 校验一遍。
 *
 * 模型可以先查经历词和名字（`agent-tools.ts`），再用 `submit` 提交；没通过检查就改了再
 * 提交，通过了就停，最多调用 `AGENT_STEPS` 次模型。结果是最后一次提交的搜索条件：
 * 次数用完时最后一次提交即使没通过检查也用它，其中不合规的部分由 `understood` 去掉。
 * 一次都没提交就是没作答。
 */
export async function understand(
	text: string,
	vocab: Vocabulary,
	base: readonly Condition[],
	agent: AgentTools,
): Promise<Submission> {
	const m = getModel();
	/*
	 * 一次检索愿意多等的只有一次：人在等结果。可重试的应答由 SDK 试，
	 * 超时由 `retryingTimeouts` 试，两边给同一个数。
	 */
	const retries = 1;
	const result = await retryingTimeouts(retries, () =>
		generateText({
			model: m,
			tools: agent.tools,
			toolChoice: "required",
			stopWhen: [isStepCount(AGENT_STEPS), agent.passed],
			prepareStep: ({ stepNumber, messages }) =>
				stepNumber === AGENT_STEPS - 1
					? {
							activeTools: [SUBMIT],
							toolChoice: { type: "tool", toolName: SUBMIT },
							messages: [...messages, { role: "user", content: LAST_STEP }],
						}
					: undefined,
			system: SYSTEM,
			prompt: [
				"取值",
				listed("level（从低到高）", vocab.level),
				listed("education（从低到高）", vocab.education),
				listed("recruitment", vocab.recruitment),
				listed("companyTag", vocab.companyTag),
				// 停用是用户在 chip 上的操作，模型写不出也不必看见：它原样写回这一条，
				// 停用状态由 `understood` 从上一轮带回来
				`\n当前的条件表：${JSON.stringify(base.map((c) => withOff(c, null)))}`,
				`\n这句话：${text}`,
			].join("\n"),
			// 这是一次翻译，不是创作：要的是同一句话每次给同一组条件
			temperature: 0,
			maxRetries: retries,
			maxOutputTokens: MAX_OUTPUT_TOKENS,
		}),
	);
	const submitted = agent.lastSubmitted();
	if (submitted) return submitted;
	/*
	 * 真正说明问题的是 `finishReason` 和 `usage`：`length` 配上 `reasoningTokens`
	 * 吃掉几乎整个 `outputTokens`，一眼就是「预算被思考轨迹烧光」；`stop` 配上一段
	 * 正文，是端点没理会必须调用工具。写进错误消息，查日志的人不必再翻 SDK 的结构。
	 */
	throw new UnansweredError(
		`查询理解模型没有提交搜索条件：finishReason=${result.finishReason}，` +
			`usage=${JSON.stringify(result.totalUsage)}，text=${JSON.stringify(result.text.slice(0, 200))}`,
	);
}
