import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	date,
	doublePrecision,
	foreignKey,
	halfvec,
	index,
	integer,
	jsonb,
	pgTable,
	primaryKey,
	serial,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { TASK_KINDS } from "#/lib/task";
import type { TurnNotes } from "#/search/intent";
import type { SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";

export type CompanyMeta = {
	company_tag?: string;
	industry?: string;
	nature?: string;
};

/**
 * 职级存原文、档名和档高，学历存档名和档高：筛选按档名，「某档及以上」按档高比
 * （`search.ts` 的 `atLeastCond`）。档高和档名同有同无。
 */
export const employee = pgTable(
	"employee",
	{
		empId: text("emp_id").primaryKey(),
		name: text("name").notNull(),
		curDept: text("cur_dept").notNull().default(""),
		curTitle: text("cur_title").notNull().default(""),
		curSeqL1: text("cur_seq_l1").notNull().default(""),
		curSeqL2: text("cur_seq_l2").notNull().default(""),
		curSeqL3: text("cur_seq_l3").notNull().default(""),
		/** 登记的职级原文，详情里显示 */
		curLevel: text("cur_level").notNull().default(""),
		/** 职级归入的档（源契约的 `levels`），筛选与条件读它 */
		curLevelBand: text("cur_level_band").notNull().default(""),
		curLevelRank: integer("cur_level_rank"),
		hireDate: date("hire_date"),
		/** 学历五档之一（`EDUCATION_LADDER`） */
		educationLevel: text("education_level").notNull().default(""),
		educationRank: integer("education_rank"),
		school: text("school").notNull().default(""),
		recruitment: text("recruitment").notNull().default(""),
	},
	(t) => [
		check(
			"employee_level_band_ranked",
			sql`(${t.curLevelBand} = '') = (${t.curLevelRank} is null)`,
		),
		check(
			"employee_education_ranked",
			sql`(${t.educationLevel} = '') = (${t.educationRank} is null)`,
		),
	],
);

/** 原始字段由同步写，推断序列与派生版本由派生任务写。`content_key` 是原始内容的数据库生成摘要。 */
export const experience = pgTable(
	"experience",
	{
		id: serial("id").primaryKey(),
		empId: text("emp_id")
			.notNull()
			.references(() => employee.empId, { onDelete: "cascade" }),
		kind: text("kind", { enum: ["internal", "external"] }).notNull(),
		/** 待业只保留在时间线上，不进入检索、累计工作年限或模型派生。 */
		unemployed: boolean("unemployed").notNull().default(false),
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
		 * 不进说法：推断的序列不是这个人登记过的任职，拿来当做过什么的证据就是在猜。
		 */
		seqInferredL1: text("seq_inferred_l1").notNull().default(""),
		seqInferredL2: text("seq_inferred_l2").notNull().default(""),
		level: text("level").notNull().default(""),
		description: text("description").notNull().default(""),
		months: integer("months").notNull(),
		contentKey: text("content_key")
			.notNull()
			.unique()
			.generatedAlwaysAs(
				sql`md5(emp_id || E'\\x1f' || kind || E'\\x1f' || unemployed::text || E'\\x1f' || (start_date - date '1970-01-01')::text || E'\\x1f' || coalesce((end_date - date '1970-01-01')::text, '') || E'\\x1f' || org || E'\\x1f' || org_path || E'\\x1f' || coalesce(org_meta::text, '') || E'\\x1f' || title || E'\\x1f' || seq_l1 || E'\\x1f' || seq_l2 || E'\\x1f' || seq_l3 || E'\\x1f' || level || E'\\x1f' || description)`,
			),
		derivedIdentity: text("derived_identity"),
	},
	(t) => [
		index("experience_derived").on(t.derivedIdentity),
		check("experience_kind_valid", sql`${t.kind} in ('internal', 'external')`),
		check(
			"experience_unemployed_external",
			sql`not ${t.unemployed} or ${t.kind} = 'external'`,
		),
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

/** 聊天完成缓存。identity 包含模型、提示词和回答 schema；payload 保留未经领域校验的原话。 */
export const completionCache = pgTable(
	"completion_cache",
	{
		identity: text("identity").notNull(),
		textSha: text("text_sha").notNull(),
		payload: jsonb("payload").notNull(),
	},
	(t) => [primaryKey({ columns: [t.identity, t.textSha] })],
);

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
	},
	(t) => [
		check(
			"skill_term_parent_on_canonical_1",
			sql`${t.parent} is null or (${t.canonical} = ${t.word} and ${t.parent} <> ${t.word})`,
		),
	],
);

const GROUP_KINDS = ["group", "gloss"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** 待判队列。归并组写 skill_term，释义组写 phrase_gloss；生效或过期后删除。 */
export const reviewGroup = pgTable(
	"review_group",
	{
		id: serial("id").primaryKey(),
		kind: text("kind", { enum: GROUP_KINDS }).notNull(),
		/** 收集与判定这组词所依据的 GUIDE 与回答形状摘要。 */
		guideIdentity: text("guide_identity").notNull(),
		words: jsonb("words").$type<{ word: string; people: number }[]>().notNull(),
		collectedAt: timestamp("collected_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		judge: text("judge"),
		/** 判定原话；生效时做领域校验。 */
		judgment: jsonb("judgment"),
	},
	(t) => [
		check(
			"review_group_judged_1",
			sql`(${t.judge} is null) = (${t.judgment} is null)`,
		),
	],
);

/** 短说法的释义；文本与释义共同组成重排缓存的输入身份。 */
export const phraseGloss = pgTable("phrase_gloss", {
	text: text("text").primaryKey(),
	gloss: text("gloss").notNull(),
	/** 释义标准的摘要；标准变化后旧释义重新收集。 */
	guideIdentity: text("guide_identity").notNull(),
});

/**
 * 一段经历说自己做过什么的五类说法（拼法见 `corpus/route-texts.ts`）：公司内一段任职
 * 整句一条，入职前的岗位名，读出来的能力词和做过的事，没读过的简历原文。
 * 公司名和单独的部门名只回答「在哪」，不在这里。
 */
const ROUTES = ["role", "title", "description", "skill", "did"] as const;
export type Route = (typeof ROUTES)[number];
/** 文本只存在 phrase 表中的两类说法。 */
export const EXTRACTED_ROUTES = [
	"skill",
	"did",
] as const satisfies readonly Route[];
/** 当前仍有这些边的说法使用释义；收集、计数、版本核验与召回共用此范围。 */
export const GLOSSED_ROUTES = [
	"skill",
	"did",
	"title",
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
		// drizzle-kit push 只比较 check 名称；改变表达式时同步改名。
		check(
			"experience_phrase_route_valid_7",
			sql`${t.route} in ('role', 'title', 'description', 'skill', 'did')`,
		),
	],
);

/**
 * 判定标准变了以后，新标准的派生结果先写在这里，检索继续读正式的两列和
 * `experience_phrase`；派生走完一遍待派生的段，在一个事务里整体换进去
 * （`corpus/derive.ts` 的 `promote`）。标准没变时不经过这里。
 */
export const experienceNext = pgTable("experience_next", {
	experienceId: integer("experience_id")
		.primaryKey()
		.references(() => experience.id, { onDelete: "cascade" }),
	derivedIdentity: text("derived_identity").notNull(),
	seqInferredL1: text("seq_inferred_l1").notNull(),
	seqInferredL2: text("seq_inferred_l2").notNull(),
});

/** `experience_next` 那些段在新标准下的边。 */
export const experiencePhraseNext = pgTable(
	"experience_phrase_next",
	{
		experienceId: integer("experience_id")
			.notNull()
			.references(() => experienceNext.experienceId, { onDelete: "cascade" }),
		route: text("route", { enum: ROUTES }).notNull(),
		phraseId: integer("phrase_id")
			.notNull()
			.references(() => phrase.id, { onDelete: "cascade" }),
		involvement: text("involvement"),
	},
	(t) => [
		primaryKey({ columns: [t.experienceId, t.route, t.phraseId] }),
		index("experience_phrase_next_phrase").on(t.phraseId),
		check(
			"experience_phrase_next_route_valid_1",
			sql`${t.route} in ('role', 'title', 'description', 'skill', 'did')`,
		),
	],
);

/** 按模型实际输入缓存相关度，与语料行的生命周期无关。 */
export const rerankCache = pgTable(
	"rerank_cache",
	{
		space: text("space").notNull(),
		query: text("query").notNull(),
		documentSha: text("document_sha").notNull(),
		relevance: doublePrecision("relevance").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.space, t.query, t.documentSha] }),
		check(
			"rerank_cache_range",
			sql`${t.relevance} >= 0 and ${t.relevance} <= 1`,
		),
	],
);

/** 不可变查询记录；仅待理解记录允许把 spec 从 null 补全一次。 */
export const searchTurn = pgTable(
	"search_turn",
	{
		id: text("id").primaryKey(),
		/** 同一次找人任务的链头：最近搜索按它去重，它的原话是这次任务的标题。 */
		rootTurnId: text("root_turn_id").notNull(),
		/**
		 * 链上的前一轮：它的条件是这一轮说话时的基线，也是界面比出变化的那一边。
		 * 一条链是一条线，一轮后面至多接一轮（`search_turn_line`）。
		 */
		parentTurnId: text("parent_turn_id").unique("search_turn_line"),
		/** 用户这一轮说的话；直接提交完整条件时为空。 */
		rawText: text("raw_text"),
		/** 查询条件快照；null 表示仍待理解。 */
		spec: jsonb("spec").$type<SearchSpec>(),
		/** 理解这一轮时模型的说明：替用户选定的理解、搜不了的要求。没有就是 null。 */
		notes: jsonb("notes").$type<TurnNotes>(),
		/** 理解这一轮时模型用工具走过的步骤，边跑边追加；关键词的记录没有。 */
		trace: jsonb("trace").$type<TraceStep[]>(),
		/**
		 * 这一次理解开始的时刻，和清空 `trace` 同时写：等理解时的计时和完成后的用时
		 * 都从它算，重试过也只算这一次。没开始理解过的记录为 null。
		 */
		interpretStartedAt: timestamp("interpret_started_at", {
			withTimezone: true,
		}),
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
		foreignKey({
			name: "search_turn_parent",
			columns: [t.parentTurnId],
			foreignColumns: [t.id],
		}).onDelete("cascade"),
		check(
			"search_turn_notes",
			sql`${t.notes} is null or ${t.spec} is not null`,
		),
		index("search_turn_root").on(t.rootTurnId),
	],
);

export type SearchTurn = typeof searchTurn.$inferSelect;
