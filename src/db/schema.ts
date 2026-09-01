import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgTable,
	serial,
	text,
	timestamp,
	unique,
} from "drizzle-orm/pg-core";
import type { IntentFilters } from "#/search/intent";
import type { Chip } from "#/search/parse";

/*
 * 中文检索一律走 pg_trgm 的 ILIKE：Postgres 的 to_tsvector 不切中文词，
 * 整句会变成一个 token，全文索引在这里没有意义。
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
		 * 检索是 `ilike '%词%'`（中文没法用 to_tsvector，见 AGENTS.md），
		 * 这一组 GIN trgm 索引是它唯一能走的加速路径。
		 *
		 * **它有一条写死在 pg_trgm 里的天花板：三字符。** 两个汉字切不出任何
		 * trigram，于是 2 字概念词——恰好是最常见的那一档——必然顺扫。
		 * 本机 32136 段实测：`%渠道运营%` 走索引 0.63ms，`%风控%` 顺扫 5.9ms，
		 * `%算法%` 顺扫 14.9ms；整条检索 70~125ms，现在完全够用。
		 *
		 * 所以这组索引不是「中文检索解决了」，是「长词快、短词靠表小」。语料
		 * 涨一个数量级之后，短词 × 七个字段的顺扫就是墙，那时要换的是中文双字
		 * 索引（pg_bigm）或者真正的分词器，不是更大的机器。现在不预埋：
		 * 表 24MB，这组索引已经 14MB，为一个还没到的规模再加一套是纯负债。
		 */
		index("experience_desc_trgm").using(
			"gin",
			sql`${t.description} gin_trgm_ops`,
		),
		index("experience_path_trgm").using("gin", sql`${t.orgPath} gin_trgm_ops`),
		index("experience_title_trgm").using("gin", sql`${t.title} gin_trgm_ops`),
		index("experience_org_trgm").using("gin", sql`${t.org} gin_trgm_ops`),
		/*
		 * 序列三级也要 trgm，尽管 experience_seq 那个 btree 已经在了。
		 *
		 * 命中判定是**七个字段**的 OR（`ROUTE_FIELDS` 展开的那七个），而 OR 里只要有
		 * **一个字段**不可索引，整条 OR 就退化成顺扫——也就是说少了这三个索引，
		 * 上面四个 trgm 一次都用不上。失效的单位是字段，不是路；完整索引下的
		 * 执行计划应使用 BitmapOr，缺字段索引时会退化为 Seq Scan。
		 * btree 那个是给 seq_l1 = ? 的等值筛选用的，两者不能互相替代。
		 */
		index("experience_seq1_trgm").using("gin", sql`${t.seqL1} gin_trgm_ops`),
		index("experience_seq2_trgm").using("gin", sql`${t.seqL2} gin_trgm_ops`),
		index("experience_seq3_trgm").using("gin", sql`${t.seqL3} gin_trgm_ops`),
		index("experience_seq").on(t.seqL1, t.seqL2),
	],
);

export type Employee = typeof employee.$inferSelect;
export type Experience = typeof experience.$inferSelect;

/**
 * 一次「我要找什么人」的记录。**查询的身份就是这一行**，URL 里的 `/s/:id`
 * 指的是它，不是一串可以被任意改写的检索参数。
 *
 * 这张表存在的理由，是把三件本来会互相锁死的事拆开：
 *
 * 1. **原话留得住。** `raw_text` 是用户自己敲的那句话。把它丢掉（比如只往
 *    URL 里写理解后的 chips），「重新理解」就永远做不到了——没有输入可重放，
 *    模型改好了也惠及不到任何一条已经存在的查询。
 * 2. **理解的结果是记录，不是缓存。** 同一条 `/s/:id` 永远问的是同一个问题
 *    （同一句原话、同一份 chips）；名单本身跟着语料和时间走，本来就该走——
 *    可复现的是条件，不是那批人。「问题不变」由「这一行是不可变的」保证，
 *    不由「凑巧没人再调模型」保证。想重新理解，就派生一条新记录。
 * 3. **改条件留得下痕迹。** 每次改 chip 都派生一条挂在 `parent_turn_id` 上的
 *    新记录，于是「模型判成必须、人改成加分」这类修正会自己长在库里。
 *    这是这个产品唯一能自己产出的模型评估数据，写进 URL 就等于每次导航扔一次。
 *
 * 这张表**只 INSERT**，唯一的例外是把 `chips` 从 null 补成理解结果（见下）。
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
		 * 点词汇表或直接改 chip 的记录已经带着完整 chips，不需要 base。
		 */
		baseTurnId: text("base_turn_id"),
		/**
		 * 用户敲的原话。null 表示这条不是从一句话来的（点了词汇表，或者只改了
		 * 一枚 chip）——那种记录没有可重新理解的输入，界面上也不给那个入口。
		 */
		rawText: text("raw_text"),
		/**
		 * 理解结果，也是这次检索真正用的条件。
		 *
		 * **null 表示「还没理解」**，是这张表唯一的可变位：整句提交时先落一行
		 * 只有 `raw_text` 的记录（一次 INSERT，毫秒级），页面立刻就能进工作台，
		 * 模型那一跳在工作台里就地完成再把这一列补上。没有第二个状态列——
		 * 「有没有理解过」这件事由这一列自己回答，不需要一个会卡在中间态的枚举。
		 */
		chips: jsonb("chips").$type<Chip[]>(),
		/** 模型从句子里认出来的筛选。理解之后一次性播进 URL，此后以 URL 为准。 */
		filters: jsonb("filters").$type<IntentFilters>().notNull().default({}),
		/**
		 * 这次理解降级了没有：模型不可用、或者没给出任何可用条件，于是退回了
		 * 本地规则解析。规则解析读不出语气，「不要实习」会变成必须词——
		 * 结果是错的而界面上看不出来，所以这一位必须存下来并且明说。
		 */
		degraded: boolean("degraded").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		/*
		 * 一条记录至少要有一样东西说明它想找什么：整句来的有 raw_text，
		 * 点词汇表或改 chip 来的有 chips。两样都空的记录打开就是一个
		 * 空工作台，而它会一直挂在「最近搜索」里。
		 */
		check(
			"search_turn_has_input",
			sql`${t.rawText} is not null or ${t.chips} is not null`,
		),
		check(
			"search_turn_base_requires_text",
			sql`${t.baseTurnId} is null or ${t.rawText} is not null`,
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
