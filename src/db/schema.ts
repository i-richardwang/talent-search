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

export type CompanyMeta = {
	company_tag?: string;
	industry?: string;
	nature?: string;
};

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

/** 原始字段由同步写，推断序列与派生版本由派生任务写。`key` 是原始内容的数据库生成摘要。 */
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
		endDate: date("end_date"),
		/** 内部：末级部门；外部：公司名 */
		org: text("org").notNull().default(""),
		/** 内部：段起始日有效的完整部门路径 */
		orgPath: text("org_path").notNull().default(""),
		/** 外部：公司档、行业、性质等规范字段 */
		orgMeta: jsonb("org_meta").$type<CompanyMeta>(),
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
		description: text("description").notNull().default(""),
		months: integer("months").notNull(),
		derivedIdentity: text("derived_identity"),
		derivedAt: timestamp("derived_at", { withTimezone: true }),
	},
	(t) => [
		index("experience_derived").on(t.derivedIdentity),
		check("experience_kind_valid", sql`${t.kind} in ('internal', 'external')`),
		check("experience_months_positive", sql`${t.months} > 0`),
		check(
			"experience_dates_ordered",
			sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
		),
		index("experience_emp").on(t.empId, t.startDate),
	],
);

export type Employee = typeof employee.$inferSelect;
export type Experience = typeof experience.$inferSelect;

/** 嵌入维数的唯一来源；更换维数必须同时更换嵌入空间。 */
export const EMBED_DIM = 1024;

/** 当前语料的唯一嵌入空间；查询同时核对元数据与 canary。 */
export const embeddingSpace = pgTable("embedding_space", {
	spaceId: text("space_id").primaryKey(),
	model: text("model").notNull(),
	dimension: integer("dimension").notNull(),
	canaryText: text("canary_text").notNull(),
	canaryEmbedding: halfvec("canary_embedding", {
		dimensions: EMBED_DIM,
	}).notNull(),
});

/** 跨语料保留的向量缓存；文本用 sha256 键入，避免超长 btree 索引项。 */
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

/** 聊天完成缓存。identity 包含模型、提示词和回答 schema；payload 保留未收窄原话。 */
export const completionCache = pgTable(
	"completion_cache",
	{
		identity: text("identity").notNull(),
		textSha: text("text_sha").notNull(),
		payload: jsonb("payload").notNull(),
	},
	(t) => [primaryKey({ columns: [t.identity, t.textSha] })],
);

export const TASK_KINDS = ["sync", "derive", "review"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** 一次语料任务的持久记录；实时运行状态由会话锁判断。 */
export const taskRun = pgTable("task_run", {
	id: serial("id").primaryKey(),
	kind: text("kind", { enum: TASK_KINDS }).notNull(),
	/** 同步所用适配器的显示名；其余两种任务为空串 */
	source: text("source").notNull().default(""),
	startedAt: timestamp("started_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	finishedAt: timestamp("finished_at", { withTimezone: true }),
	log: text("log").array().notNull(),
	/** 成功与中断均为 null；中断由未完成记录和会话锁共同判断。 */
	error: text("error"),
});

/** 能力词的标准写法与宽细归属。词表跨语料保留，不改经历上的原始说法。 */
export const skillTerm = pgTable(
	"skill_term",
	{
		word: text("word").primaryKey(),
		canonical: text("canonical").notNull(),
		parent: text("parent").references((): AnyPgColumn => skillTerm.word),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
		/** `model:<模型名>` 或 `agent:<外部判定方>`。 */
		judge: text("judge").notNull(),
	},
	(t) => [
		check(
			"skill_term_parent_on_canonical_1",
			sql`${t.parent} is null or (${t.canonical} = ${t.word} and ${t.parent} <> ${t.word})`,
		),
	],
);

export const GROUP_KINDS = ["group", "gloss"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** 待判队列。归并组写 skill_term，释义组写 phrase_gloss；生效或过期后删除。 */
export const reviewGroup = pgTable(
	"review_group",
	{
		id: serial("id").primaryKey(),
		kind: text("kind", { enum: GROUP_KINDS }).notNull(),
		/** 收集与判定这组词所依据的 GUIDE 与回答形状摘要。 */
		guideIdentity: text("guide_identity").notNull(),
		/** 收集时的 `[{ word, people }]`。 */
		words: jsonb("words").$type<{ word: string; people: number }[]>().notNull(),
		collectedAt: timestamp("collected_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		judge: text("judge"),
		/** 判定原话；生效时执行领域收窄。 */
		judgment: jsonb("judgment"),
	},
	(t) => [
		check(
			"review_group_judged_1",
			sql`(${t.judge} is null) = (${t.judgment} is null)`,
		),
	],
);

/** 短说法的释义。按文本跨语料保留，更新时清理对应的重排缓存。 */
export const phraseGloss = pgTable("phrase_gloss", {
	text: text("text").primaryKey(),
	gloss: text("gloss").notNull(),
	writtenAt: timestamp("written_at", { withTimezone: true }).notNull(),
	judge: text("judge").notNull(),
	/** 释义标准的摘要；标准变化后旧释义重新收集。 */
	guideIdentity: text("guide_identity").notNull(),
});

/** 经历的六类独立说法；字段来源决定证据可信度。 */
const ROUTES = ["seq", "title", "org", "description", "skill", "did"] as const;
export type Route = (typeof ROUTES)[number];
/** 文本只存在 phrase 表中的两类说法。 */
export const EXTRACTED_ROUTES = [
	"skill",
	"did",
] as const satisfies readonly Route[];

/** 去重后的说法及其半精度向量。 */
export const phrase = pgTable("phrase", {
	id: serial("id").primaryKey(),
	text: text("text").notNull().unique(),
	embedding: halfvec("embedding", { dimensions: EMBED_DIM }).notNull(),
});

/** 经历到说法的边；同一段同一路可指向多条去重说法。 */
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
		/** did 的展示前缀，不参与向量与相关度。 */
		involvement: text("involvement"),
	},
	(t) => [
		primaryKey({ columns: [t.experienceId, t.route, t.phraseId] }),
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

/** 按重排空间缓存查询词与候选说法的相关度。 */
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

/** 不可变查询记录；仅待理解记录允许把 spec 从 null 补全一次。 */
export const searchTurn = pgTable(
	"search_turn",
	{
		id: text("id").primaryKey(),
		/** 同一次找人任务的链头，用于最近搜索去重。 */
		rootTurnId: text("root_turn_id").notNull(),
		/** 用户原话；直接提交完整条件时可以为空。 */
		rawText: text("raw_text"),
		/** 查询条件快照；null 表示仍待理解。 */
		spec: jsonb("spec").$type<SearchSpec>(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"search_turn_state",
			sql`${t.spec} is not null or ${t.rawText} is not null`,
		),
		foreignKey({
			name: "search_turn_root",
			columns: [t.rootTurnId],
			foreignColumns: [t.id],
		}).onDelete("cascade"),
		index("search_turn_recent").on(t.rootTurnId, t.createdAt),
	],
);

export type SearchTurn = typeof searchTurn.$inferSelect;
