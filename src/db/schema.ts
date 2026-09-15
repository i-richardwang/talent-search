import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	check,
	date,
	foreignKey,
	halfvec,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	real,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import type { SearchSpec } from "#/search/spec";

/*
 * 检索的匹配单元是**语义**，不是字符串：语料里每一串原文各存一个向量
 * （`phrase`），经历段按六路指向它们（`experience_phrase`）；查询里的每条要求
 * 先按向量召回候选说法，再由重排模型判定相关度
 * 过阈值判定。原文字段仍然原样保留——它们是证据，用户核对的是它们；
 * 向量只是找到它们的手段。六路里有两类（能力词、做过的事）不是原文，
 * 是模型对入职前简历描述的读法，它们同样只指回那一段经历。
 */

/** 外部段的公司规范字段，来自工作经历表。只存时间轴上真正显示的三项。 */
export type CompanyMeta = {
	company_tag?: string;
	industry?: string;
	nature?: string;
};

/** 员工。一人一行，只放当前状态与展示、过滤要用的字段。 */
export const employee = pgTable("employee", {
	empId: text("emp_id").primaryKey(),
	name: text("name").notNull(),
	curDept: text("cur_dept").notNull().default(""),
	curTitle: text("cur_title").notNull().default(""),
	curSeqL1: text("cur_seq_l1").notNull().default(""),
	curSeqL2: text("cur_seq_l2").notNull().default(""),
	curSeqL3: text("cur_seq_l3").notNull().default(""),
	curLevel: text("cur_level").notNull().default(""),
	hireDate: date("hire_date"),
	educationLevel: text("education_level").notNull().default(""),
	school: text("school").notNull().default(""),
	recruitment: text("recruitment").notNull().default(""),
});

/**
 * 经历段。在职（internal）与入职前（external）同一张表，靠 kind 区分，
 * 搜索天然跨两者。
 *
 * 一行分两半。**原始的一半**由同步写（`src/corpus/sync.ts`）：数据源给的字段经
 * 切段校验之后的样子。**派生的一半**由派生任务写（`src/corpus/derive.ts`）：
 * 对齐到的序列 `seq_inferred_*`，以及说明「派生到哪一版了」的 `derived_*`。
 *
 * **段的身份是内容**（`key`）：原始那一半所有列的摘要，由库自己算，同步按它
 * 认「这一段还在不在」。表达式只用不变的函数（生成列的要求）：日期按天数算，
 * 日期转文字和 `concat_ws` 都依赖会话设置，不算不变。于是同步只增删变了的段，没变的段连同它的派生结果原样
 * 留下——派生是几十分钟的模型调用，不能每次同步都重来。描述改了一个字就是新段，
 * 旧段连同它的说法边一起删掉，没有「改了但没重新派生」这种半旧不新的行。
 *
 * `derived_identity` 是派生所依赖的一切的摘要（抽取与对齐的提示词、嵌入空间；
 * 见 `derive.ts`）。它和当下的身份不相等的段就是待派生的段，改一次提示词等于
 * 全部待派生，不用人去清什么。
 */
export const experience = pgTable(
	"experience",
	{
		id: serial("id").primaryKey(),
		key: text("key")
			.notNull()
			.unique()
			.generatedAlwaysAs(
				sql`md5(emp_id || E'\\x1f' || kind || E'\\x1f' || (start_date - date '1970-01-01')::text || E'\\x1f' || coalesce((end_date - date '1970-01-01')::text, '') || E'\\x1f' || org || E'\\x1f' || org_path || E'\\x1f' || coalesce(org_meta::text, '') || E'\\x1f' || title || E'\\x1f' || seq_l1 || E'\\x1f' || seq_l2 || E'\\x1f' || seq_l3 || E'\\x1f' || level || E'\\x1f' || description)`,
			),
		empId: text("emp_id")
			.notNull()
			.references(() => employee.empId, { onDelete: "cascade" }),
		kind: text("kind", { enum: ["internal", "external"] }).notNull(),
		startDate: date("start_date").notNull(),
		/** 为空表示至今 */
		endDate: date("end_date"),
		/** 内部：末级部门；外部：公司名 */
		org: text("org").notNull().default(""),
		/** 内部：段起始日有效的完整部门路径 */
		orgPath: text("org_path").notNull().default(""),
		/** 外部：公司档、行业、性质等规范字段 */
		orgMeta: jsonb("org_meta").$type<CompanyMeta>(),
		/** 岗位名，原始写法，不改写 */
		title: text("title").notNull().default(""),
		/** 内部：HR 登记的序列三级。外部段这三列永远是空——登记值不和推断值混在一列 */
		seqL1: text("seq_l1").notNull().default(""),
		seqL2: text("seq_l2").notNull().default(""),
		seqL3: text("seq_l3").notNull().default(""),
		/**
		 * 外部：模型按岗位名、公司名与描述对到公司序列树上的一对一级二级
		 * （`src/corpus/align.ts`），两列要么都有要么都空。只有序列筛选读它（search.ts 的
		 * `FACT_COLUMNS`：登记的优先，没有才读这两列），人页上标「按岗位名对齐」；
		 * 不进 `seq` 那一类——那一类按受控强度打分，推断混进去就和登记分不开了。
		 */
		seqInferredL1: text("seq_inferred_l1").notNull().default(""),
		seqInferredL2: text("seq_inferred_l2").notNull().default(""),
		level: text("level").notNull().default(""),
		/** 外部：简历中该段公司的职责描述 */
		description: text("description").notNull().default(""),
		months: integer("months").notNull(),
		/** 派生到了哪一版；null 是还没派生过 */
		derivedIdentity: text("derived_identity"),
		derivedAt: timestamp("derived_at", { withTimezone: true }),
	},
	(t) => [
		// 派生任务每一轮问的都是「哪些段还不是这一版」
		index("experience_derived").on(t.derivedIdentity),
		check("experience_kind_valid", sql`${t.kind} in ('internal', 'external')`),
		check("experience_months_positive", sql`${t.months} > 0`),
		check(
			"experience_dates_ordered",
			sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
		),
		/*
		 * 这张表只建一个索引：按人取时间线。语义命中不走它（见 phrase /
		 * experience_phrase），其余谓词一律顺扫——三万段一次几毫秒。
		 *
		 * 序列筛选尤其不建：它下推出去的是 `seq_l1 || chr(1) || seq_l2 in (...)`
		 * 一个表达式（身份得和 `dimensions.ts` 的 `id()` 是同一个字符串），而
		 * `(seq_l1, seq_l2)` 上的 btree 回答不了表达式上的等值——建了也只是一张
		 * 没有读者的索引，写入时照样维护。
		 */
		index("experience_emp").on(t.empId, t.startDate),
	],
);

export type Employee = typeof employee.$inferSelect;
export type Experience = typeof experience.$inferSelect;

/**
 * 向量的维数。它是嵌入空间的属性，不是产品常量；换空间就要改这里并整库重灌。
 *
 * **全库唯一的一处。** 灌库侧和查询侧在同一个进程里，都从这里取值，没有第二个
 * 地方声明它，也没有必须与它保持一致的环境变量。
 */
export const EMBED_DIM = 1024;

/**
 * 当前语料的嵌入空间身份证，只有一行。派生任务在第一次嵌入前写它、换了嵌入
 * 空间时重写它（`src/corpus/derive.ts`）；查询进程在第一次嵌入前核对
 * space/model/dimension，并用 canary 检查端点实际输出仍在同一空间。
 */
export const embeddingSpace = pgTable("embedding_space", {
	spaceId: text("space_id").primaryKey(),
	model: text("model").notNull(),
	dimension: integer("dimension").notNull(),
	canaryText: text("canary_text").notNull(),
	canaryEmbedding: halfvec("canary_embedding", {
		dimensions: EMBED_DIM,
	}).notNull(),
});

/**
 * 端点算过的向量，按（嵌入空间、模型、文本）留着。
 *
 * 同一个模型对同一串字的向量是确定的，所以这张表可以永久留着：重置语料、重跑
 * 灌库都不必再打一次端点，一份语料几万种说法只在第一次出去过。它记的是**关于
 * 文本的事实**，不是语料的一部分：换嵌入空间时清的是 `phrase`，不是它，
 * 和 `skill_term` 同一个性质。
 *
 * 键是文本的 sha256 而不是文本本身：简历描述整段进说法表，几千字一条的有的是，
 * 而 btree 索引项过长会直接写不进去。文本不另存一份——查它的人手里就有原文。
 */
export const embeddingCache = pgTable(
	"embedding_cache",
	{
		spaceId: text("space_id").notNull(),
		model: text("model").notNull(),
		textSha: text("text_sha").notNull(),
		embedding: halfvec("embedding", { dimensions: EMBED_DIM }).notNull(),
	},
	(t) => [primaryKey({ columns: [t.spaceId, t.model, t.textSha] })],
);

/**
 * 聊天端点回过的话，按（提示词身份、文本）留着。抽取、序列对齐、能力词整理
 * 三处共用（`src/server/chat.ts`）。
 *
 * `identity` 是模型名、系统提示词与 schema 的摘要：会改变回答的东西都在键里，
 * 改了提示词（含对齐提示词里列出的那棵序列树）旧回答自然失效，不用人记得换
 * 什么身份。存的是**模型的原话**，收窄在读出时做，所以改收窄规则不动这张表。
 */
export const completionCache = pgTable(
	"completion_cache",
	{
		identity: text("identity").notNull(),
		textSha: text("text_sha").notNull(),
		payload: jsonb("payload").notNull(),
	},
	(t) => [primaryKey({ columns: [t.identity, t.textSha] })],
);

/** 语料侧的三种任务。同步读数据源；派生问模型、嵌入、连边；整理维护能力词词表。 */
export const TASK_KINDS = ["sync", "derive", "review"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/**
 * 语料侧任务的一次运行。同步是命令行跑的脚本，派生和整理是应用进程里的后台
 * 任务（`src/server/jobs.ts`），三者都像查询记录一样落在库里：任务台 `/tasks`
 * 上「现在跑到哪一步、上一次是什么时候、为什么失败」都只有这张表回答得了。
 *
 * `log` 就是命令行里会滚过去的那些行（拒绝了几段、合并了哪些写法、各表几行）。
 * 不另存一份计数：那些数就在最后几行里，两份表示迟早对不上。任务台不把它当页面
 * 内容，只在打开某一次的日志时单取（`src/server/tasks.ts` 的 `taskLog`）。
 *
 * `finished_at is null` 只说明**这一行没写完**，它分不出「正在跑」和「跑到一半
 * 进程没了」。那件事不在这张表里：谁活着是连接的属性，问那把咨询锁
 * （`src/corpus/session.ts` 的 `corpusSessionActive`）。两件事各有各的出处，于是
 * 没有一个要靠人事后来对齐的中间状态。
 */
export const taskRun = pgTable("task_run", {
	id: serial("id").primaryKey(),
	kind: text("kind", { enum: TASK_KINDS }).notNull(),
	/** 同步：读的是哪个适配器（`TALENT_SOURCE`）；其余两种是空串 */
	source: text("source").notNull().default(""),
	startedAt: timestamp("started_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	finishedAt: timestamp("finished_at", { withTimezone: true }),
	log: text("log").array().notNull(),
	/** 失败原因；成功的那一行是 null，中断的那一行也是——它根本没跑到写这一列 */
	error: text("error"),
});

/**
 * 能力词的词表：每个词的标准写法，和标准词属于哪个更宽的词。整理任务定期写它
 * （`src/corpus/vocabulary.ts`）。
 *
 * 能力词是模型从简历里抽出来的开放词表。同一项能力有多种写法，招聘的人要的粗细
 * 又是当场定的：搜「数据分析」要看到做过各种数据分析的人，搜「销售数据分析」只要
 * 销售那一种。细的能聚成粗的，粗的还原不成细的，所以词表把两件事分开记：
 *
 * - `canonical`：这个词的标准写法。**同一件事的不同写法**在筛选栏里合成标准词那
 *   一项；人身上的边不动，仍是简历里的原话，检索和证据用的也是原话。等于 `word`
 *   表示它自己就是标准词。
 * - `parent`：标准词属于哪个更宽的词（「销售数据分析」属于「数据分析」）。具体的词
 *   原样留在人身上，只多这一条归属；检索沿它往上聚（`src/search/search.ts` 的
 *   `FACT_COLUMNS.skills`）。更宽的词可以是语料里没人写过的，裁判起的名字，所以它
 *   自己也是一行——这一列指回本表，词表里因此没有指向不存在的词的归属。
 *
 * 归属只挂在标准词上（别名的归属就是它标准词的归属），且不指自己，由检查约束钉着；
 * 不成环由 `read` 抛错。一个词一周内只整理一次（`reviewed_at`）。
 *
 * 这张表记的是关于词的决定，不是语料：换数据源、换嵌入空间都不清它，决定累积。
 * 只有整理任务写它；查询侧沿它聚合，管理页 `/skills` 给人看机器认了什么。
 */
export const skillTerm = pgTable(
	"skill_term",
	{
		word: text("word").primaryKey(),
		canonical: text("canonical").notNull(),
		parent: text("parent").references((): AnyPgColumn => skillTerm.word),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
		/**
		 * 这条决定是谁判的：`model:<模型名>` 或 `agent:<外部裁判的名字>`
		 * （`src/corpus/vocabulary.ts` 的 `modelJudge` / `agentJudge`）。读者是管理页 `/skills`——
		 * 同一张表里有机器判的也有外部判的，看表的人得知道哪一条是谁下的结论。
		 */
		judge: text("judge").notNull(),
	},
	(t) => [
		check(
			"skill_term_parent_on_canonical_1",
			sql`${t.parent} is null or (${t.canonical} = ${t.word} and ${t.parent} <> ${t.word})`,
		),
	],
);

/** 整理出的题分两种：圈组（问同一件事与归属，写进 `skill_term`）和释义（写进 `phrase_gloss`）。 */
export const QUESTION_KINDS = ["group", "gloss"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/**
 * 整理任务出给裁判的题。两种：**圈组**是一组写法相近的能力词，问每个词和谁是同一件事、
 * 属于哪个更宽的词；**释义**是一组相近的短说法，请裁判给每个写一句它指什么。
 *
 * 这张表是**队列，不是记录**。一行从出题时出现，结算或过期时删除；决定的历史在
 * `skill_term` 和 `phrase_gloss`，过程的历史在 `task_run.log`，不再存第三份。
 *
 * 它存在的理由是把「判卷」这一步从整理任务里切出来（`src/corpus/questions.ts`）：
 * 出题和结算要拿语料的写者锁，判卷不碰语料，所以外部裁判交卷时不必等派生放锁。
 * 服务端出题、任一裁判答题、服务端结算——外部拿到的是一道道题，不是改表的权限。
 *
 * 题里的词一律平等，没有「中心词」：标准写法由结算按人数定，归属由裁判起名，两样都
 * 不需要题预先指定谁是谁。`judge` 与 `answer` 同生同灭：一行要么没人答过，要么两列都有。
 */
export const reviewQuestion = pgTable(
	"review_question",
	{
		id: serial("id").primaryKey(),
		kind: text("kind", { enum: QUESTION_KINDS }).notNull(),
		/** 这组词和各自的人数，出题那一刻的样子：`[{ word, people }]` */
		words: jsonb("words").$type<{ word: string; people: number }[]>().notNull(),
		askedAt: timestamp("asked_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		/** 谁答的，同 `skill_term.judge`；没人答过是 null */
		judge: text("judge"),
		/**
		 * 裁判的**原话**，形状同模型那份（`{ judgments: [...] }`）。收窄在结算时做，
		 * 和 `completion_cache` 一个道理：改收窄规则不动已经交上来的答卷。
		 */
		answer: jsonb("answer"),
	},
	(t) => [
		check(
			"review_question_answered_1",
			sql`(${t.judge} is null) = (${t.answer} is null)`,
		),
	],
);

/**
 * 短说法的释义：一句话说这个词指哪个行当里的什么活。
 *
 * 判定用的重排模型是按「一个词对一段话」训练的，判「四个字对四个字」时退化成数
 * 字面重合：「客户开发」对「服务端开发」给 91%，「前端开发」82%，而真正的「后端
 * 开发工程师」只有 66%。跟上一句释义之后它读的又是一段话了：同一批对上真实语料
 * 量过，对的全在 78% 以上、错的全在 47% 以下（`src/search/phrases.ts`）。
 *
 * 释义是**词的属性，不是段的属性**：「客户开发」指什么和谁的简历里写了它无关，所以
 * 不在抽取时写（抽取只看到一段），而由整理出题、裁判在一组相近的词旁边写——界线
 * 是对着邻居才写得出来的。按文本存、不指 `phrase` 行：它是语言知识，换数据源、换
 * 嵌入空间都不清，和 `skill_term` 一个待遇。只有整理任务的结算写它，写的同时清掉
 * 这条说法的分数缓存（`phrase_relevance`）——分数是按判定时读到的字打的。
 *
 * 写哪些说法由整理定（`src/corpus/gloss.ts`）：技能、做过的事、岗位名、序列名这四类
 * 短说法。整段简历原文本来就是一段话，部门路径答的是「待过哪儿」不是词义，都不写。
 */
export const phraseGloss = pgTable("phrase_gloss", {
	text: text("text").primaryKey(),
	gloss: text("gloss").notNull(),
	writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
	/** 谁写的，同 `skill_term.judge` */
	judge: text("judge").notNull(),
});

/**
 * 一段经历的六路语义：序列、岗位、部门 / 公司、简历描述，以及从简历描述里
 * 抽出来的能力词与做过的事。字段来源决定证据可信度（weights.ts 的
 * ROUTE_STRENGTH），所以各类**各自**嵌一个向量，不混成一个：混了之后
 * 「登记字段说他做过」和「简历里提过一句」在向量空间里就分不开；
 * 序列和岗位也不拼在一起——短文本的相似度最锐利，「算法」对「算法工程师」
 * 是一回事，对「技术 · 算法 · 推荐 / 高级算法工程师」这一长串就被稀释了。
 *
 * `skill` 与 `did` 是模型从 `description` 里读出来的（`src/corpus/extract.ts`）：
 * 一整段几百字的自述池化成一个向量分不清主语和重点，「配合算法团队」会和
 * 「算法」相近；抽成短说法之后重排模型判得准。它们的**来源**仍是自述，所以
 * 和 `description` 同一档强度；一段只有其中一种（`corpus/route-texts.ts`）：
 * 读过的段有 `skill` / `did`，没读过的段才有 `description`。`did` 的说法只是
 * 领域（「推荐系统」），参与方式存在边上（下面 `involvement` 列）。
 */
const ROUTES = ["seq", "title", "org", "description", "skill", "did"] as const;
export type Route = (typeof ROUTES)[number];
/**
 * 文本不在经历行上的那两类。其余四类命中后回表就能取到被比较的那串字；这两类
 * 的说法只存在 `phrase` 里，事实行得把文本一起带回来（search.ts 的 `phrase` 列）。
 */
export const EXTRACTED_ROUTES = [
	"skill",
	"did",
] as const satisfies readonly Route[];

/**
 * 语料里出现过的每一串**原文**及其向量。序列名、岗位名、部门路径、简历描述
 * 去重后各占一行——向量是文本的属性，不是经历段的属性：三万段经历只有两万种
 * 说法，同一串字嵌两遍既浪费端点，也让召回扫描多跑四倍。
 *
 * 用 halfvec：bge-m3 的向量存半精度对余弦相似度的影响在小数点后三位，
 * 换来的是一半的扫描量。这张表**暂不建向量索引**：几万行的精确扫描本机是几十
 * 毫秒，索引省不出可感的时间。召回问的是「余弦最近的 k 条」（`RECALL_TOP`），
 * 正是 HNSW 回答的问题，语料涨一个数量级时在这里加索引即可，phrases.ts 的
 * 召回 SQL 不用改形状，排名与分面不动。
 */
export const phrase = pgTable("phrase", {
	id: serial("id").primaryKey(),
	text: text("text").notNull().unique(),
	embedding: halfvec("embedding", { dimensions: EMBED_DIM }).notNull(),
});

/**
 * 一段经历在各类上说了哪些字。登记的三类一段各最多一行：`seq`（序列三级）、
 * `title`（岗位）、`org`（部门路径或公司名）；自述一段只有一种：读过的段
 * `skill` 一个能力词一行、`did` 一件事一行，没读过的段 `description` 一行。
 * 哪一类是空的就没有那一行——不嵌空串，也不存零向量。
 *
 * 主键因此是三列：同一段、同一路可以指向多条说法，但同一条说法不指两遍。
 */
export const experiencePhrase = pgTable(
	"experience_phrase",
	{
		experienceId: integer("experience_id")
			.notNull()
			.references(() => experience.id, { onDelete: "cascade" }),
		route: text("route", { enum: ROUTES }).notNull(),
		phraseId: integer("phrase_id")
			.notNull()
			.references(() => phrase.id, { onDelete: "cascade" }),
		/**
		 * 只有 `did` 那一类带：这件事是从零搭建还是参与执行。它是证据行上的
		 * 前缀（「从零搭建 · 推荐系统」），不是说法的一部分：说法进向量、比
		 * 相关度，参与方式不进。它只有几种取值，拼进说法的话同一种参与方式
		 * 的任何领域在重排模型眼里都相近，「从零搭建 · 风险商家审核平台」会
		 * 命中「从零搭建推荐系统」。取值收窄在 `src/corpus/extract.ts` 的 `conform`，
		 * 模型判断不出时为空、只显示领域；主键是（段、路、说法），一段对
		 * 同一个领域只留一条。
		 */
		involvement: text("involvement"),
	},
	(t) => [
		primaryKey({ columns: [t.experienceId, t.route, t.phraseId] }),
		// 命中的说法 → 说了它的经历段，取数就是沿这条边走
		index("experience_phrase_phrase").on(t.phraseId),
		/*
		 * 约束名带着路的数目：drizzle-kit push 不比较 check 的表达式，只认名字，
		 * 同名改表达式它会报「已应用」而库里还是旧的——发布时被旧约束报错才发现。
		 * 加一路就改名，push 才会先删旧的再建新的。
		 */
		check(
			"experience_phrase_route_valid_6",
			sql`${t.route} in ('seq', 'title', 'org', 'description', 'skill', 'did')`,
		),
	],
);

/**
 * 重排模型对「查询词 × 语料说法」打过的分（见 phrases.ts）。
 *
 * 同一个重排空间对同一对文本的分数是确定的，所以它是永久缓存：翻页、改筛选、
 * 换个人再搜同一个词，都不必再打端点。按空间身份键入，换模型行为时自然失效；
 * 还在语料里的说法 id 是稳定的；一条说法没人指了会被删（`corpus/derive.ts` 的
 * `commitBatch`），它的分数跟着级联清掉——语料里没有的说法，分数不是缓存是垃圾。
 * 换嵌入空间清 `phrase` 表时，这张表整个跟着空。
 * 只存打过分的对：召回没取到的说法不在这里，也不该在，那是召回的事。
 */
export const phraseRelevance = pgTable(
	"phrase_relevance",
	{
		space: text("space").notNull(),
		query: text("query").notNull(),
		phraseId: integer("phrase_id")
			.notNull()
			.references(() => phrase.id, { onDelete: "cascade" }),
		relevance: real("relevance").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.space, t.query, t.phraseId] }),
		check(
			"phrase_relevance_range",
			sql`${t.relevance} >= 0 and ${t.relevance} <= 1`,
		),
	],
);

/**
 * 一次「我要找什么人」的记录。**查询的身份就是这一行**，URL 里的 `/s/:id`
 * 指的是它，不是一串可以被任意改写的检索参数。
 *
 * 这张表存在的理由，是把三件本来会互相锁死的事拆开：
 *
 * 1. **原话留得住。** `raw_text` 是用户自己敲的那句话，也是工作台上唯一可以
 *    改写的查询表示。把它丢掉（比如只往 URL 里写理解后的条件），改问题就只剩
 *    增删几枚条件，而模型读错一个词的时候，那几枚条件里没有一个说得清哪儿错了。
 * 2. **理解的结果是记录，不是缓存。** 同一条 `/s/:id` 永远问的是同一个问题
 *    （同一句原话、同一份 SearchSpec）；名单本身跟着语料和时间走，本来就该走——
 *    可复现的是条件，不是那批人。「问题不变」由「这一行是不可变的」保证，
 *    不由「凑巧没人再调模型」保证。想换一种读法，就改写那句话派生一条新记录。
 * 3. **改条件留得下痕迹。** 每次改条件都派生一条新记录，同一条链上于是躺着
 *    「模型判成必须、人改成加分」这类修正的前后两份——链头是哪一条由
 *    `root_turn_id` 说。这是这个产品唯一能自己产出的模型评估数据，写进 URL
 *    就等于每次导航扔一次。
 *
 * 这张表**只 INSERT**，唯一的例外是把 `spec` 从 null 补成理解结果。
 * 这一条由应用代码保证；库负责输入完整性与链关系。
 */
export const searchTurn = pgTable(
	"search_turn",
	{
		id: text("id").primaryKey(),
		/**
		 * 这条链的头。一次找人任务会派生出一串记录（加条件、改强度、改写那句话），
		 * 它们共享同一个 root——「最近搜索」按它去重，一个任务只出现一次，
		 * 并且停在它最后的样子上。
		 */
		rootTurnId: text("root_turn_id").notNull(),
		/**
		 * 这条查询在问的那句话。**一条查询的标题**：工作台顶上显示的是它，
		 * 「最近搜索」里认出「这是我搜过的那句」靠的也是它，改一个条件时
		 * 原样传给下一条——问的是什么没变，只是读法调了一下。
		 *
		 * 链头那条**改条件**的记录没有原话：它不是由一句话问出来的（工作台里的
		 * 每一次改条件都挂在某条原话下面，所以只有从零态直接提交一份条件时才会
		 * 出现这种记录）。
		 */
		rawText: text("raw_text"),
		/**
		 * 查询的完整不可变快照：模型写出的那一串条件（`SearchSpec`）；
		 * URL 只保存查看结果的临时状态，不保存查询含义。
		 *
		 * **null 表示「还没理解」**：整句提交时先落一行只有 `raw_text` 的记录
		 * （一次 INSERT，毫秒级），页面立刻就能进工作台，模型那一跳在工作台里
		 * 就地完成再把这一列补上。没有第二个状态列——「有没有理解过」这件事由
		 * 这一列自己回答，不需要一个会卡在中间态的枚举。
		 */
		spec: jsonb("spec").$type<SearchSpec>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/* 待理解的记录必然有那句原话：没有原话就没有东西可理解。 */
		check(
			"search_turn_state",
			sql`${t.spec} is not null or ${t.rawText} is not null`,
		),
		/*
		 * **链的完整性由外键保证，不由应用代码保证。** 自引用：每一行的 root 必须
		 * 是一条真实存在的记录，链头那一行的 root 就是它自己——同一条 INSERT 里
		 * 成立，外键在语句结束时才检查，那时这一行已经在表里了。
		 *
		 * 写错的后果是「最近搜索」把同一次找人任务列成两行，或者列出一条指向
		 * 不存在的链头的记录，界面上都看不出异常——这种错必须在写入那一刻就
		 * 写不进去。
		 */
		foreignKey({
			name: "search_turn_root",
			columns: [t.rootTurnId],
			foreignColumns: [t.id],
		}).onDelete("cascade"),
		// 「最近搜索」：按 root 取每条链最新的那一条
		index("search_turn_recent").on(t.rootTurnId, t.createdAt),
	],
);

export type SearchTurn = typeof searchTurn.$inferSelect;
