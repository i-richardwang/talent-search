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
import type { Matched } from "#/search/trace";
import { type AgentTools, SUBMIT } from "./agent-tools";
import { positiveInt, retryingTimeouts, timeoutFetch } from "./endpoint";

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
和 HR 这一次说的话。用 submit 提交整张新表，有需要时再对 HR 说一句话。

改表的规则：
- 这句话没提到的条件原样抄回来，一个字都不改。
- 要改的改那一条，要去掉的不写，要加的加上。「再资深一点」改职级那一条；
  「不要外包」是加一条；「运营那条不要了」是去掉。
- 这句话和当前的表说的是另一件事（换了一个岗位、一类人），就按这句话重写整张表。

条件只有两种：

经历（about: experience）：这个人有一段经历，同时满足写下的每一项。
- what：做过什么。方向、领域、技能、职责。写人才库里岗位和简历会用的说法，可以放几个：
  同一件事的不同写法，任一命中即可。不放更宽的词，也不替 HR 补它下面的细分方向：搜索会把
  和每个词意思相近的经历都算进来，补一个细分方向就多带进一圈和它相近的人，比如推荐算法
  会带进做推荐系统工程的人，那不是 HR 说的那件事。
- company：入职前在哪家公司。写名字，可以几个。
- department：公司内在哪个部门。写名字，可以几个。
- companyTag：入职前在哪一档公司，从给出的取值里挑。
- kind：internal 是公司内的任职，external 是入职前的经历。
- minMonths：这样的经历累计至少多少个月，三年以上就是 36。
没提到的项不写。修饰语挂在它修饰的那件事上。在哪、哪一档、入职前还是公司内、多久，
和一件做过的事说在一起时，默认说的是同一段经历，写成一条：「入职前在大厂做过三年增长」
四项都写在一条里。用户把它们说成两件事（「做过推荐，也待过字节」），或者修饰的是整个人
而不是某一件事（例一的「最好是字节来的」）时才分开写，一条只有 what，一条只有 company。
company 和 companyTag 只在入职前的经历上，department 只在公司内的任职上，不写在同一条里。
拿不准挂在哪时按同一段写：条件上看得出是这样读的，HR 不同意会说。

人（about: person）：这个人本身。field 是 level、education、recruitment 之一，
values 从给出的取值里挑，可以几个；或者 school，values 写学校名。
level 和 education 的取值按从低到高给出。说「某档以上」「至少某档」时写 atLeast，
只写那一档，不写 values，也不把以上的每一档列出来。学历说一档（「要硕士」「本科学历」）
是最低要求，也写 atLeast；只有说「只要」某几档时才写 values。职级说具体的一两档就写 values。

mode 看语气：默认 must。最好、优先、加分是 boost。不要、排除、没做过是 exclude，只用于经历。

「A 和 B 都做过」是两条经历。「A 或 B」「A、B 均可」是一条，what 里放两个。
经理、负责人、总监单独不成条，并进旁边的领域词：算法团队负责人。
帮我找、有没有、的人、经验，这些不是条件。

HR 提交之后马上看到名单，名单上方列着这张表里的每一条条件。note 是你在名单旁边对 HR 说的
一句话，只说名单和条件上看不出、又要 HR 知道或拿主意的一件事。没有这样的事就写 null：
条件上已经看得出的（「大厂」写成了头部大厂，「资深」写成了职级的高几档）不用再说。

值得说的有两种：
- 这句话里有人才库里没有的要求。人才库里只有经历（做过什么、在哪、哪一档公司、公司内还是
  入职前、多久）和人的职级、学历、招聘渠道、学校。地点、年龄、性别、薪资、绩效、性格、潜力、
  像某某一样，这些不写进表；HR 不知道的话会以为名单已经按它筛过了。
- 一个词在人才库里有几种常见的意思，按哪种理解找出来的人差很多，条件上又看不出按的是哪种。
  比如「前端」可以只指网页前端，也可以连 iOS、Android 一起算。
一次只说最要紧的那一件；几条要求都搜不了时，在一句话里一起说。

HR 可以换一种做法时给 options，没有更好的做法就空着、只说那一句。每一项是 HR 选了之后的
整张条件表，没换的条件原样抄上；label 写 HR 选它时会回的话；detail 用一句话说选了会怎样，
人数只用你查到的结果，说清是什么人的人数。给了 options 就写 current：现在这张表是哪种理解，
也写成 HR 会回的话。HR 不理这句话，名单就按现在这张表。

says 像同事之间说话：一句话，有话直说，同一件事只说一遍，不复述条件，不写「已为你」「请注意」
这类套话。says、label、detail 都不用括号。这些字原样显示给 HR 看，用 HR 的话写：
说「人才库」「简历」「职级」，不说表、词表、库、字段、工具、模型；不说你做了什么操作
（改表、重写、查词、查名字）。

表里的每个词、每个名字，搜索都会拿去人才库里找：人才库里没人这么写的等于没写；
比 HR 说的更泛的词会把不相干的人找进来。提交之前你可以在人才库里查：
- lookup_experience：几个经历词按搜索的方式各能找到多少人、命中了人才库里哪些能力词，
  每个能力词更宽和更细的词是什么。同一件事有几种写法时，用人才库里有人这么写、又和 HR 说的
  一样具体的那种；一个人都找不到的，换成人才库里的写法。人多不是问题：名单多长由 HR 看着人数决定。
- lookup_attribute：一种属性在人才库里怎么写、各有多少人。职级、学历、招聘渠道、公司档的全部取值
  下面已经给了，要再看也可以查。公司、部门、学校按包含匹配：匹配到不相干的就写全称；
  一个都匹配不到时换个写法再查，比如中文名、英文名、简称、全称。
查什么、查几次由你判断；当前表里原样留下的条件已经查过。工具只给人数和人才库里的写法，不给人；
名单由搜索决定，你写的是条件。

写好了用 submit 提交，检查通过这一轮就结束。没通过会告诉你哪里有问题，改好再提交；问题出在
用户明说的要求上、人才库里本来就没有这样的人时，把同一张表原样再提交一次：没有这样的人也是一个结果。

提交给 submit 的是一个这样的对象：
{"conditions": [条件……], "note": {"says": "", "current": "", "options": [{"label": "", "detail": "", "conditions": [条件……]}]}}
没有要说的 note 写 null，没有选项时 current 写 null、options 写空数组。
下面的例子假设取值是 level：P5、P6、P7、P8；companyTag：头部大厂、知名公司；
education：大专、本科、硕士、博士；例子里的词和名字都已经查过，人才库里就是这样写的。

例一。当前的条件表：[]。这句话：算法和后端都做过的，比较资深的，最好是字节来的
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["算法"]},
  {"about": "experience", "mode": "must", "what": ["后端", "后端开发", "服务端"]},
  {"about": "person", "mode": "boost", "field": "level", "atLeast": "P7"},
  {"about": "experience", "mode": "boost", "company": ["字节"]}],
 "note": null}

例二。当前的条件表：[]。这句话：入职前在大厂做过三年以上增长，不要实习
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["增长", "用户增长"], "kind": "external", "companyTag": ["头部大厂"], "minMonths": 36},
  {"about": "experience", "mode": "exclude", "what": ["实习"]}],
 "note": null}

例三。当前的条件表：[]。这句话：北京的大模型或推荐系统方向，有管理潜力，硕士
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["大模型", "LLM", "推荐系统"]},
  {"about": "person", "mode": "must", "field": "education", "atLeast": "硕士"}],
 "note": {
  "says": "人才库里没有工作地点，简历里也看不出管理潜力，要不要先看带过团队的？",
  "current": "先不管这两条",
  "options": [
   {"label": "带过团队的优先", "detail": "简历里写过带团队的有两百多位", "conditions": [
    {"about": "experience", "mode": "must", "what": ["大模型", "LLM", "推荐系统"]},
    {"about": "person", "mode": "must", "field": "education", "atLeast": "硕士"},
    {"about": "experience", "mode": "boost", "what": ["团队管理", "带团队"]}]}]}}

例四。当前的条件表是例一提交的四条。这句话：再加上带过团队的，不用非得是字节
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["算法"]},
  {"about": "experience", "mode": "must", "what": ["后端", "后端开发", "服务端"]},
  {"about": "person", "mode": "boost", "field": "level", "atLeast": "P7"},
  {"about": "experience", "mode": "must", "what": ["团队管理", "带团队"]}],
 "note": null}

例五。当前的条件表：[]。这句话：找做前端的
{"conditions": [
  {"about": "experience", "mode": "must", "what": ["前端开发", "Web前端"]}],
 "note": {
  "says": "前端有两种常见的意思，你要的是哪种？",
  "current": "只看网页前端",
  "options": [
   {"label": "把 iOS 和 Android 也算上", "detail": "人才库里写 iOS 或 Android 开发的还有四十多位", "conditions": [
    {"about": "experience", "mode": "must", "what": ["前端开发", "Web前端", "iOS开发", "Android开发"]}]}]}}`;

function listed(what: string, values: readonly Matched[]) {
	return `${what}：${values.map((v) => `${v.name}（${v.people} 人）`).join("、") || "（无）"}`;
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
	 * 超时由 `retryingTimeouts` 试，SDK 和超时重试用同一个数。
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
	 * 出问题的是 `finishReason` 和 `usage`：`length` 配上 `reasoningTokens`
	 * 吃掉几乎整个 `outputTokens`，一眼就是「预算被思考轨迹烧光」；`stop` 配上一段
	 * 正文，是端点没理会必须调用工具。写进错误消息，
	 * 查日志的人能直接看到原因，不必再翻 SDK 的结构。
	 */
	throw new UnansweredError(
		`查询理解模型没有提交搜索条件：finishReason=${result.finishReason}，` +
			`usage=${JSON.stringify(result.totalUsage)}，text=${JSON.stringify(result.text.slice(0, 200))}`,
	);
}
