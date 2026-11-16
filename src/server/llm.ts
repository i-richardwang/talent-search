/**
 * 查询理解的端点适配层：发送需求、当前条件、这次找人之前的对话、数据目录与语料词表，消费提交
 * 工具的条件（`understand`）；读一批经历、交回符合的段（`judgeSegments`，由 `reading.ts` 调度）。
 * 模型写的是条件，名单只从搜索来：它不可增删或重排候选人。
 * 未配置、超过时限或未能作答时抛出错误，查询记录保持未完成供重试。
 */

import "@tanstack/react-start/server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, isStepCount, ToolChoiceViolationError, tool } from "ai";
import { z } from "zod";
import { gate } from "#/lib/concurrent";
import { catalogText } from "#/search/catalog";
import type { Understood, Vocabulary } from "#/search/intent";
import { withOff } from "#/search/query";
import type { CompanyFacts, Matched, StreamFact } from "#/search/trace";
import { type AgentTools, SUBMIT } from "./agent-tools";
import { endpointPolicy, positiveInt, thinkingSwitch } from "./endpoint";
import type { Judge } from "./reading";

const BASE_URL = process.env.LLM_BASE_URL;
const API_KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL;

/**
 * 推理模型的思考开关，和抽取那一侧同一条规则（`chat.ts`）：设了才随请求发出，两种写法都发，
 * 不设就不发。思考 token 算在单次请求的输出预算里（`MAX_OUTPUT_TOKENS`），先把预算烧光时这一步
 * 交不出工具调用，所以带思考的模型通常设成 false。
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
const REQUEST = endpointPolicy({ timeoutMs: TIMEOUT_MS, retries: RETRIES });

/**
 * 一轮理解最多调用几次模型，每次调用里模型可以用几个工具。通常捞一次说法、试跑一次、读一次
 * 经历、提交一次；提交没通过检查、改完再读再提交，再多几次。最后一次只留提交这一个工具，并在
 * 消息里明说（`LAST_STEP`），保证用完次数时模型提交了一份搜索条件。读经历的请求不算在里面：
 * 它们不在这段对话里（`reading.ts`）。
 */
const AGENT_STEPS = 10;

/**
 * 读经历同时发出几个请求。整个进程共用这一个上限：几个人同时找人时一起排队，不超过端点
 * 那一侧能接的并发。
 */
const READ_CONCURRENCY = positiveInt(process.env.LLM_READ_CONCURRENCY, 8);
const readGate = gate(READ_CONCURRENCY);

/**
 * 一次模型请求的总时限，包含全部尝试和退避，与执行请求使用同一份策略。`server/turn.ts`
 * 按这个时限加上步骤落库的时间判断一次处理还在不在。
 */
export const STEP_LIMIT_MS = REQUEST.limitMs;

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
			fetch: REQUEST.fetch,
			...thinkingSwitch(ENABLE_THINKING),
		})(MODEL);
	return model;
}

/**
 * 读一批经历的请求（`judgeSegments`）的全部指令。它看不到 HR 的话，也看不到别的条件：算和不算
 * 全凭每一组的 criterion。
 */
const READING = `你在帮 HR 从公司内部的人才库里筛经历。给你一批经历，按所属的条件分组，每组写着条件的
label 和 criterion。每段前面有编号 n，写着在哪家公司或哪个部门、序列、岗位、从简历读出的技能
（前面是投入：主导、做过、提到）和简历原文。

每一段按它所属那一组的 criterion 判，用 judge 把符合的段的编号交上来（fits）：这一段里看得出
他本人做过 criterion 说的事。只是提到、配合，或者做的是相近的另一件事，不交。没交的就是不算，
不用写出来。字面对得上不等于做的就是这件事：公司、部门、序列、岗位、技能、原文合起来看。
照 criterion 里写明的算和不算来判；只看写出来的内容，不猜没写的；不看这段离现在多久、做了多长。
每一段都要看到，符合的不要漏。只交一次，符合的编号全写在这一次里；一段都不符合就交空数组。`;

/**
 * 模型提交整份条件和本轮说明；未提到的条件保持原样，无法表达的需求说明原因。
 * 领域判断写在提示词中，取值来自语料；形状与白名单校验由 intent.ts 和 sandbox.ts 负责。
 * 数据目录是提示词的一部分（`catalogText`）：目录变了，`eval:understand` 要重跑。
 */
const SYSTEM = `你在帮 HR 从公司内部的人才库里找人。给你的是当前的搜索条件（第一句话时是空的）和 HR
这一次说的话；不是第一句话时，还有这次找人之前的对话。你要做两件事：写出整份新的搜索条件；
让条件搜出来的候选人的经历按你写的判据读一遍。两件事都做完，用 submit 提交，有需要时再对 HR
说一句话。名单上的人只从搜索来：搜到的经历算不算按你写的判据定，不添加搜索没找到的人，也不排
名次。没读过的经历不算数：名单上只有读过、算数的人。

之前的对话写着 HR 前几轮说过的话、自己改过什么，每一轮之后条件加了什么、去掉了什么，你对 HR
说过、问过什么。用它读懂这句话接的是哪一句、指的是什么（「不是这个意思」「还是按刚才那样」
「第二种」）。条件以当前的条件表为准：之前说过、后来去掉的要求，这句话没有再提就不要加回来；
之前的对话里也没有的要求不要自己补。

改条件的规则：
- 这句话没提到的条件原样抄回来，id、label、where、params 一个字都不改。
- 要改的改那一条，id 照抄；要去掉的不写；要加的加上，不写 id。「再资深一点」改职级那一条；
  「不要外包」是加一条；「运营那条不要了」是去掉。
- 这句话和当前的条件说的是另一件事（换了一个岗位、一类人），就按这句话重写整份。

一条条件是：
{"id": 沿用时照抄, "label": 写给 HR 看的一句话, "mode": "must|boost|exclude",
 "from": "experience|person", "seek": {"criterion": 判据, "patterns": [正则……]},
 "where": "SQL 布尔表达式",
 "params": {名字: 取值}, "minMonths": 月数}

from 决定这条在问什么：
- experience：这个人有一段工作经历 e，同时满足 where 里写的每一项。where 里只能直接用 e，
  写了 seek 时还能用 h。一条之内说的是同一段经历：「入职前在大厂做过三年增长」的公司档、
  入职前、增长和三年都写在一条里。条件之间说的是同一个人。
- person：这个人整体的情况，where 里只能直接用 p。职级、学历、学校、招聘渠道写在 p 上；
  评级、状态这类记录用子查询读 rating、status，用 r.emp_id = p.emp_id 关联到这个人。

做过什么（方向、领域、技能、职责）写进 seek。人才库里每个人的每段经历都读成了若干条说法：
公司内的一段任职是「序列｜岗位名」；入职前的经历是岗位名，加上从简历描述里读出来的技能词
（几个字的短语，写法很散）。
- patterns 是一组正则（不分大小写），在全部说法里按字面把候选的经历找出来，命中的写在 h 上。
  这件事按字面找不出来、只能读了才知道（「能独当一面」「不是辅助性的工作」）时，patterns 给
  空数组：where 圈出的每一段都是候选，都要读，所以 where 要先把范围圈小。能按字面找的
  一定写 patterns。
  宁可找宽：写这件事的词根，不要把每一种说法列一遍——说法列不全，漏掉的人就不在名单上。
  找商家服务写「商家」「商户」，不要写成「商家运营」「商家维护」「商家培训」一长串；同义词、
  行业叫法、英文和缩写、公司内部序列和岗位可能的叫法都要想到。英文缩写两头用 (?<![a-z]) 和
  (?![a-z]) 挡住别的单词。找宽了不要紧，字面对得上的经历会按 criterion 逐段读、把不算的判掉；
  只有会带进几百上千段不相干经历的单字和泛词不要写（找用户增长时只写「增长」会带进销售业绩的
  增长）。需求本身就是一个宽的方向（做运营的）时，写那个词。
- criterion 用两三句话写清什么样的经历算 HR 要的、什么不算（字面像但做的是另一件事的、比需求
  宽得多的、只是沾一点边的）。它是读经历时下结论的全部标准：读的时候只看得到这条的 label、
  criterion 和那一段经历，看不到 HR 的话、这段对话和别的条件，之后几轮沿用这条条件时还是它。
  所以要离开这句话也判得出来：HR 对这件事的限定（「推荐方向的不算」「纯执行的不算」）、之前的
  对话里说定的算和不算，都写在这里。
- 写之前先用 find 看这件事在人才库里有哪些叫法、各有多少人。
- 不要用 e.title、e.department 的字面去筛做过什么。
- 写了 seek 的条件，名次按投入多深、多久、多近来排，读下来算数的那段就是名单上的证据。
- 只关心命中的是哪一类说法或投入时才用 h（h.route、h.engagement）；平常 where 里不必提 h。

读经历：
- 条件写好先用 probe 试跑，再用 read 把候选人还没读过的经历读完。read 按每条条件的 criterion 逐段
  判断这一段算不算、把结论记下，回给你每条这一次读了多少段、多少段算数，候选人还剩多少段没读。
  经历的文字不给你看。
- 一条读了很多段、算数的却很少，而且还剩很多没读，多半是正则带进了一大类不相干的经历：把正则
  改窄、重新 probe，再 read；读过的不用再读。
- 结论是按 criterion 的文字记下的：读过之后 criterion 一个字都不要改，提交的要和读的时候是同一份，
  改了读过的结论就都用不上。
- 上一轮留下来、原样沿用的条件，以前读过的经历结论还在，read 只读没读过的。
- 候选人很多时 read 从职级高的人读起，一轮读到上限为止。到了上限就提交：名单上方会告诉 HR
  现在列到了哪一级职级，你不用说，也不用为此改条件或问 HR。

在哪、哪一档、入职前还是公司内、多久：
- 入职前的公司名、公司档只在 e.kind = 'external' 的段上；公司内的部门只在 e.kind = 'internal'
  的段上，一段只有其一。名字按包含匹配：e.company ilike :c，params 里写 "%名字%"。
- 和一件做过的事说在一起的修饰语，默认说的是同一段经历，写进同一条的 where。用户把它们说成
  两件事（「做过推荐，也待过字节」），或者修饰的是整个人（「最好是字节来的」）时分成两条：
  一条写 seek，一条只写 where（没有 seek 的经历条件只定去留或加分，不排名次）。
- 一段任职的性质（实习、兼职）写在岗位名里，不是做过什么：按字面写 e.title ilike :t，不写 seek。
  「实习不算」是对那一条的限定：在那一条的 where 里加 e.title not ilike :t。
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

mode 看语气：默认 must。最好、优先、加分是 boost。exclude 只用于经历，说的是这个人：他不能有
任何一段这样的经历，有一段，人就不在名单上。「没做过销售的」「不要销售出身的」「不要某行业
来的」是 exclude：照常写 where，要读了才知道的写 seek。
HR 说「不要」「不算」时先分清说的是人还是某一件事：
- 说的是人不能有的经历（「做过运营，但没做过销售」）：另写一条 exclude。
- 说的是要找的那件事里哪种不算（「做算法的，推荐方向的不算」「实习不算」）：不是 exclude，写进
  那一条自己的 criterion 或 where。做过推荐、也做过别的算法的人还在名单上。
label 上要看得出是哪一种。exclude 的 label 写被排除的那种经历（「做过销售」「在主营咨询的公司
待过」），HR 看到的是它后面跟着「排除」；限定写在它限定的那一条的 label 里（「做过算法，推荐
方向不算」）。

「A 和 B 都做过」是两条经历。「A 或 B」「A、B 均可」是一条：criterion 写两样都算，patterns 两样都捞。
经理、负责人、总监单独不成条，并进旁边那一条的 criterion：要的是算法团队的负责人。
帮我找、有没有、的人、经验，这些不是条件。

label 写给 HR 看，HR 靠它核对你是怎么理解的：说清找的是什么经历或什么人，修饰语挂在哪里
（「在甲公司做推荐系统的那段」和「做过推荐系统，也在甲公司待过」不一样），不写 SQL、表名、列名。

你提交之后 HR 就看到名单，名单上方列着每一条条件的 label。note 是你在名单旁边对 HR 说的一句话，
只说名单和条件上看不出、又要 HR 知道或拿主意的一件事。没有这样的事就写 null。值得说的有两种：
- 这句话里有人才库表达不了的要求。人才库里有什么看下面的数据目录和记录流；地点、年龄、性别、薪资、
  性格、潜力、像某某一样，这些不写进条件；HR 不知道的话会以为名单已经按它筛过了。
  点名的公司、学校表达得了，只是人才库里没有人：条件照写，说一句人才库里没有这一家。
- 一个词在人才库里有几种常见的意思，按哪种理解找出来的人差很多，条件上又看不出按的是哪种。
一次只说最要紧的那一件；几条要求都搜不了时，在一句话里一起说。整份条件搜出多少人、是不是
一个都没有，HR 在名单上看得到：不用说，也不用替 HR 提议放宽。

HR 可以有别的回答时给 options，没有就空着、只说那一句。每一项的 label 是 HR 选它时会说的一句
完整的话（「有外卖业务的公司也算」「只看做用户运营的」）：HR 点了，这句话就作为下一句话交给你，
你照它改条件、接着找。detail 用一句话说选了会怎样，人数只用你查到的结果，说清是什么人的人数。
给了 options 就写 current：现在这份条件是按哪种理解找的，也写成 HR 会回的话。HR 不理这句话，
名单就按现在这份条件。

says 写给 HR 看：书面、简洁，一句话说清一件事，不复述条件，不写「已为你」「请注意」这类套话。
says、label、detail 都不用括号。用 HR 的话写：说「人才库」「简历」「职级」「绩效」，不说表、
词表、库、字段、工具、模型、SQL；不说你做了什么操作。

入职前那家公司是什么，人才库里有两类说法。人事登记的：company_tag 公司档、company_nature 企业性质。
公司知识给的：company_name 规范名、company_group 集团、main_industries 与 industries 行业、
company_circles 名企组合。
- 「某行业来的」「某行业背景」说的是在哪类公司待过，是经历条件的 where，不是 seek。在那个行业里
  做什么岗位写进同一条的 seek：「外卖行业的运营」是一条，seek 找运营，where 写行业。
- 行业默认按主营找（main_industries）。HR 说的是「有这块业务的公司」「涉足」时按 industries。
  两种找法人数差得多、这句话又看不出要哪种时，照主营写，在 note 里说一句，另一种作为 options
  里的一句回答。
- 行业说的是公司，不是这个人：HR 要亲手做过这块业务的人（「做过外卖配送调度」）时，那是做过什么，
  写进 seek，不靠行业。
- 「某某系」「某集团出来的」按 company_group；点名一家公司仍按 company。「四大」「MBB」这类
  说法在 company_circles 里有就按它，「大厂」这类档次按 company_tag。
- 「不要某行业来的」是 exclude：where 写行业，不写 seek。

提交之前你可以用的工具：
- discover：数据目录里一列有哪些取值、各多少人；公司、部门、学校的名字能匹配到多少人、人才库里
  怎么写；记录流的覆盖。
- find：几条正则各自按字面捞到多少种短说法、多少人，写的人最多的是哪些。用它看这件事在人才库
  里怎么叫、正则有没有漏掉的叫法或捞宽了。它只列正则自己捞到的短说法；搜索时还会带上同一个词
  的其他写法和没读过的经历的简历原文，probe 数到的人可能更多。
- probe：试跑一份完整的条件，看每条单独选中多少人（people；写了 seek 的是字面对得上的人，
  含还没读的；exclude 数的是它最多会拦下的人）、名单上多少人、哪一条写不对，候选人有多少
  （candidates）、他们还有多少段经历没读（unread）。人数和你理解的对不上时，回头看 where 和正则。
- read：把候选人还没读过的经历读完，见上面。
调用的次数有限：通常 find 一次、probe 一次、read 一次，再 submit。
当前条件里原样留下的不用再 find；它们以前读过的经历结论还在，probe 的 unread 不是 0 时照样要 read。

写好了用 submit 提交，检查通过这一轮就结束。没通过会告诉你哪里有问题，改好再提交。只有一种问题
可以不改：说找不到人或找出的太多，而那正是用户明说的要求、人才库里本来就没有这样的人时，把同一份
原样再提交一次，没有这样的人也是一个结果。label、where、正则写不对或跑不了的，原样再交也不收；
候选人还有经历没读的也不收，读完再交。
用户点名的公司、学校、档找不到人，不换成别的名字、别的档，也不因此拆开或改写修饰语挂在哪；
照用户说的写，在 note 里说一句人才库里没有。

提交给 submit 的是 {"conditions": [条件……], "note": {"says": "", "current": "", "options":
[{"label": "", "detail": ""}]}}。没有要说的 note 写 null，没有别的回答时 current 写 null、
options 写空数组。

数据目录：

${catalogText()}

下面的例子假设 level_band 有 P5、P6、P7、P8；company_tag 有 头部大厂、知名公司；行业里有
消费/零售 和它下面的 外卖；记录流 perf 是半年一期的绩效，档从低到高 C、B、B+、A、A+。例子里的正则和名字都已经查过，
人才库里就是这样叫的；候选人的经历也都用 read 读过。例子只写最后提交的内容。

例一。当前的条件：[]。这句话：算法和后端都做过的，比较资深的，最好是字节来的
{"conditions": [
  {"label": "做过算法", "mode": "must", "from": "experience", "seek": {"criterion": "本人做算法研发：机器学习、推荐、搜索、视觉、NLP 这类算法的设计、训练和优化都算。只是使用算法结果的业务岗位、算法团队里的项目管理和招聘不算。", "patterns": ["算法", "机器学习", "深度学习", "(?<![a-z])(nlp|cv)(?![a-z])"]}, "where": "true"},
  {"label": "做过后端开发", "mode": "must", "from": "experience", "seek": {"criterion": "本人写服务端代码：后端、服务端开发，用 Java、Go 这类语言做业务系统研发都算。前端、客户端、测试、运维不算；看不出是哪一端的研发工程师也不算。", "patterns": ["后端", "服务端", "后台开发", "(?<![a-z])(java|golang)(?![a-z])"]}, "where": "true"},
  {"label": "职级 P7 及以上", "mode": "boost", "from": "person", "where": "p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)", "params": {"band": "P7"}},
  {"label": "入职前在字节待过", "mode": "boost", "from": "experience", "where": "e.kind = 'external' and e.company ilike :c", "params": {"c": "%字节%"}}],
 "note": null}

例二。当前的条件：[]。这句话：入职前在大厂做过三年以上增长，实习不算
{"conditions": [
  {"label": "入职前在头部大厂做增长，累计三年以上，实习不算", "mode": "must", "from": "experience", "seek": {"criterion": "本人负责用户增长：拉新、获客、激活、留存、裂变这类让用户规模变大的工作都算。泛泛的运营、销售业绩的增长、只做投放素材的不算。", "patterns": ["用户增长", "增长(运营|策略|产品|黑客)", "拉新", "获客", "留存", "growth"]}, "where": "e.kind = 'external' and e.company_tag = :tag and e.title not ilike :t", "params": {"tag": "头部大厂", "t": "%实习%"}, "minMonths": 36}],
 "note": null}

例三。当前的条件：[]。这句话：在甲辰科技做过推荐系统的，只算在甲辰那段
{"conditions": [
  {"label": "在甲辰科技做推荐系统的那段经历", "mode": "must", "from": "experience", "seek": {"criterion": "本人做推荐系统或推荐算法的研发：召回、排序、推荐策略、推荐引擎都算。拿推荐位做运营的、做广告投放的、只做搜索算法或广告算法的不算。", "patterns": ["推荐", "召回", "(?<![a-z])ctr(?![a-z])"]}, "where": "e.kind = 'external' and e.company ilike :c", "params": {"c": "%甲辰科技%"}}],
 "note": null}

例四。当前的条件：[]。这句话：近三年至少两次绩效 A 以上，现在在高潜池里的优先
{"conditions": [
  {"label": "近三年绩效至少两次 A 及以上", "mode": "must", "from": "person", "where": "(select count(*) from rating r where r.emp_id = p.emp_id and r.stream = 'perf' and r.period_end >= current_date - interval '3 years' and r.value_rank >= (select s.rank from scale s where s.stream = 'perf' and s.value = :band)) >= :times", "params": {"band": "A", "times": 2}},
  {"label": "目前在高潜池里", "mode": "boost", "from": "person", "where": "exists (select 1 from status t where t.emp_id = p.emp_id and t.stream = 'hipo' and (t.valid_to is null or t.valid_to >= current_date))"}],
 "note": null}

例五。当前的条件是例一提交的四条（带着各自的 id）。这句话：再加上带过团队的，不用非得是字节
{"conditions": [
  {"id": "沿用例一第一条的 id", "label": "做过算法", "mode": "must", "from": "experience", "seek": {"criterion": "本人做算法研发：机器学习、推荐、搜索、视觉、NLP 这类算法的设计、训练和优化都算。只是使用算法结果的业务岗位、算法团队里的项目管理和招聘不算。", "patterns": ["算法", "机器学习", "深度学习", "(?<![a-z])(nlp|cv)(?![a-z])"]}, "where": "true"},
  {"id": "沿用例一第二条的 id", "label": "做过后端开发", "mode": "must", "from": "experience", "seek": {"criterion": "本人写服务端代码：后端、服务端开发，用 Java、Go 这类语言做业务系统研发都算。前端、客户端、测试、运维不算；看不出是哪一端的研发工程师也不算。", "patterns": ["后端", "服务端", "后台开发", "(?<![a-z])(java|golang)(?![a-z])"]}, "where": "true"},
  {"id": "沿用例一第三条的 id", "label": "职级 P7 及以上", "mode": "boost", "from": "person", "where": "p.level_rank >= (select s.rank from scale s where s.stream = 'level' and s.value = :band)", "params": {"band": "P7"}},
  {"label": "带过团队", "mode": "must", "from": "experience", "seek": {"criterion": "本人带过团队：有下属，负责团队的管理。只做项目协调、只带过实习生或新人的不算。", "patterns": ["团队管理", "带团队", "团队负责人", "人员管理", "主管|总监|组长"]}, "where": "true"}],
 "note": null}

例六。当前的条件：[]。这句话：北京的大模型方向，有管理潜力，硕士
{"conditions": [
  {"label": "做过大模型", "mode": "must", "from": "experience", "seek": {"criterion": "本人做大模型的研发或应用开发：大语言模型的训练、微调、推理，基于大模型做应用（RAG、Agent、提示词工程）都算。只是用 AI 工具办公的、只做传统 NLP 或机器学习的不算。", "patterns": ["大模型", "大语言模型", "生成式", "(?<![a-z])(llm|aigc|gpt|rag)(?![a-z])", "提示词|prompt"]}, "where": "true"},
  {"label": "硕士及以上", "mode": "must", "from": "person", "where": "p.education_rank >= (select s.rank from scale s where s.stream = 'education' and s.value = :edu)", "params": {"edu": "硕士"}}],
 "note": {
  "says": "人才库里没有工作地点，简历里也看不出管理潜力，要不要先看带过团队的？",
  "current": "先不管这两条",
  "options": [
   {"label": "带过团队的优先", "detail": "简历里写过带团队的有两百多位"}]}}

例七。当前的条件：[]。这句话：外卖行业的运营，甲辰系的优先，不要咨询行业出来的
{"conditions": [
  {"label": "在主营外卖的公司做运营", "mode": "must", "from": "experience", "seek": {"criterion": "本人做运营：商家运营、用户运营、活动运营、城市运营这些运营岗位都算。销售、客服、产品经理不算。", "patterns": ["运营"]}, "where": ":ind = any(e.main_industries)", "params": {"ind": "外卖"}},
  {"label": "入职前在甲辰集团旗下的公司待过", "mode": "boost", "from": "experience", "where": "e.company_group ilike :g", "params": {"g": "%甲辰%"}},
  {"label": "在主营咨询的公司待过", "mode": "exclude", "from": "experience", "where": ":ind = any(e.main_industries)", "params": {"ind": "咨询"}}],
 "note": null}

例八。当前的条件：[]。这句话：做过用户运营，但没做过销售的
{"conditions": [
  {"label": "做过用户运营", "mode": "must", "from": "experience", "seek": {"criterion": "本人做用户运营：用户分层、活跃、留存、社群、会员这类面向用户的运营都算。商家运营、内容审核、客服不算。", "patterns": ["用户运营", "社群", "会员运营", "用户(活跃|留存|分层)"]}, "where": "true"},
  {"label": "做过销售", "mode": "exclude", "from": "experience", "seek": {"criterion": "本人做销售：背销售指标、直接面向客户卖产品或签单的岗位都算。售前支持、销售运营、给销售团队做培训的不算。", "patterns": ["销售", "(?<![a-z])(bd|sales)(?![a-z])", "大客户", "客户经理"]}, "where": "true"}],
 "note": null}`;

/** 有限取值的几维写进提示词时的标题（目录里的列），按提示词里的顺序。 */
const VOCAB_HEADING: readonly (readonly [keyof Vocabulary, string])[] = [
	["level", "person.level_band（从低到高）"],
	["education", "person.education（从低到高）"],
	["recruitment", "person.recruitment"],
	["companyTag", "experience.company_tag"],
	["schoolTier", "person.school_tier"],
	["overseas", "person.overseas"],
];

function listed(what: string, values: readonly Matched[]) {
	return `${what}：${values.map((v) => `${v.name}（${v.people} 人）`).join("、") || "（无）"}`;
}

/**
 * 公司的概况写进提示词的样子：企业性质、名企组合各一行，行业按树缩进，一行两个人数。
 * 最后一行是覆盖：没认出公司的段不满足任何行业条件。数据源没有公司知识时只说没有。
 */
function companyLines(company: CompanyFacts): string[] {
	const depth = new Map<string, number>();
	const lines = [
		listed("experience.company_nature", company.natures),
		listed("experience.company_circles", company.circles),
	];
	if (company.industries.length === 0)
		return [...lines, "行业：（人才库里没有行业数据）"];
	lines.push(
		"行业（缩进的是下级；人数是 待过主营是它的公司的人 / 待过做它的公司的人，分别对应 experience.main_industries 与 experience.industries）：",
	);
	for (const i of company.industries) {
		const level = i.parent === null ? 0 : (depth.get(i.parent) ?? 0) + 1;
		depth.set(i.name, level);
		lines.push(`${"  ".repeat(level + 1)}${i.name} ${i.main} / ${i.any}`);
	}
	lines.push(
		`入职前的经历 ${company.segments} 段，其中认出公司的 ${company.recognized} 段、有行业的 ${company.labelled} 段。`,
	);
	return lines;
}

function streamLine(s: StreamFact) {
	const span = s.first
		? `${s.first} 起，最近一期 ${s.latest?.start ?? ""}${s.latest?.end ? ` 至 ${s.latest.end}` : " 起至今"}`
		: "还没有记录";
	return `${s.stream}（${s.label}，${s.kind === "rating" ? "评级" : "状态"}${s.period ? `，${s.period}一期` : ""}）：${s.people} 人，${span}${valuesText(s)}`;
}

function valuesText(s: StreamFact) {
	if (s.values.length === 0) return "";
	return s.kind === "rating"
		? `；档从低到高 ${s.values.join("、")}`
		: `；取值有 ${s.values.join("、")}`;
}

/**
 * 端点答了，但没按约定作答：没提交搜索条件，或提交的条件校验之后什么都不剩。
 * 和连不上、报错分开，是因为只有这一种换个说法可能有用。
 */
export class UnansweredError extends Error {
	override name = "UnansweredError";
}

/**
 * 当前条件（`agent` 的 `base`）+ 之前的对话 + 一句话 → 提交检查录取的条件和说明，写进记录的就是它。
 *
 * 模型先捞说法、查名字、试跑、让候选人的经历读完（`agent-tools.ts`），再用 `submit`
 * 提交；没通过检查就改了再提交，通过了就停，最多调用 `AGENT_STEPS` 次模型。次数用完时最后
 * 一次提交即使没通过检查也用它：录取的那份里没有跑不了的条件，形状不合规的也已去掉。一次都
 * 没提交、或者录取的那份不算作答（提交检查判的），抛 `UnansweredError`。
 */
export async function understand(
	text: string,
	/** 预先写进提示词的活统计：有限取值几维的取值和人数，记录流的覆盖，公司的概况。 */
	{
		vocab,
		streams,
		company,
		history,
	}: {
		vocab: Vocabulary;
		streams: readonly StreamFact[];
		company: CompanyFacts;
		/** 这次找人之前几轮的经过（`search/history.ts`）；第一句话时为空。 */
		history: readonly string[];
	},
	agent: AgentTools,
	/** 这一次处理被取代时触发：不再往下调模型。 */
	abortSignal?: AbortSignal,
): Promise<Understood> {
	const result = await generateText({
		model: getModel(),
		// 重试在 `endpointPolicy` 里，以一次请求为单位
		maxRetries: 0,
		tools: agent.tools,
		toolChoice: "required",
		// 一步里的几次工具调用按顺序执行：读经历和试跑共用这一轮读了多少的那份状态
		toolCallConcurrency: 1,
		abortSignal,
		stopWhen: [isStepCount(AGENT_STEPS), agent.passed],
		prepareStep: ({ stepNumber, messages }) =>
			stepNumber === AGENT_STEPS - 1
				? {
						activeTools: [SUBMIT],
						toolChoice: { type: "tool", toolName: SUBMIT },
						messages: [...messages, { role: "user", content: LAST_STEP }],
					}
				: {},
		instructions: SYSTEM,
		prompt: [
			"取值",
			...VOCAB_HEADING.map(([key, heading]) => listed(heading, vocab[key])),
			...companyLines(company),
			"\n记录流",
			...(streams.length > 0 ? streams.map(streamLine) : ["（没有）"]),
			...(history.length > 0 ? ["\n之前的对话：", ...history] : []),
			// 停用是用户在 chip 上的操作，模型写不出也不必看见：它原样写回这一条，
			// 停用状态由 `understood` 从上一轮带回来
			`\n当前的条件表：${JSON.stringify(agent.base.map((c) => withOff(c, null)))}`,
			`\n这句话：${text}`,
		].join("\n"),
		// 同一句话每次写出同一组条件
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
	const answer = agent.answer();
	/*
	 * 写进错误消息的是停下的原因：`length` 是输出预算（含思考轨迹）用光了，`stop` 配上
	 * 一段正文是端点没理会必须调用工具。查日志的人直接看得到，不必再翻 SDK 的结构。
	 */
	if (!answer)
		throw new UnansweredError(
			`查询理解模型没有提交搜索条件：finishReason=${result.finishReason}，` +
				`text=${JSON.stringify(result.text.slice(0, 200))}`,
		);
	if (answer.unanswered) throw new UnansweredError(answer.unanswered);
	return answer.admitted;
}

/** 读一批经历的回答不合约定时，同一批最多再问几次。 */
const JUDGE_RETRIES = 1;

const judgeInput = z.object({
	fits: z.array(z.int()).meta({
		description: "这一批里符合的段的编号；一段都不符合就给空数组",
	}),
});
const judgeTool = tool({
	description: "交上这一批经历里符合的段的编号。",
	inputSchema: judgeInput,
});

/**
 * 读一批经历：一次单独的请求，只给这一批和每组的标签、判据（`READING`），交回符合的段的编号。
 * 回答不合约定（没交、交的编号不在这一批里）时同一批再问一次，还不行这一次读经历就失败：
 * 没交的按不算存，存错了没有机会重读，所以不收一份对不上号的回答。这不是没读懂 HR 的话，
 * 抛的是普通的错误，不是 `UnansweredError`。同时发出的请求数由 `READ_CONCURRENCY` 封顶。
 */
export const judgeSegments: Judge = (groups, abortSignal) =>
	readGate(async () => {
		const numbers = new Set(
			groups.flatMap((group) => group.segments.map((segment) => segment.n)),
		);
		for (let attempt = 0; ; attempt++) {
			const fits = await generateText({
				model: getModel(),
				maxRetries: 0,
				tools: { judge: judgeTool },
				toolChoice: { type: "tool", toolName: "judge" },
				abortSignal,
				instructions: READING,
				prompt: JSON.stringify(groups),
				// 同一批经历每次给出同样的结论
				temperature: 0,
				maxOutputTokens: MAX_OUTPUT_TOKENS,
			}).then(
				({ toolCalls }) =>
					judgeInput.safeParse(
						toolCalls.find((call) => call.toolName === "judge")?.input,
					).data?.fits,
				(error) => {
					// 必须调用工具的一步没有调用：和交了一份对不上号的一样，再问一次
					if (!ToolChoiceViolationError.isInstance(error)) throw error;
					return undefined;
				},
			);
			if (fits?.every((n) => numbers.has(n))) return [...new Set(fits)];
			if (attempt >= JUDGE_RETRIES)
				throw new Error(
					"读经历的模型没有按约定交结论：没交，或者交的编号不在这一批里",
				);
		}
	});
