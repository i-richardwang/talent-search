import { sql } from "drizzle-orm";
import {
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
import type { SearchDelta, SearchSpec } from "#/search/spec";

/*
 * 检索的匹配单元是**语义**，不是字符串：语料里每一串原文各存一个向量
 * （`phrase`），经历段按六路指向它们（`experience_phrase`）；查询里的每条要求
 * 先按向量召回候选说法，再由重排模型判定相关度
 * 过阈值判定。原文字段仍然原样保留——它们是证据，用户核对的是它们；
 * 向量只是找到它们的手段。六路里有两路（能力词、做过的事）不是原文，
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
 */
export const experience = pgTable(
	"experience",
	{
		id: serial("id").primaryKey(),
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
		seqL1: text("seq_l1").notNull().default(""),
		seqL2: text("seq_l2").notNull().default(""),
		seqL3: text("seq_l3").notNull().default(""),
		level: text("level").notNull().default(""),
		/** 外部：简历中该段公司的职责描述 */
		description: text("description").notNull().default(""),
		months: integer("months").notNull(),
	},
	(t) => [
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
 */
export const EMBED_DIM = 1024;

/**
 * 当前语料的嵌入空间身份证。ETL 每次整库重灌时只写一行；查询进程在第一次
 * 嵌入前核对 space/model/dimension，并用 canary 检查端点实际输出仍在同一空间。
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
 * 一段经历的六路语义：序列、岗位、部门 / 公司、简历描述，以及从简历描述里
 * 抽出来的能力词与做过的事。字段来源决定证据可信度（weights.ts 的
 * ROUTE_WEIGHTS），所以各路**各自**嵌一个向量，不混成一个：混了之后
 * 「登记字段说他做过」和「简历里提过一句」在向量空间里就分不开；
 * 序列和岗位也不拼在一起——短文本的相似度最锐利，「算法」对「算法工程师」
 * 是一回事，对「技术 · 算法 · 推荐 / 高级算法工程师」这一长串就被稀释了。
 *
 * `skill` 与 `did` 是模型从 `description` 里读出来的（`etl/extract.py`）：
 * 一整段几百字的自述池化成一个向量分不清主语和重点，「配合算法团队」会和
 * 「算法」相近；抽成短说法之后重排模型判得准。它们的**来源**仍是自述，所以
 * 和 `description` 同一档强度。`did` 的说法只是领域（「推荐系统」），参与
 * 方式存在边上（下面 `involvement` 列）。
 */
const ROUTES = ["seq", "title", "org", "description", "skill", "did"] as const;
export type Route = (typeof ROUTES)[number];
/**
 * 文本不在经历行上的那两路。原文四路命中后回表就能取到被比较的那串字；这两路
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
 * 换来的是一半的扫描量。这张表**不建向量索引**：召回要的是「相似度过
 * 下限的全部说法」，而 HNSW 回答的是「最近的 k 个」，两者不是一个问题；
 * 两万行的精确扫描本机是几十毫秒。语料涨一个数量级再上 HNSW 加迭代扫描
 * （pgvector 0.8+），到时候改的是这里和 phrases.ts 的召回 SQL，排名与分面不动。
 */
export const phrase = pgTable("phrase", {
	id: serial("id").primaryKey(),
	text: text("text").notNull().unique(),
	embedding: halfvec("embedding", { dimensions: EMBED_DIM }).notNull(),
});

/**
 * 一段经历在各路上说了哪些字。原文四路一段各最多一行：`seq`（序列三级）、
 * `title`（岗位）、`org`（部门路径或公司名）、`description`（简历描述）；
 * 抽取的两路一段可以有多行：`skill` 一个能力词一行，`did` 一件事一行。
 * 哪一路是空的就没有那一行——不嵌空串，也不存零向量。
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
		 * 只有 `did` 那一路带：这件事是从零搭建还是参与执行。它是证据行上的
		 * 前缀（「从零搭建 · 推荐系统」），不是说法的一部分：说法进向量、比
		 * 相关度，参与方式不进。它只有几种取值，拼进说法的话同一种参与方式
		 * 的任何领域在重排模型眼里都相近，「从零搭建 · 风险商家审核平台」会
		 * 命中「从零搭建推荐系统」。取值收窄在 `etl/extract.py` 的 `conform`，
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
 * 语料重灌时 phrase 表 truncate 会把它级联清空——分数是对旧 id 打的。
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
 *    增删几枚条件，而模型读错一个词的时候，那几枚条件里没有一枚说得清哪儿错了。
 * 2. **理解的结果是记录，不是缓存。** 同一条 `/s/:id` 永远问的是同一个问题
 *    （同一句原话、同一份 SearchSpec）；名单本身跟着语料和时间走，本来就该走——
 *    可复现的是条件，不是那批人。「问题不变」由「这一行是不可变的」保证，
 *    不由「凑巧没人再调模型」保证。想重新理解，就派生一条新记录。
 * 3. **改条件留得下痕迹。** 每次改条件都派生一条新记录，同一条链上于是躺着
 *    「模型判成必须、人改成加分」这类修正的前后两份——链头是哪一条由
 *    `root_turn_id` 说。这是这个产品唯一能自己产出的模型评估数据，写进 URL
 *    就等于每次导航扔一次。
 *
 * 这张表**只 INSERT**，唯一的例外是把 `delta` / `spec` 从 null 补成理解结果。
 * 这一条由应用代码保证；库负责输入完整性与链关系。
 */
export const searchTurn = pgTable(
	"search_turn",
	{
		id: text("id").primaryKey(),
		/**
		 * 这条链的头。一次找人任务会派生出一串记录（加条件、改强度、重新理解），
		 * 它们共享同一个 root——「最近搜索」按它去重，一个任务只出现一次，
		 * 并且停在它最后的样子上。
		 */
		rootTurnId: text("root_turn_id").notNull(),
		/**
		 * 这条查询在问的那句话。**一条查询的门面**：工作台顶上显示的是它，
		 * 「最近搜索」里认出「这是我搜过的那句」靠的也是它，改一枚条件时
		 * 原样传给下一条——问的是什么没变，只是读法调了一下。
		 *
		 * 链头那条**改条件**的记录没有原话：它不是由一句话问出来的（工作台里的
		 * 每一次改条件都挂在某条原话下面，所以只有从零态直接提交一份条件时才会
		 * 出现这种记录）。
		 */
		rawText: text("raw_text"),
		/**
		 * 这句原话自己的理解。降级与否记在这里，界面据此决定给不给「重新理解」。
		 *
		 * **null 表示「还没理解」**：整句提交时先落一行
		 * 只有 `raw_text` 的记录（一次 INSERT，毫秒级），页面立刻就能进工作台，
		 * 模型那一跳在工作台里就地完成再把这一列补上。没有第二个状态列——
		 * 「有没有理解过」这件事由这一列自己回答，不需要一个会卡在中间态的枚举。
		 */
		delta: jsonb("delta").$type<SearchDelta>(),
		/**
		 * 查询的完整不可变快照。证据、原话产生的结构化范围和未生效提示都在这里；
		 * URL 只保存查看结果的临时状态，不保存查询含义。
		 */
		spec: jsonb("spec").$type<SearchSpec>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/*
		 * 待理解的记录**只有**一句原话；落定的记录必然有 spec。理解产物
		 * （delta）不能凭空存在，也不能少了被理解的那句话。
		 */
		check(
			"search_turn_state",
			sql`(
					${t.spec} is null and ${t.rawText} is not null and ${t.delta} is null
				) or (
					${t.spec} is not null and (
						${t.delta} is null or ${t.rawText} is not null
					)
				)`,
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
