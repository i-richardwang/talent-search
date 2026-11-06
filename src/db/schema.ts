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
	pgSchema,
	pgTable,
	primaryKey,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { ENGAGEMENTS } from "#/lib/engagement";
import { TASK_KINDS } from "#/lib/task";
import type { TurnNotes } from "#/search/intent";
import type { SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";

/** 登录身份独立于人才库，认证表的外键只在认证表之间连接。 */
export const authUser = pgTable("auth_user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => new Date()),
	username: text("username").unique(),
	role: text("role"),
	banned: boolean("banned").default(false),
	banReason: text("ban_reason"),
	banExpires: timestamp("ban_expires", { withTimezone: true }),
});

export const authSession = pgTable(
	"auth_session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		token: text("token").notNull().unique(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.$onUpdate(() => new Date()),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id")
			.notNull()
			.references(() => authUser.id, { onDelete: "cascade" }),
		impersonatedBy: text("impersonated_by"),
	},
	(t) => [index("auth_session_user").on(t.userId)],
);

export const authAccount = pgTable(
	"auth_account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id")
			.notNull()
			.references(() => authUser.id, { onDelete: "cascade" }),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			withTimezone: true,
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			withTimezone: true,
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("auth_account_user").on(t.userId)],
);

export const authVerification = pgTable(
	"auth_verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date()),
	},
	(t) => [index("auth_verification_identifier").on(t.identifier)],
);

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
		/** 最高学历那所学校的档，数据源的写法，档与档之间不比高低 */
		schoolTier: text("school_tier").notNull().default(""),
		/** 最高学历是不是在海外取得；没有记录时为空 */
		overseasEducated: boolean("overseas_educated"),
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

/** 原始字段由同步写，推断序列与解析版本由解析任务写。`content_key` 是原始内容的数据库生成摘要。 */
export const experience = pgTable(
	"experience",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		empId: text("emp_id")
			.notNull()
			.references(() => employee.empId, { onDelete: "cascade" }),
		kind: text("kind", { enum: ["internal", "external"] }).notNull(),
		/** 待业只保留在时间线上，不进入检索、累计工作年限或模型解析。 */
		unemployed: boolean("unemployed").notNull().default(false),
		startDate: date("start_date").notNull(),
		endDate: date("end_date"),
		/** 外部：公司名 */
		company: text("company").notNull().default(""),
		/** 内部：末级部门 */
		department: text("department").notNull().default(""),
		/** 内部：段起始日有效的完整部门路径 */
		departmentPath: text("department_path").notNull().default(""),
		/** 外部：公司档、行业、性质等规范字段 */
		companyMeta: jsonb("company_meta").$type<CompanyMeta>(),
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
				sql`md5(emp_id || E'\\x1f' || kind || E'\\x1f' || unemployed::text || E'\\x1f' || (start_date - date '1970-01-01')::text || E'\\x1f' || coalesce((end_date - date '1970-01-01')::text, '') || E'\\x1f' || company || E'\\x1f' || department || E'\\x1f' || department_path || E'\\x1f' || coalesce(company_meta::text, '') || E'\\x1f' || title || E'\\x1f' || seq_l1 || E'\\x1f' || seq_l2 || E'\\x1f' || seq_l3 || E'\\x1f' || level || E'\\x1f' || description)`,
			),
		derivedIdentity: text("derived_identity"),
		/**
		 * 这一版标准下模型没给出合法回答：抽取答不出时自述按整段原文检索，对齐答不出时
		 * 不推断序列。同一段文字、同一套标准再问也是同样的回答，标准变了才重新问。
		 * 任务台数它，人页上标出来。
		 */
		unanswered: boolean("unanswered").notNull().default(false),
	},
	(t) => [
		index("experience_derived").on(t.derivedIdentity),
		check(
			"experience_unanswered_derived",
			sql`not ${t.unanswered} or ${t.derivedIdentity} is not null`,
		),
		check("experience_kind_valid", sql`${t.kind} in ('internal', 'external')`),
		check(
			"experience_place_by_kind",
			sql`case ${t.kind} when 'internal' then ${t.company} = '' else ${t.department} = '' and ${t.departmentPath} = '' end`,
		),
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

const RECORD_KINDS = ["rating", "status"] as const;

/**
 * 记录流的声明，同步时由适配器给（`corpus/contract.ts` 的 `streams`）。`label`、`period`、
 * `notes` 进数据目录给查询理解读，管理页「数据」按它列出每条流的覆盖。
 */
export const recordStream = pgTable(
	"record_stream",
	{
		stream: text("stream").primaryKey(),
		kind: text("kind", { enum: RECORD_KINDS }).notNull(),
		label: text("label").notNull(),
		/** 一期多长（「半年」）；状态流为空 */
		period: text("period").notNull().default(""),
		/** 这条流的口径：怎么评、缺一期意味着什么 */
		notes: text("notes").notNull().default(""),
	},
	(t) => [
		check("record_stream_kind_1", sql`${t.kind} in ('rating', 'status')`),
	],
);

/**
 * 职级档和学历档在档位表里的流名。同步按它写（`corpus/pipeline.ts`），旧条件的「某档及以上」
 * 按它查（`search/compile.ts`）；数据源的记录流不能用这两个名字。
 */
export const ORDINAL_STREAM = {
	level: "level",
	education: "education",
} as const;

/**
 * 档位表：职级档、学历五档（流名见 `ORDINAL_STREAM`）和各评级流的档。比高低只比
 * `rank`，不比档名字面。同步时整表重写（`corpus/pipeline.ts` 的 `scaleRows`）。
 */
export const scale = pgTable(
	"scale",
	{
		stream: text("stream").notNull(),
		value: text("value").notNull(),
		rank: integer("rank").notNull(),
	},
	(t) => [primaryKey({ columns: [t.stream, t.value] })],
);

/**
 * 按期登记的记录：评级一期一行，状态一段一行。同一人同一流同一期只有一行，修订在
 * 同步时去重（只留最终一条）。没有某一期的行表示没有记录，不表示任何档。
 */
export const employeeRecord = pgTable(
	"employee_record",
	{
		empId: text("emp_id")
			.notNull()
			.references(() => employee.empId, { onDelete: "cascade" }),
		stream: text("stream")
			.notNull()
			.references(() => recordStream.stream, { onDelete: "cascade" }),
		periodStart: date("period_start").notNull(),
		/** 评级是这一期的结束日；状态为空表示仍有效 */
		periodEnd: date("period_end"),
		value: text("value").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.empId, t.stream, t.periodStart] }),
		check(
			"employee_record_period_ordered",
			sql`${t.periodEnd} is null or ${t.periodEnd} >= ${t.periodStart}`,
		),
	],
);

/**
 * 数据目录：查询条件里模型写的 SQL 只能读这个 schema 里的视图（`server/sandbox.ts`
 * 以只读角色执行）。视图不含姓名，也不含简历原文：按意思找的经历由语义命中表 `hit`
 * 回答，模型不按原文筛。每一列的中文名、含义和口径在 `search/catalog.ts`。
 * 空串一律读成 null：模型写 `is null` 就是「没有记录」。
 */
export const catalog = pgSchema("catalog");

export const catalogPerson = catalog
	.view("person", {
		emp_id: text("emp_id"),
		level_band: text("level_band"),
		level_rank: integer("level_rank"),
		education: text("education"),
		education_rank: integer("education_rank"),
		school: text("school"),
		school_tier: text("school_tier"),
		overseas: text("overseas"),
		recruitment: text("recruitment"),
		hire_date: date("hire_date"),
		cur_dept: text("cur_dept"),
		cur_seq_l1: text("cur_seq_l1"),
		cur_seq_l2: text("cur_seq_l2"),
		cur_seq_l3: text("cur_seq_l3"),
	})
	.as(sql`select emp_id,
		nullif(cur_level_band, '') as level_band, cur_level_rank as level_rank,
		nullif(education_level, '') as education, education_rank,
		nullif(school, '') as school, nullif(school_tier, '') as school_tier,
		case overseas_educated when true then '是' when false then '否' end as overseas,
		nullif(recruitment, '') as recruitment, hire_date,
		nullif(cur_dept, '') as cur_dept, nullif(cur_seq_l1, '') as cur_seq_l1,
		nullif(cur_seq_l2, '') as cur_seq_l2, nullif(cur_seq_l3, '') as cur_seq_l3
	from employee`);

/**
 * 一段工作经历；待业段不在这里。序列登记的优先，没有才取模型对齐的（两级成对）；
 * `skills` 是这段抽出的能力词的标准写法连同全部更宽的词。
 */
export const catalogExperience = catalog
	.view("experience", {
		id: integer("id"),
		emp_id: text("emp_id"),
		kind: text("kind"),
		start_date: date("start_date"),
		end_date: date("end_date"),
		months: integer("months"),
		company: text("company"),
		company_tag: text("company_tag"),
		department: text("department"),
		department_path: text("department_path"),
		title: text("title"),
		level: text("level"),
		seq_l1: text("seq_l1"),
		seq_l2: text("seq_l2"),
		skills: text("skills").array(),
	})
	.as(sql`select e.id, e.emp_id, e.kind, e.start_date, e.end_date, e.months,
		nullif(e.company, '') as company,
		nullif(e.company_meta ->> 'company_tag', '') as company_tag,
		nullif(e.department, '') as department,
		nullif(e.department_path, '') as department_path,
		nullif(e.title, '') as title, nullif(e.level, '') as level,
		nullif(coalesce(nullif(e.seq_l1, ''), e.seq_inferred_l1), '') as seq_l1,
		nullif(coalesce(nullif(e.seq_l2, ''), e.seq_inferred_l2), '') as seq_l2,
		array(
			with recursive up(word) as (
				select coalesce(t.canonical, ph.text)
				from experience_phrase ep join phrase ph on ph.id = ep.phrase_id
				left join term t on t.word = ph.text
				where ep.experience_id = e.id and ep.route = 'skill'
				union
				select t.parent from up join term t on t.word = up.word
				where t.parent is not null
			)
			select word from up order by word) as skills
	from experience e where not e.unemployed`);

/** 一期评级。`value_rank` 是这一档在档位表里的高低。 */
export const catalogRating = catalog
	.view("rating", {
		emp_id: text("emp_id"),
		stream: text("stream"),
		period_start: date("period_start"),
		period_end: date("period_end"),
		value: text("value"),
		value_rank: integer("value_rank"),
	})
	.as(sql`select r.emp_id, r.stream, r.period_start, r.period_end, r.value,
		s.rank as value_rank
	from employee_record r
	join record_stream rs on rs.stream = r.stream and rs.kind = 'rating'
	left join scale s on s.stream = r.stream and s.value = r.value`);

/** 一段状态；`valid_to` 为空表示仍有效。 */
export const catalogStatus = catalog
	.view("status", {
		emp_id: text("emp_id"),
		stream: text("stream"),
		value: text("value"),
		valid_from: date("valid_from"),
		valid_to: date("valid_to"),
	})
	.as(sql`select r.emp_id, r.stream, r.value,
		r.period_start as valid_from, r.period_end as valid_to
	from employee_record r
	join record_stream rs on rs.stream = r.stream and rs.kind = 'status'`);

export const catalogScale = catalog
	.view("scale", {
		stream: text("stream"),
		value: text("value"),
		rank: integer("rank"),
	})
	.as(sql`select stream, value, rank from scale`);

/** 目录里的全部视图，按目录的顺序。 */
export const CATALOG_VIEWS = [
	catalogPerson,
	catalogExperience,
	catalogRating,
	catalogStatus,
	catalogScale,
] as const;

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
	id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
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

/** 词表：短说法的标准写法与宽细归属。跨语料保留，不改经历上的原始说法。 */
export const term = pgTable(
	"term",
	{
		word: text("word").primaryKey(),
		canonical: text("canonical").notNull(),
		parent: text("parent").references((): AnyPgColumn => term.word),
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
	},
	(t) => [
		check(
			"term_parent_on_canonical",
			sql`${t.parent} is null or (${t.canonical} = ${t.word} and ${t.parent} <> ${t.word})`,
		),
	],
);

const GROUP_KINDS = ["group", "gloss"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** 待判队列。归并组写 term，释义组写 phrase_gloss；生效或过期后删除。 */
export const reviewGroup = pgTable(
	"review_group",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
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
 * 一段经历说自己做过什么的四类说法（组合方式见 `corpus/route-texts.ts`）：公司内一段任职
 * 整句一条，入职前的岗位名，读出来的能力，没读过的简历原文。
 * 公司名和单独的部门名只回答「在哪」，不在这里。
 */
const ROUTES = ["role", "title", "description", "skill"] as const;
export type Route = (typeof ROUTES)[number];
/** 文本只存在 phrase 表中的那类说法。 */
export const EXTRACTED_ROUTES = ["skill"] as const satisfies readonly Route[];
/**
 * 短说法：几个字的能力词、入职前岗位名。只有当前仍有这些边的说法使用释义、
 * 进词表；释义和词表的收集、计数、版本核验与召回共用此范围。
 */
export const SHORT_ROUTES = [
	"skill",
	"title",
] as const satisfies readonly Route[];

/**
 * 去重后的说法及其半精度向量。未读段的整段原文也是说法，可以长过 btree 一行的上限，
 * 所以唯一性落在库生成的摘要 `text_key` 上，按文字等值查找走 hash 索引。
 */
export const phrase = pgTable(
	"phrase",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		text: text("text").notNull(),
		textKey: text("text_key")
			.notNull()
			.unique()
			.generatedAlwaysAs(sql`md5(text)`),
		embedding: halfvec("embedding", { dimensions: EMBED_DIM }).notNull(),
	},
	(t) => [index("phrase_text").using("hash", t.text)],
);

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
		/** 能力那一类的投入档（`lib/engagement.ts`），不进向量，排名时给相关度打折；其余类为空。 */
		engagement: text("engagement", { enum: ENGAGEMENTS }),
	},
	(t) => [
		primaryKey({ columns: [t.experienceId, t.route, t.phraseId] }),
		index("experience_phrase_phrase").on(t.phraseId),
		// drizzle-kit push 只比较 check 名称；改变表达式时同步改名。
		check(
			"experience_phrase_route_valid_8",
			sql`${t.route} in ('role', 'title', 'description', 'skill')`,
		),
		check(
			"experience_phrase_engagement_valid_1",
			sql`${t.engagement} in ('主导', '做过', '提到')`,
		),
	],
);

/**
 * 判定标准变了以后，新标准的解析结果先写在这里，检索继续读正式的两列和
 * `experience_phrase`；每一段都有了新标准的结果，在一个事务里一次替换进去
 * （`corpus/derive.ts` 的 `promote`）。标准没变时不经过这里。
 */
export const experienceNext = pgTable("experience_next", {
	experienceId: integer("experience_id")
		.primaryKey()
		.references(() => experience.id, { onDelete: "cascade" }),
	derivedIdentity: text("derived_identity").notNull(),
	seqInferredL1: text("seq_inferred_l1").notNull(),
	seqInferredL2: text("seq_inferred_l2").notNull(),
	unanswered: boolean("unanswered").notNull(),
});

/** `experience_next` 那些段在新标准下的边。 */
export const experiencePhraseNext = pgTable(
	"experience_phrase_next",
	{
		experienceId: integer("experience_id").notNull(),
		route: text("route", { enum: ROUTES }).notNull(),
		phraseId: integer("phrase_id")
			.notNull()
			.references(() => phrase.id, { onDelete: "cascade" }),
		engagement: text("engagement", { enum: ENGAGEMENTS }),
	},
	(t) => [
		primaryKey({ columns: [t.experienceId, t.route, t.phraseId] }),
		// 默认名按两张表名和列名拼出来超过 63 字节，Postgres 会截短，db:push 就每次都当它变了
		foreignKey({
			name: "experience_phrase_next_segment_fk",
			columns: [t.experienceId],
			foreignColumns: [experienceNext.experienceId],
		}).onDelete("cascade"),
		index("experience_phrase_next_phrase").on(t.phraseId),
		check(
			"experience_phrase_next_route_valid_2",
			sql`${t.route} in ('role', 'title', 'description', 'skill')`,
		),
		check(
			"experience_phrase_next_engagement_valid_1",
			sql`${t.engagement} in ('主导', '做过', '提到')`,
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
		 * 这一次理解的编号。说了一句话的一轮写入时就开始理解，重试换一个新编号；理解写步骤、
		 * 结果和失败原因都只写编号还是自己的那一行，被换掉的那一次写不进来。
		 * 没说话的一轮没有，`trace` 和开始的时刻也没有（`search_turn_interpret`）。
		 */
		interpretAttempt: text("interpret_attempt"),
		/**
		 * 这一次理解开始的时刻，和编号、清空 `trace` 同时写：等理解时的计时和完成后的用时
		 * 都从它算，重试过也只算这一次。
		 */
		interpretStartedAt: timestamp("interpret_started_at", {
			withTimezone: true,
		}),
		/** 这一次理解为什么没成（`server/turn.ts` 的 `InterpretFault`）；还在理解或已理解为 null。 */
		interpretFault: text("interpret_fault"),
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
		check(
			"search_turn_interpret",
			sql`(${t.rawText} is null) = (${t.interpretAttempt} is null)
				and (${t.interpretAttempt} is null) = (${t.interpretStartedAt} is null)
				and (${t.interpretAttempt} is null) = (${t.trace} is null)`,
		),
		check(
			"search_turn_fault",
			sql`${t.interpretFault} is null or ${t.spec} is null`,
		),
		index("search_turn_root").on(t.rootTurnId),
	],
);

export type SearchTurn = typeof searchTurn.$inferSelect;
