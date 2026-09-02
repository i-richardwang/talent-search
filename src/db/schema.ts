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
	unique,
} from "drizzle-orm/pg-core";
import type { SearchDelta, SearchSpec } from "#/search/spec";

/*
 * 检索的匹配单元是**语义**，不是字符串：语料里每一串原文各存一个向量
 * （`phrase`），经历段按四路指向它们（`experience_phrase`）；查询里的每条要求
 * 先按向量召回候选说法，再由重排模型判定相关度
 * 过阈值判定。原文字段仍然原样保留——它们是证据，用户核对的是它们；
 * 向量只是找到它们的手段。
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
		index("experience_emp").on(t.empId, t.startDate),
		/*
		 * 语义命中不走这张表的索引（见 phrase / experience_phrase）。这里剩下的两个是
		 * 按人取时间线和按序列做等值筛选用的。公司名 / 学校名那两个精确条件
		 * 走 ILIKE 顺扫：三万段一次几毫秒，不值得为它们建索引。
		 */
		index("experience_seq").on(t.seqL1, t.seqL2),
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
 * 一段经历的四路语义：序列、岗位、部门 / 公司、简历描述。字段来源决定证据
 * 可信度（weights.ts 的 ROUTE_WEIGHTS），所以四路**各自**嵌一个向量，不混成
 * 一个：混了之后「登记字段说他做过」和「简历里提过一句」在向量空间里就分不开；
 * 序列和岗位也不拼在一起——短文本的相似度最锐利，「算法」对「算法工程师」
 * 是一回事，对「技术 · 算法 · 推荐 / 高级算法工程师」这一长串就被稀释了。
 */
export const ROUTES = ["seq", "title", "org", "description"] as const;
export type Route = (typeof ROUTES)[number];

/**
 * 语料里出现过的每一串**原文**及其向量。序列名、岗位名、部门路径、简历描述
 * 去重后各占一行——向量是文本的属性，不是经历段的属性：三万段经历只有两万种
 * 说法，同一串字嵌两遍既浪费端点，也让召回扫描多跑四倍。
 *
 * 用 halfvec：bge-m3 的向量存半精度对余弦相似度的影响在小数点后三位，
 * 换来的是一半的扫描量。这张表现在**没有向量索引**：召回要的是「相似度过
 * 地板的全部说法」，而 HNSW 回答的是「最近的 k 个」，两者不是一个问题；
 * 两万行的精确扫描本机是几十毫秒。语料涨一个数量级再上 HNSW 加迭代扫描
 * （pgvector 0.8+），到时候改的是这里和 phrases.ts 的召回 SQL，排名与分面不动。
 */
export const phrase = pgTable("phrase", {
	id: serial("id").primaryKey(),
	text: text("text").notNull().unique(),
	embedding: halfvec("embedding", { dimensions: EMBED_DIM }).notNull(),
});

/**
 * 一段经历在四路上各说了哪一串字。一段最多四行：`seq`（序列三级）、`title`
 * （岗位）、`org`（部门路径或公司名）、`description`（简历描述）。哪一路的
 * 原文是空的就没有那一行——不嵌空串，也不存零向量。
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
	},
	(t) => [
		primaryKey({ columns: [t.experienceId, t.route] }),
		// 命中的说法 → 说了它的经历段，取数就是沿这条边走
		index("experience_phrase_phrase").on(t.phraseId),
		check(
			"experience_phrase_route_valid",
			sql`${t.route} in ('seq', 'title', 'org', 'description')`,
		),
	],
);

/**
 * 重排模型对「查询词 × 语料说法」打过的分（见 phrases.ts）。
 *
 * 同一个重排空间对同一对文本的分数是确定的，所以它是永久缓存：翻页、改筛选、
 * 换个人再搜同一个词，都不必再打端点。按空间身份键入，换模型行为时自然失效；
 * 语料重灌时 phrase 表 truncate 会把它级联清空——分数是对旧 id 打的。
 * 只存打过分的对：召回没捞到的说法不在这里，也不该在，那是召回的事。
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
 * 1. **原话留得住。** `raw_text` 是用户自己敲的那句话。把它丢掉（比如只往
 *    URL 里写理解后的条件），「重新理解」就永远做不到了——没有输入可重放，
 *    模型改好了也惠及不到任何一条已经存在的查询。
 * 2. **理解的结果是记录，不是缓存。** 同一条 `/s/:id` 永远问的是同一个问题
 *    （同一句原话、同一份 SearchSpec）；名单本身跟着语料和时间走，本来就该走——
 *    可复现的是条件，不是那批人。「问题不变」由「这一行是不可变的」保证，
 *    不由「凑巧没人再调模型」保证。想重新理解，就派生一条新记录。
 * 3. **改条件留得下痕迹。** 每次改条件都派生一条挂在 `parent_turn_id` 上的
 *    新记录，于是「模型判成必须、人改成加分」这类修正会自己长在库里。
 *    这是这个产品唯一能自己产出的模型评估数据，写进 URL 就等于每次导航扔一次。
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
		/** 历史上的上一步。链头为 null；浏览器后退与最近搜索沿这条链工作。 */
		parentTurnId: text("parent_turn_id"),
		/**
		 * 这句原话理解完成后，要接在哪一份既有条件后面。
		 *
		 * 它和 `parent_turn_id` 回答两件不同的事：parent 是浏览器后退要回到的
		 * 上一步，base 是这句话的语义上下文。普通追加时两者相同；重新理解时
		 * parent 指向上一版理解，base 沿用上一版当时的上下文。把两者分开存，
		 * 连续重新理解多少次都不会把已经替换的条件带回来。
		 *
		 * 点词汇表或直接改条件的记录已经带着完整 spec，不需要 base。
		 */
		baseTurnId: text("base_turn_id"),
		/**
		 * 用户敲的原话。null 表示这条不是从一句话来的（点了词汇表，或者只改了
		 * 一个条件）——那种记录没有可重新理解的输入，界面上也不给那个入口。
		 */
		rawText: text("raw_text"),
		/**
		 * 纠正理解时用户补的那句说明（「算法指的是推荐算法」）。
		 *
		 * 它不是新查询，是**关于上一次理解的元信息**，所以不写进 raw_text——
		 * raw_text 永远是被理解的那句原话，链头展示、再次纠正都取它。理解时
		 * 这句说明连同上一版理解一起交给模型（`server/llm.ts`）；模型不可用而
		 * 退回规则解析时它被忽略（规则解析没有能力消化元信息），降级照常明说。
		 */
		note: text("note"),
		/**
		 * 这句原话自己的理解。它让重译能够精确替换这句，而不用从合并结果反推。
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
		check(
			"search_turn_state",
			sql`(
					${t.rawText} is null and ${t.delta} is null and ${t.spec} is not null
				) or (
					${t.rawText} is not null and (
						(${t.delta} is null and ${t.spec} is null) or
						(${t.delta} is not null and ${t.spec} is not null)
					)
				)`,
		),
		check(
			"search_turn_base_requires_text",
			sql`${t.baseTurnId} is null or ${t.rawText} is not null`,
		),
		// 纠正的对象是「对一句话的理解」，没有原话就没有可纠正的东西
		check(
			"search_turn_note_requires_text",
			sql`${t.note} is null or ${t.rawText} is not null`,
		),
		/*
		 * 自引用：链头这一行的 root 就是它自己。同一条 INSERT 里成立——外键在
		 * 语句结束时才检查，那时这一行已经在表里了。
		 */
		foreignKey({
			name: "search_turn_root",
			columns: [t.rootTurnId],
			foreignColumns: [t.id],
		}).onDelete("cascade"),
		/*
		 * **派生链的完整性由外键保证，不由应用代码保证。**
		 *
		 * 「我的 root 必须等于父亲的 root」是这条链唯一的不变量，而它正好是一条
		 * 复合外键：指向 `(id, root_turn_id)`，于是「父亲存在」和「跟父亲同一条链」
		 * 一起成立。写错的后果是「最近搜索」把同一次找人任务列成两行，界面上
		 * 看不出异常——这种错必须在写入那一刻就写不进去。
		 *
		 * 链头的 parent 为 null，复合外键遇 null 不检查，自然放行。
		 */
		unique("search_turn_id_root").on(t.id, t.rootTurnId),
		foreignKey({
			name: "search_turn_parent",
			columns: [t.parentTurnId, t.rootTurnId],
			foreignColumns: [t.id, t.rootTurnId],
		}).onDelete("cascade"),
		/* 语义基线必须和这条记录在同一条链上；null 表示从空条件开始。 */
		foreignKey({
			name: "search_turn_base",
			columns: [t.baseTurnId, t.rootTurnId],
			foreignColumns: [t.id, t.rootTurnId],
		}).onDelete("cascade"),
		// 「最近搜索」：按 root 取每条链最新的那一条
		index("search_turn_recent").on(t.rootTurnId, t.createdAt),
	],
);

export type SearchTurn = typeof searchTurn.$inferSelect;
