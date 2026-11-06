/**
 * 查询理解的端点适配层：发送需求、当前条件、数据目录与语料词表，消费提交工具的条件。
 * 工具回答只提供人数与写法，不发送个人信息或经历。模型不可增删或重排候选人。
 * 未配置、超过时限或未能作答时抛出错误，查询记录保持待理解供重试。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, isStepCount, ToolChoiceViolationError } from "ai";
import { catalogText } from "#/search/catalog";
import type { Submission, Vocabulary } from "#/search/intent";
import { type QueryCondition, withOff } from "#/search/query";
import type { Matched, StreamFact } from "#/search/trace";
import { type AgentTools, SUBMIT } from "./agent-tools";
import { endpointFetch, positiveInt } from "./endpoint";

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
/** 一次请求失败再试几次：人在等结果，只多等一次。 */
const RETRIES = 1;

/**
 * 一轮理解最多调用几次模型，每次调用里模型可以用几个工具。通常看一次目录或查一次词、
 * 试跑一次、提交一次；提交没通过检查、改完再提交，再多一两次。最后一次只留提交这一个工具，并在
 * 消息里明说（`LAST_STEP`），保证用完次数时模型提交了一份搜索条件。
 */
const AGENT_STEPS = 8;

/**
 * 一轮理解最多花多久，含全部模型调用、重试和工具：每一步给一份单次请求的超时。一步是一次
 * 模型请求加上它调的工具，试跑和提交检查都要嵌入、重排，步数用满时总时间跟着步数涨；时限按
 * 固定几次请求算，步数一多，正常走完的理解也会被截断。卡住的单次请求由它自己的超时截住
 * （`endpoint.ts`），不靠这个总时限。
 * 过了这个时限的理解一定已经结束，`server/turn.ts` 据此认出进程中途没了的那一次。
 */
export const UNDERSTAND_LIMIT_MS = AGENT_STEPS * TIMEOUT_MS;

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
			// 每一步的请求各自超时、各自重试（见 `endpoint.ts`）
			fetch: endpointFetch({ timeoutMs: TIMEOUT_MS, retries: RETRIES }),
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
 * 模型提交整份条件和本轮说明；未提到的条件保持原样，无法表达的需求说明原因。
 * 领域判断写在提示词中，取值来自语料；形状与白名单校验由 intent.ts 和 sandbox.ts 负责。
 * 数据目录是提示词的一部分（`catalogText`）：目录变了，`eval:understand` 要重跑。
 */
const SYSTEM = `你在帮 HR 维护一份找人的搜索条件。给你的是当前的条件（第一句话时是空的）和 HR 这一次
说的话。用 submit 提交整份新条件，有需要时再对 HR 说一句话。名单由搜索按你写的条件找出来、排好，
你写的是条件，不挑人。

改条件的规则：
- 这句话没提到的条件原样抄回来，id、label、where、params 一个字都不改。
- 要改的改那一条，id 照抄；要去掉的不写；要加的加上，不写 id。「再资深一点」改职级那一条；
  「不要外包」是加一条；「运营那条不要了」是去掉。
- 这句话和当前的条件说的是另一件事（换了一个岗位、一类人），就按这句话重写整份。

一条条件是：
{"id": 沿用时照抄, "label": 写给 HR 看的一句话, "mode": "must|boost|exclude",
 "from": "experience|person", "terms": {短名: [写法……]}, "where": "SQL 布尔表达式",
 "params": {名字: 取值}, "minMonths": 月数}

from 决定这条在问什么：
- experience：这个人有一段工作经历 e，同时满足 where 里写的每一项。where 里只能直接用 e，
  写了 terms 时还能用 h。一条之内说的是同一段经历：「入职前在大厂做过三年增长」的公司档、
  入职前、增长和三年都写在一条里。条件之间说的是同一个人。
- person：这个人整体的情况，where 里只能直接用 p。职级、学历、学校、招聘渠道写在 p 上；
  评级、状态这类记录用子查询读 rating、status，用 r.emp_id = p.emp_id 关联到这个人。

做过什么（方向、领域、技能、职责）写进 terms，搜索按意思在经历里找，命中的写在 h 上：
- 键是自己起的短名（比如 rec），值是同一件事的几种写法，任一命中即可。写人才库里岗位和简历会用
  的说法；不放更宽的词，也不替 HR 补它下面的细分方向：搜索会把和每个词意思相近的经历都算进来，
  补一个细分方向就多带进一圈和它相近的人。
- 不要用 e.title、e.department 的字面去筛做过什么。
- 写了 terms 的条件，名次按命中得多深、多久、多近来排，命中的那段就是名单上的证据。
- 只关心命中的是哪一类说法或投入时才用 h（h.route、h.engagement）；平常 where 里不必提 h。

在哪、哪一档、入职前还是公司内、多久：
- 入职前的公司名、公司档只在 e.kind = 'external' 的段上；公司内的部门只在 e.kind = 'internal'
  的段上，一段只有其一。名字按包含匹配：e.company ilike :c，params 里写 "%名字%"。
- 和一件做过的事说在一起的修饰语，默认说的是同一段经历，写进同一条的 where。用户把它们说成
  两件事（「做过推荐，也待过字节」），或者修饰的是整个人（「最好是字节来的」）时分成两条：
  一条写 terms，一条只写 where（没有 terms 的经历条件只定去留或加分，不排名次）。
- 一段任职的性质（实习、兼职）写在岗位名里，不是做过什么：按字面写 e.title ilike :t，不写 terms。
- minMonths 是满足这条的段累计的月数，三年以上就是 36。只说一段要多长时写 e.months >= 36。
- 拿不准挂在哪时按同一段写：label 上看得出是这样读的，HR 不同意会说。

人的条件：
- 有限取值的几列，取值下面给了，原样用。职级、学历说「某档以上」「至少某档」时比档高：
  p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)；
  学历说一档（「要硕士」）是最低要求，同样写成比档高；职级说具体的一两档时写
  p.level_band in (:a, :b)。
- 学校档是学校的档（985、211 这类），档之间不比高低；说一个统称时把它包含的档都写上。
- 学校名按包含匹配：p.school ilike :s。

记录（绩效这类评级、高潜池这类状态）：
- 有哪些记录流、覆盖哪几期、档从低到高是什么，下面给了；要看人数用 discover。
- 没有某一期的记录不算任何一档；没有任何记录的人不满足关于这条流的任何条件。写否定（「从没拿过 C」）
  时同时要求有记录：exists (…有记录) and not exists (…拿过 C)。
- 「近三年」按日期：r.period_end >= current_date - interval '3 years'；不按期数换算。
- 高低只比档高 value_rank，「A 及以上」是 r.value_rank >= (select s.rank from scale s
  where s.stream = r.stream and s.value = 'A')。
- 「连续两期」：两期首尾相接，后一期的 period_start 是前一期 period_end 的下一天。

写 where 的规矩：一个布尔表达式，不写分号和注释；关系名不带 schema；列都带别名；取值放进
params，用 :名字 引用；emp_id 只作关联键，只能和另一列 emp_id 比相等；不限就写 true。
函数只用常用的日期、聚合、字符串、数值函数。

mode 看语气：默认 must。最好、优先、加分是 boost。不要、排除、没做过是 exclude，只用于经历：
它否决的是满足它的那些段，那些段不再算作任何条件的证据。

「A 和 B 都做过」是两条经历。「A 或 B」「A、B 均可」是一条，terms 里放两个写法。
经理、负责人、总监单独不成条，并进旁边的领域词：算法团队负责人。
帮我找、有没有、的人、经验，这些不是条件。

label 写给 HR 看，HR 靠它核对你是怎么理解的：说清找的是什么经历或什么人，修饰语挂在哪里
（「在甲公司做推荐系统的那段」和「做过推荐系统，也在甲公司待过」不一样），不写 SQL、表名、列名。

HR 提交之后马上看到名单，名单上方列着每一条条件的 label。note 是你在名单旁边对 HR 说的一句话，
只说名单和条件上看不出、又要 HR 知道或拿主意的一件事。没有这样的事就写 null。值得说的有两种：
- 这句话里有人才库表达不了的要求。人才库里有什么看下面的数据目录和记录流；地点、年龄、性别、薪资、
  性格、潜力、像某某一样，这些不写进条件；HR 不知道的话会以为名单已经按它筛过了。
  点名的公司、学校表达得了，只是人才库里没有人：条件照写，说一句人才库里没有这一家。
- 一个词在人才库里有几种常见的意思，按哪种理解找出来的人差很多，条件上又看不出按的是哪种。
一次只说最要紧的那一件；几条要求都搜不了时，在一句话里一起说。整份条件搜出多少人、是不是
一个都没有，HR 在名单上看得到：不用说，也不用替 HR 提议放宽。

HR 可以换一种做法时给 options，没有更好的做法就空着、只说那一句。每一项是 HR 选了之后的
整份条件，没换的条件原样抄上；label 写 HR 选它时会回的话；detail 用一句话说选了会怎样，人数只用
你查到的结果，说清是什么人的人数。给了 options 就写 current：现在这份条件是哪种理解，也写成 HR
会回的话。HR 不理这句话，名单就按现在这份条件。

says 写给 HR 看：书面、简洁，一句话说清一件事，不复述条件，不写「已为你」「请注意」这类套话。
says、label、detail 都不用括号。用 HR 的话写：说「人才库」「简历」「职级」「绩效」，不说表、
词表、库、字段、工具、模型、SQL；不说你做了什么操作。

提交之前你可以查：
- discover：数据目录里一列有哪些取值、各多少人；公司、部门、学校的名字能匹配到多少人、人才库里
  怎么写；记录流的覆盖。
- lookup_experience：几个经历词按搜索的方式各能找到多少人、命中了人才库里哪些能力词，每个能力词
  更宽和更细的词。一个人都找不到的，换成人才库里的写法。人多不是问题：名单多长由 HR 看着人数决定。
- probe：试跑一份完整的条件，看每条单独有多少人、整份有多少人、哪一条写不对。人数和你理解的
  对不上时，回头看 where。
查什么、查几次由你判断；当前条件里原样留下的已经查过。工具只给人数和写法，不给人。

写好了用 submit 提交，检查通过这一轮就结束。没通过会告诉你哪里有问题，改好再提交。只有一种问题
可以不改：说找不到人或找出的太多，而那正是用户明说的要求、人才库里本来就没有这样的人时，把同一份
原样再提交一次，没有这样的人也是一个结果。label、where 写不对或跑不了的，原样再交也不收。
用户点名的公司、学校、档找不到人，不换成别的名字、别的档，也不因此拆开或改写修饰语挂在哪；
照用户说的写，在 note 里说一句人才库里没有。

提交给 submit 的是 {"conditions": [条件……], "note": {"says": "", "current": "", "options":
[{"label": "", "detail": "", "conditions": [条件……]}]}}。没有要说的 note 写 null，没有选项时
current 写 null、options 写空数组。

数据目录：

${catalogText()}

下面的例子假设 level_band 有 P5、P6、P7、P8；company_tag 有 头部大厂、知名公司；记录流 perf 是
半年一期的绩效，档从低到高 C、B、B+、A、A+。例子里的词和名字都已经查过，人才库里就是这样写的。

例一。当前的条件：[]。这句话：算法和后端都做过的，比较资深的，最好是字节来的
{"conditions": [
  {"label": "做过算法", "mode": "must", "from": "experience", "terms": {"algo": ["算法"]}, "where": "true"},
  {"label": "做过后端开发", "mode": "must", "from": "experience", "terms": {"be": ["后端", "后端开发", "服务端"]}, "where": "true"},
  {"label": "职级 P7 及以上", "mode": "boost", "from": "person", "where": "p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)", "params": {"band": "P7"}},
  {"label": "入职前在字节待过", "mode": "boost", "from": "experience", "where": "e.kind = 'external' and e.company ilike :c", "params": {"c": "%字节%"}}],
 "note": null}

例二。当前的条件：[]。这句话：入职前在大厂做过三年以上增长，不要实习
{"conditions": [
  {"label": "入职前在头部大厂做增长，累计三年以上", "mode": "must", "from": "experience", "terms": {"growth": ["增长", "用户增长"]}, "where": "e.kind = 'external' and e.company_tag = :tag", "params": {"tag": "头部大厂"}, "minMonths": 36},
  {"label": "实习经历不算", "mode": "exclude", "from": "experience", "where": "e.title ilike :t", "params": {"t": "%实习%"}}],
 "note": null}

例三。当前的条件：[]。这句话：在甲辰科技做过推荐系统的，只算在甲辰那段
{"conditions": [
  {"label": "在甲辰科技做推荐系统的那段经历", "mode": "must", "from": "experience", "terms": {"rec": ["推荐系统", "推荐算法"]}, "where": "e.kind = 'external' and e.company ilike :c", "params": {"c": "%甲辰科技%"}}],
 "note": null}

例四。当前的条件：[]。这句话：近三年至少两次绩效 A 以上，现在在高潜池里的优先
{"conditions": [
  {"label": "近三年绩效至少两次 A 及以上", "mode": "must", "from": "person", "where": "(select count(*) from rating r where r.emp_id = p.emp_id and r.stream = 'perf' and r.period_end >= current_date - interval '3 years' and r.value_rank >= (select s.rank from scale s where s.stream = 'perf' and s.value = :band)) >= :times", "params": {"band": "A", "times": 2}},
  {"label": "目前在高潜池里", "mode": "boost", "from": "person", "where": "exists (select 1 from status t where t.emp_id = p.emp_id and t.stream = 'hipo' and (t.valid_to is null or t.valid_to >= current_date))"}],
 "note": null}

例五。当前的条件是例一提交的四条（带着各自的 id）。这句话：再加上带过团队的，不用非得是字节
{"conditions": [
  {"id": "沿用例一第一条的 id", "label": "做过算法", "mode": "must", "from": "experience", "terms": {"algo": ["算法"]}, "where": "true"},
  {"id": "沿用例一第二条的 id", "label": "做过后端开发", "mode": "must", "from": "experience", "terms": {"be": ["后端", "后端开发", "服务端"]}, "where": "true"},
  {"id": "沿用例一第三条的 id", "label": "职级 P7 及以上", "mode": "boost", "from": "person", "where": "p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)", "params": {"band": "P7"}},
  {"label": "带过团队", "mode": "must", "from": "experience", "terms": {"lead": ["团队管理", "带团队"]}, "where": "true"}],
 "note": null}

例六。当前的条件：[]。这句话：北京的大模型方向，有管理潜力，硕士
{"conditions": [
  {"label": "做过大模型", "mode": "must", "from": "experience", "terms": {"llm": ["大模型", "LLM"]}, "where": "true"},
  {"label": "硕士及以上", "mode": "must", "from": "person", "where": "p.education_rank >= (select s.rank from scale s where s.stream = 'education' and s.value = :edu)", "params": {"edu": "硕士"}}],
 "note": {
  "says": "人才库里没有工作地点，简历里也看不出管理潜力，要不要先看带过团队的？",
  "current": "先不管这两条",
  "options": [
   {"label": "带过团队的优先", "detail": "简历里写过带团队的有两百多位", "conditions": [
    {"label": "做过大模型", "mode": "must", "from": "experience", "terms": {"llm": ["大模型", "LLM"]}, "where": "true"},
    {"label": "硕士及以上", "mode": "must", "from": "person", "where": "p.education_rank >= (select s.rank from scale s where s.stream = 'education' and s.value = :edu)", "params": {"edu": "硕士"}},
    {"label": "带过团队", "mode": "boost", "from": "experience", "terms": {"lead": ["团队管理", "带团队"]}, "where": "true"}]}]}}`;

/** 有限取值的几维写进提示词时用的名字：目录里的列。 */
const VOCAB_COLUMN: Record<keyof Vocabulary, string> = {
	level: "person.level_band（从低到高）",
	education: "person.education（从低到高）",
	recruitment: "person.recruitment",
	companyTag: "experience.company_tag",
	schoolTier: "person.school_tier",
	overseas: "person.overseas",
};

function listed(what: string, values: readonly Matched[]) {
	return `${what}：${values.map((v) => `${v.name}（${v.people} 人）`).join("、") || "（无）"}`;
}

function streamLine(s: StreamFact) {
	const span = s.first
		? `${s.first} 起，最近一期 ${s.latest?.start ?? ""}${s.latest?.end ? ` 至 ${s.latest.end}` : " 起至今"}`
		: "还没有记录";
	return `${s.stream}（${s.label}，${s.kind === "rating" ? "评级" : "状态"}${s.period ? `，${s.period}一期` : ""}）：${s.people} 人，${span}${s.scale.length > 0 ? `；档从低到高 ${s.scale.join("、")}` : ""}`;
}

/** 预先写进提示词的活统计：有限取值几维的取值和人数，记录流的覆盖。 */
export type Facts = { vocab: Vocabulary; streams: readonly StreamFact[] };

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
 * 次数用完时最后一次提交即使没通过检查也用它，其中形状不合规、`where` 过不了白名单的条件
 * 在写入前去掉（`server/turn.ts`）。
 * 一次都没提交就是没作答。
 */
export async function understand(
	text: string,
	{ vocab, streams }: Facts,
	base: readonly QueryCondition[],
	agent: AgentTools,
): Promise<Submission> {
	const result = await generateText({
		model: getModel(),
		// 整次理解的时限；到了就停，不再重发（重试在 `endpointFetch` 里，以一步为单位）
		timeout: UNDERSTAND_LIMIT_MS,
		maxRetries: 0,
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
		instructions: SYSTEM,
		prompt: [
			"取值",
			...(Object.keys(VOCAB_COLUMN) as (keyof Vocabulary)[]).map((key) =>
				listed(VOCAB_COLUMN[key], vocab[key]),
			),
			"\n记录流",
			...(streams.length > 0 ? streams.map(streamLine) : ["（没有）"]),
			// 停用是用户在 chip 上的操作，模型写不出也不必看见：它原样写回这一条，
			// 停用状态由 `understood` 从上一轮带回来
			`\n当前的条件表：${JSON.stringify(base.map((c) => withOff(c, null)))}`,
			`\n这句话：${text}`,
		].join("\n"),
		// 这是一次翻译，不是创作：要的是同一句话每次给同一组条件
		temperature: 0,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
	}).then(
		({ finishReason, text }) => ({ finishReason, text }),
		(error) => {
			// 必须调用工具的一步没有调用，SDK 在这一步抛错；之前的提交仍然算数
			if (!ToolChoiceViolationError.isInstance(error)) throw error;
			const text = error.content
				.flatMap((part) => (part.type === "text" ? [part.text] : []))
				.join("");
			return { finishReason: error.finishReason, text };
		},
	);
	const submitted = agent.lastSubmitted();
	if (submitted) return submitted;
	/*
	 * 写进错误消息的是停下的原因：`length` 是输出预算（含思考轨迹）用光了，`stop` 配上
	 * 一段正文是端点没理会必须调用工具。查日志的人直接看得到，不必再翻 SDK 的结构。
	 */
	throw new UnansweredError(
		`查询理解模型没有提交搜索条件：finishReason=${result.finishReason}，` +
			`text=${JSON.stringify(result.text.slice(0, 200))}`,
	);
}
