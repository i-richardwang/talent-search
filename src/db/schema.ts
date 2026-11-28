import { type SQL, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	pgPolicy,
	pgSchema,
	pgTable,
	pgView,
	primaryKey,
	real,
	text,
	timestamp,
	unique,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Resume } from "#/ingestion/resume";
import type { Touch } from "#/ingestion/touch";
import { AUDIT_ACTIONS } from "#/lib/audit";
import { ENGAGEMENTS } from "#/lib/engagement";
import { ORG_SEPARATOR } from "#/lib/org";
import { TASK_KINDS } from "#/lib/task";
import type { TurnNotes } from "#/search/intent";
import type { SearchSpec } from "#/search/spec";
import type { TraceStep } from "#/search/trace";

/**
 * 登录身份独立于人才库：和员工档案之间没有外键。搜索记录和操作记录引用账号（谁发起的、谁做的），
 * 所以账号只停用、不删除。
 */
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
	username: text("username").notNull().unique(),
	role: text("role"),
	banned: boolean("banned").default(false),
	banReason: text("ban_reason"),
	banExpires: timestamp("ban_expires", { withTimezone: true }),
});

/**
 * 账号的数据范围：一行一个组织（部门路径，`lib/org.ts` 的写法），
 * 连同下面的各级。一个账号看得到的人，是此刻所在部门落在其中某个组织下的人
 * （`visible_employment`）；最上一级（集团）就是全部有部门的人。建账号时必须给，账号页上改。
 */
export const accountScope = pgTable(
	"account_scope",
	{
		userId: text("user_id")
			.notNull()
			.references(() => authUser.id, { onDelete: "cascade" }),
		orgPath: text("org_path").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.orgPath] }),
		check("account_scope_org_path_set", sql`${t.orgPath} <> ''`),
	],
);

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

/** 人事系统给一段入职前经历登记的公司属性：公司档、企业性质。 */
export type CompanyMeta = {
	company_tag?: string;
	nature?: string;
};

/** 部门路径的分隔，写进视图定义的字面量。 */
const SEPARATOR = sql.raw(`'${ORG_SEPARATOR}'`);

const SCOPE = sql`current_setting('talent.scope', true)`;
const ALL = sql`${SCOPE} = '*'`;
const MEMBERS = sql`select distinct s.user_id, e.person_id from account_scope s join auth_user u on u.id=s.user_id and u.banned is not true join employment e
	on starts_with(e.cur_dept_path || ${SEPARATOR}, s.org_path || ${SEPARATOR})`;
const HR = sql`select e.person_id from employment e where ${ALL}
	union all select m.person_id from (${MEMBERS}) m where m.user_id = ${SCOPE}`;
const POOL_MEMBERS = sql`select u.id as user_id,p.id as pool_id from auth_user u join talent_pool p
	on p.visibility='public' or (p.visibility='org' and exists(select from account_scope s where s.user_id=u.id
		and starts_with(p.org_path || ${SEPARATOR},s.org_path || ${SEPARATOR}))) where u.banned is not true`;
const POOLS = sql`select id from talent_pool where ${ALL} union all
	select pool_id from (${POOL_MEMBERS}) members where members.user_id=${SCOPE}`;
const PROFILES = sql`select id from profile_source where
	(source_kind = 'hris' and person_id in (${HR})) or pool_id in (${POOLS})`;
const SEGMENTS = sql`select pe.experience_id from profile_experience pe where pe.profile_id in (${PROFILES})`;
function readPolicy(name: string, using: SQL) {
	return pgPolicy(name, { for: "select", to: "public", using });
}
export const scopeMember = pgView("scope_member", {
	user_id: text("user_id").notNull(),
	person_id: text("person_id").notNull(),
}).as(sql`select h.* from (${MEMBERS}) h where ${ALL} or h.user_id=${SCOPE}
	union select a.user_id,m.person_id from (${POOL_MEMBERS}) a join pool_member m using(pool_id)
	where ${ALL} or a.user_id=${SCOPE}`);
export const visibleEmployment = pgView("visible_employment", {
	person_id: text("person_id").notNull(),
}).as(HR);
export const visiblePool = pgView("visible_pool", {
	id: text("id").notNull(),
}).as(POOLS);
export const visibleProfile = pgView("visible_profile", {
	id: text("id").notNull(),
}).as(PROFILES);
export const visibleSegment = pgView("visible_segment", {
	experience_id: integer("experience_id").notNull(),
}).as(SEGMENTS);
const id = () => text("id").primaryKey().default(sql`gen_random_uuid()::text`);
const created = () =>
	timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const accountId = (column: string) =>
	text(column).references(() => authUser.id);
const bio = () => ({
	name: text("name").notNull(),
	educationLevel: text("education_level").notNull().default(""),
	educationRank: integer("education_rank"),
	school: text("school").notNull().default(""),
	schoolTier: text("school_tier").notNull().default(""),
	overseasEducated: boolean("overseas_educated"),
});
export const person = pgTable(
	"person",
	{
		personId: text("person_id").primaryKey(),
		...bio(),
	},
	(t) => [
		check(
			"person_education_ranked",
			sql`(${t.educationLevel}='')=(${t.educationRank} is null)`,
		),
		readPolicy(
			"person_canonical_hr",
			sql`${ALL} or ${t.personId} in (select person_id from visible_employment)`,
		),
	],
);
const personKey = () =>
	text("person_id")
		.notNull()
		.references(() => person.personId, { onDelete: "cascade" });
export const personIdentity = pgTable(
	"person_identity",
	{
		personId: personKey(),
		kind: text("kind").notNull(),
		value: text("value").notNull(),
		origin: text("origin").notNull().default("hris"),
	},
	(t) => [
		primaryKey({ columns: [t.kind, t.value, t.personId, t.origin] }),
		// 人工分开的人可以共用联系方式。只有人事系统的工号唯一。
		uniqueIndex("external_emp_identity")
			.on(t.value)
			.where(sql`${t.kind}='emp_id'`),
		index("identity_person").on(t.personId),
		readPolicy(
			"identity_channel",
			sql`(${t.origin}='hris' and ${t.personId} in (select person_id from visible_employment)) or ${t.origin} in (select id from visible_pool)`,
		),
	],
);
const job = () => ({
	curDept: text("cur_dept").notNull().default(""),
	curDeptPath: text("cur_dept_path").notNull().default(""),
	curTitle: text("cur_title").notNull().default(""),
	curSeqL1: text("cur_seq_l1").notNull().default(""),
	curSeqL2: text("cur_seq_l2").notNull().default(""),
	curSeqL3: text("cur_seq_l3").notNull().default(""),
	curLevel: text("cur_level").notNull().default(""),
	curLevelBand: text("cur_level_band").notNull().default(""),
	curLevelRank: integer("cur_level_rank"),
	hireDate: date("hire_date"),
	recruitment: text("recruitment").notNull().default(""),
});
export const employment = pgTable(
	"employment",
	{
		personId: personKey().primaryKey(),
		empId: text("emp_id").notNull().unique(),
		...job(),
	},
	(t) => [
		check(
			"employment_level_ranked",
			sql`(${t.curLevelBand}='')=(${t.curLevelRank} is null)`,
		),
		readPolicy(
			"employment_scope",
			sql`${t.personId} in (select person_id from visible_employment)`,
		),
	],
);
export const talentPool = pgTable(
	"talent_pool",
	{
		id: id(),
		name: text("name").notNull().unique(),
		visibility: text("visibility", { enum: ["public", "org"] })
			.notNull()
			.default("public"),
		orgPath: text("org_path"),
		createdBy: accountId("created_by"),
		createdAt: created(),
	},
	(t) => [
		check(
			"pool_visibility_org",
			sql`(${t.visibility}='public' and ${t.orgPath} is null) or
	(${t.visibility}='org' and ${t.orgPath} is not null and btrim(${t.orgPath})<>'')`,
		),
		readPolicy("pool_scope", sql`${t.id} in (select id from visible_pool)`),
	],
);
const poolKey = () => text("pool_id").references(() => talentPool.id);
export const poolMember = pgTable(
	"pool_member",
	{
		poolId: poolKey().notNull(),
		personId: personKey(),
		addedBy: accountId("added_by").notNull(),
		contacts: jsonb("contacts")
			.$type<{ phone: string; email: string; wechat: string }>()
			.notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.poolId, t.personId] }),
		index("pool_member_person").on(t.personId),
		readPolicy(
			"member_scope",
			sql`${t.poolId} in (select id from visible_pool)`,
		),
	],
);
export const poolTouch = pgTable(
	"pool_touch",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		poolId: text("pool_id").notNull(),
		personId: text("person_id").notNull(),
		// 作者未知的接触记录保留空值。
		authorId: accountId("author_id"),
		touchedAt: date("touched_at"),
		notes: text("notes").notNull(),
		createdAt: created(),
	},
	(t) => [
		foreignKey({
			columns: [t.poolId, t.personId],
			foreignColumns: [poolMember.poolId, poolMember.personId],
		}).onDelete("cascade"),
		check(
			"touch_has_date_or_notes",
			sql`${t.touchedAt} is not null or btrim(${t.notes})<>''`,
		),
		index("touch_member_date").on(t.poolId, t.personId, t.touchedAt, t.id),
		readPolicy(
			"touch_pool_scope",
			sql`${t.poolId} in (select id from visible_pool)`,
		),
	],
);
export const resumeFile = pgTable(
	"resume_file",
	{
		id: id(),
		sha256: text("sha256").notNull().unique(),
		sizeBytes: integer("size_bytes").notNull(),
		createdAt: created(),
	},
	(t) => [
		readPolicy(
			"file_scope",
			sql`${t.id} in (select resume_file_id from profile_source where resume_file_id is not null) or ${t.id} in (select file_id from resume_import where status in ('review','failed'))`,
		),
	],
);
export const profileSource = pgTable(
	"profile_source",
	{
		id: id(),
		seq: integer("seq").generatedAlwaysAsIdentity(),
		personId: personKey(),
		sourceKind: text("source_kind").notNull(),
		poolId: poolKey(),
		resumeFileId: text("resume_file_id").references(() => resumeFile.id),
		filename: text("filename"),
		createdBy: accountId("created_by"),
		capturedAt: timestamp("captured_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		// PDF 的个人档案属于该资料的权限范围。HRIS 的通用档案在 person 上。
		parsed: jsonb("parsed").$type<Resume>(),
	},
	(t) => [
		unique("profile_person_identity").on(t.id, t.personId),
		uniqueIndex("hris_profile_per_person")
			.on(t.personId)
			.where(sql`${t.sourceKind}='hris'`),
		unique("profile_original_per_pool_person").on(
			t.resumeFileId,
			t.poolId,
			t.personId,
		),
		index("profile_versions").on(t.personId, t.poolId, t.capturedAt),
		check(
			"profile_origin",
			sql`(${t.sourceKind}='hris' and ${t.poolId} is null and ${t.resumeFileId} is null and ${t.parsed} is null) or
	(${t.sourceKind}='pdf_resume' and ${t.poolId} is not null and ${t.resumeFileId} is not null and ${t.parsed} is not null and ${t.filename} is not null)`,
		),
		readPolicy(
			"profile_scope",
			sql`${t.id} in (select id from visible_profile)`,
		),
	],
);
export const resumeImport = pgTable(
	"resume_import",
	{
		id: id(),
		poolId: poolKey().notNull(),
		ownerId: accountId("owner_id").notNull(),
		fileId: text("file_id").references(() => resumeFile.id),
		filename: text("filename").notNull(),
		createdAt: created(),
		status: text("status").notNull().default("queued"),
		draft: jsonb("draft").$type<Resume>(),
		touch: jsonb("touch").$type<Touch>(),
		personId: text("person_id").references(() => person.personId, {
			onDelete: "set null",
		}),
		message: text("message").notNull().default(""),
	},
	(t) => [
		index("resume_import_work")
			.on(t.createdAt, t.id)
			.where(sql`${t.status} in ('queued','processing')`),
		check(
			"resume_import_state_valid_2",
			sql`${t.status} in ('queued','processing','review','failed','added','duplicate','cancelled')`,
		),
		readPolicy(
			"import_owner_scope",
			sql`${t.ownerId}=${SCOPE} and ${t.poolId} in (select id from visible_pool)`,
		),
	],
);
// 每个账号只从可见资料合成一张名片。有内部授权时用人事档案，否则用最近一份可见简历。
const CARDS = sql`with hr as (select * from employment where person_id in (${HR})),
	accessible as (select m.person_id, array_agg(distinct p.name order by p.name) as pools, array_agg(p.id order by p.id) as ids from pool_member m
	join talent_pool p on p.id=m.pool_id where p.id in (${POOLS}) group by m.person_id),
	pdf as (select distinct on (s.person_id) s.person_id,s.parsed,j.company as recent_company,j.title as recent_title from profile_source s
	left join lateral(select w->>'company' as company,w->>'title' as title from jsonb_array_elements(s.parsed->'experiences') w order by (w->>'end'='至今') desc, (w->>'end') desc, (w->>'start') desc limit 1) j on true
	where s.pool_id in (${POOLS}) order by s.person_id,s.captured_at desc,s.seq desc)
	select p.person_id,h.emp_id,case when h.person_id is not null then '在职员工' else '外部候选人' end as talent_type,
	md5(coalesce(h.person_id,'') || coalesce(array_to_json(a.ids)::text,'') || coalesce((select string_agg(s.id,',' order by s.id) from profile_source s where s.person_id=p.person_id and s.pool_id=any(a.ids)), '')) as access_key, coalesce(a.pools,'{}') as pools,coalesce(d.recent_company,'') as recent_company,coalesce(d.recent_title,'') as recent_title,
	case when h.person_id is not null then p.name else d.parsed->>'name' end as name,
	case when h.person_id is not null then p.school else coalesce(d.parsed->>'school','') end as school,
	case when h.person_id is not null then p.education_level else coalesce(d.parsed->>'education','') end as education_level,
	case when h.person_id is not null then p.education_rank else array_position(array['高中及以下','大专','本科','硕士','博士'],d.parsed->>'education') end as education_rank,
	case when h.person_id is not null then p.school_tier else '' end as school_tier,
	case when h.person_id is not null then p.overseas_educated end as overseas_educated,
	coalesce(h.cur_dept,'') as cur_dept,coalesce(h.cur_dept_path,'') as cur_dept_path,coalesce(h.cur_title,'') as cur_title,
	coalesce(h.cur_seq_l1,'') as cur_seq_l1,coalesce(h.cur_seq_l2,'') as cur_seq_l2,coalesce(h.cur_seq_l3,'') as cur_seq_l3,
	coalesce(h.cur_level,'') as cur_level,coalesce(h.cur_level_band,'') as cur_level_band,h.cur_level_rank,h.hire_date,coalesce(h.recruitment,'') as recruitment
	from person p left join hr h using(person_id) left join accessible a using(person_id) left join pdf d using(person_id)
	where h.person_id is not null or a.person_id is not null`;
export const personCard = pgView("person_card", {
	personId: text("person_id").notNull(),
	empId: text("emp_id"),
	accessKey: text("access_key").notNull(),
	talentType: text("talent_type").notNull(),
	recentCompany: text("recent_company").notNull(),
	recentTitle: text("recent_title").notNull(),
	pools: text("pools").array().notNull(),
	...bio(),
	...job(),
}).as(CARDS);

/** 原始字段由同步写，推断序列与解析版本由解析任务写。`content_key` 是原始内容的数据库生成摘要。 */
export const experience = pgTable(
	"experience",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		personId: text("person_id")
			.notNull()
			.references(() => person.personId, { onDelete: "cascade" }),
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
		/** 外部：人事系统登记的公司档、企业性质 */
		companyMeta: jsonb("company_meta").$type<CompanyMeta>(),
		title: text("title").notNull().default(""),
		/** 内部：HR 登记的序列三级。外部段这三列永远是空——登记值不和推断值混在一列 */
		seqL1: text("seq_l1").notNull().default(""),
		seqL2: text("seq_l2").notNull().default(""),
		seqL3: text("seq_l3").notNull().default(""),
		/**
		 * 外部：模型按岗位名、公司名与描述对到公司序列树上的一对一级二级
		 * （`src/corpus/align.ts`），两列要么都有要么都空。只有序列筛选读它（目录视图的
		 * `seq_l1`、`seq_l2`：登记的优先，没有才读这两列），人页上标「按岗位名对齐」；
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
				sql`md5(person_id || E'\\x1f' || kind || E'\\x1f' || unemployed::text || E'\\x1f' || (start_date - date '1970-01-01')::text || E'\\x1f' || coalesce((end_date - date '1970-01-01')::text, '') || E'\\x1f' || company || E'\\x1f' || department || E'\\x1f' || department_path || E'\\x1f' || coalesce(company_meta::text, '') || E'\\x1f' || title || E'\\x1f' || seq_l1 || E'\\x1f' || seq_l2 || E'\\x1f' || seq_l3 || E'\\x1f' || level || E'\\x1f' || description)`,
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
		index("experience_person").on(t.personId, t.startDate),
		unique("segment_person_identity").on(t.id, t.personId),
		readPolicy(
			"experience_in_scope",
			sql`${ALL} or ${t.id} in (select experience_id from visible_segment)`,
		),
	],
);

/** 一段内容可由多份资料共同证明。相同内容只存、解析、计分一次。 */
export const profileExperience = pgTable(
	"profile_experience",
	{
		profileId: text("profile_id").notNull(),
		personId: personKey(),
		experienceId: integer("experience_id").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.profileId, t.experienceId] }),
		index("profile_experience_segment").on(t.experienceId),
		foreignKey({
			name: "origin_same_person",
			columns: [t.profileId, t.personId],
			foreignColumns: [profileSource.id, profileSource.personId],
		}).onDelete("cascade"),
		foreignKey({
			name: "segment_same_person",
			columns: [t.experienceId, t.personId],
			foreignColumns: [experience.id, experience.personId],
		}).onDelete("cascade"),
		readPolicy(
			"origin_scope",
			sql`${t.profileId} in (select id from visible_profile)`,
		),
	],
);
/** 入职前经历可对齐的公司现行序列，随数据源整表同步。 */
export const sequenceCatalog = pgTable(
	"sequence_catalog",
	{
		seqL1: text("seq_l1").notNull(),
		seqL2: text("seq_l2").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.seqL1, t.seqL2] }),
		check(
			"sequence_catalog_names",
			sql`btrim(${t.seqL1}) <> '' and btrim(${t.seqL2}) <> ''`,
		),
	],
);

export type PersonCard = typeof personCard.$inferSelect;
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
		check("record_stream_kind_valid", sql`${t.kind} in ('rating', 'status')`),
	],
);

/**
 * 职级档和学历档在档位表里的流名。同步按它写（`corpus/pipeline.ts`），关键词链条件的「某档及以上」
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
 * 行业树，一个行业一行；`parent` 是上一级，顶层为空。细分的赛道是行业的下级。
 * 公司知识的三张表都由同步整表重写，数据源没有这部分知识时为空。
 */
export const industry = pgTable("industry", {
	name: text("name").primaryKey(),
	parent: text("parent").references((): AnyPgColumn => industry.name, {
		onDelete: "cascade",
	}),
});

/**
 * 入职前待过的公司是什么。只有人才库里出现过的公司。两列行业都已连同上级展开：
 * `industries` 是做的全部行业，`main_industries` 是其中的主营。`circles` 是它属于的名企组合。
 */
export const company = pgTable("company", {
	name: text("name").primaryKey(),
	groupName: text("group_name").notNull(),
	industries: text("industries").array().notNull(),
	mainIndustries: text("main_industries").array().notNull(),
	circles: text("circles").array().notNull(),
});

/** 经历上登记的公司写法（`experience.company` 原样）对到哪家公司。 */
export const companyAlias = pgTable("company_alias", {
	rawName: text("raw_name").primaryKey(),
	company: text("company")
		.notNull()
		.references(() => company.name, { onDelete: "cascade" }),
});

/**
 * 按期登记的记录：评级一期一行，状态一段一行。同一人同一流同一期只有一行，修订在
 * 同步时去重（只留最终一条）。没有某一期的行表示没有记录，不表示任何档。
 */
export const employeeRecord = pgTable(
	"employee_record",
	{
		personId: text("person_id")
			.notNull()
			.references(() => employment.personId, { onDelete: "cascade" }),
		stream: text("stream")
			.notNull()
			.references(() => recordStream.stream, { onDelete: "cascade" }),
		periodStart: date("period_start").notNull(),
		/** 评级是这一期的结束日；状态为空表示仍有效 */
		periodEnd: date("period_end"),
		value: text("value").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.personId, t.stream, t.periodStart] }),
		check(
			"employee_record_period_ordered",
			sql`${t.periodEnd} is null or ${t.periodEnd} >= ${t.periodStart}`,
		),
		readPolicy(
			"employee_record_in_scope",
			sql`${t.personId} in (select person_id from visible_employment)`,
		),
	],
);

/**
 * 数据目录：查询条件里模型写的 SQL 只能读这个 schema 里的视图（`server/sandbox.ts`
 * 以只读角色执行）。视图不含姓名，也不含简历原文：做过什么由命中表 `hit`
 * 回答（按字面捞到、AI 确认过的段），模型不按原文筛。每一列的中文名、含义和口径在 `search/catalog.ts`。
 * 空串一律读成 null：模型写 `is null` 就是「没有记录」。
 * 视图以属主身份执行，带人的四个视图各自只留这一次读取看得到的人（`VISIBLE`）。
 */
export const catalog = pgSchema("catalog");

export const catalogPerson = catalog
	.view("person", {
		talent_type: text("talent_type"),
		pools: text("pools").array(),
		person_id: text("person_id"),
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
	.as(sql`select person_id,talent_type,pools,
		nullif(cur_level_band, '') as level_band, cur_level_rank as level_rank,
		nullif(education_level, '') as education, education_rank,
		nullif(school, '') as school, nullif(school_tier, '') as school_tier,
		case overseas_educated when true then '是' when false then '否' end as overseas,
		nullif(recruitment, '') as recruitment, hire_date,
		nullif(cur_dept, '') as cur_dept, nullif(cur_seq_l1, '') as cur_seq_l1,
		nullif(cur_seq_l2, '') as cur_seq_l2, nullif(cur_seq_l3, '') as cur_seq_l3
	from (${CARDS}) card`);

/**
 * 一段工作经历；待业段不在这里。序列登记的优先，没有才取模型对齐的（两级成对）；
 * `skills` 是这段抽出的能力词的标准写法连同全部更宽的词。
 */
export const catalogExperience = catalog
	.view("experience", {
		id: integer("id"),
		person_id: text("person_id"),
		kind: text("kind"),
		start_date: date("start_date"),
		end_date: date("end_date"),
		months: integer("months"),
		company: text("company"),
		company_tag: text("company_tag"),
		company_nature: text("company_nature"),
		company_name: text("company_name"),
		company_group: text("company_group"),
		main_industries: text("main_industries").array(),
		industries: text("industries").array(),
		company_circles: text("company_circles").array(),
		department: text("department"),
		department_path: text("department_path"),
		title: text("title"),
		level: text("level"),
		seq_l1: text("seq_l1"),
		seq_l2: text("seq_l2"),
		skills: text("skills").array(),
	})
	.as(sql`select e.id, e.person_id, e.kind, e.start_date, e.end_date, e.months,
		nullif(e.company, '') as company,
		nullif(e.company_meta ->> 'company_tag', '') as company_tag,
		nullif(e.company_meta ->> 'nature', '') as company_nature,
		c.name as company_name, c.group_name as company_group,
		nullif(c.main_industries, '{}') as main_industries,
		nullif(c.industries, '{}') as industries,
		nullif(c.circles, '{}') as company_circles,
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
					and t.excluded is not true
				union
				select t.parent from up join term t on t.word = up.word
				where t.parent is not null
			)
			select word from up order by word) as skills
	from experience e
	left join company_alias ca on ca.raw_name = e.company and e.kind = 'external'
	left join company c on c.name = ca.company
	where not e.unemployed and (${ALL} or e.id in (${SEGMENTS}))`);

/** 一期评级。`value_rank` 是这一档在档位表里的高低。 */
export const catalogRating = catalog
	.view("rating", {
		person_id: text("person_id"),
		stream: text("stream"),
		period_start: date("period_start"),
		period_end: date("period_end"),
		value: text("value"),
		value_rank: integer("value_rank"),
	})
	.as(sql`select r.person_id, r.stream, r.period_start, r.period_end, r.value,
		s.rank as value_rank
	from employee_record r
	join record_stream rs on rs.stream = r.stream and rs.kind = 'rating'
	left join scale s on s.stream = r.stream and s.value = r.value
	where r.person_id in (${HR})`);

/** 一段状态；`valid_to` 为空表示仍有效。 */
export const catalogStatus = catalog
	.view("status", {
		person_id: text("person_id"),
		stream: text("stream"),
		value: text("value"),
		valid_from: date("valid_from"),
		valid_to: date("valid_to"),
	})
	.as(sql`select r.person_id, r.stream, r.value,
		r.period_start as valid_from, r.period_end as valid_to
	from employee_record r
	join record_stream rs on rs.stream = r.stream and rs.kind = 'status'
	where r.person_id in (${HR})`);

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

/** 嵌入维数的唯一来源；更换维数必须同时更换 `EMBED_SPACE_ID`。 */
export const EMBED_DIM = 1024;

/**
 * 词的向量缓存，整理把相近的写法凑成组时用（`corpus/embed.ts`）。跨语料保留；
 * 文本用 sha256 键入，避免超长 btree 索引项。
 */
export const embeddingCache = pgTable(
	"embedding_cache",
	{
		spaceId: text("space_id").notNull(),
		model: text("model").notNull(),
		textSha: text("text_sha").notNull(),
		embedding: real("embedding").array().notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.spaceId, t.model, t.textSha] }),
		// 一维、正好 `EMBED_DIM` 个分量：维数不对的向量进不了缓存
		check(
			"embedding_cache_dim",
			sql`array_ndims(${t.embedding}) = 1
				and cardinality(${t.embedding}) = ${sql.raw(String(EMBED_DIM))}`,
		),
	],
);

/** 解析模型回答缓存。identity 包含模型、提示词和回答形状，payload 是工具接收的回答。 */
export const completionCache = pgTable(
	"completion_cache",
	{
		identity: text("identity").notNull(),
		textSha: text("text_sha").notNull(),
		payload: jsonb("payload").notNull(),
	},
	(t) => [primaryKey({ columns: [t.identity, t.textSha] })],
);

/** 内置和外部解析共用同一输入的一份结果；原文从仍在库里的经历读取。 */
export const deriveRequest = pgTable(
	"derive_request",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		standard: text("standard").notNull(),
		inputKey: text("input_key").notNull(),
		experienceId: integer("experience_id").references(() => experience.id, {
			onDelete: "set null",
		}),
		result: jsonb("result"),
		failedVersion: text("failed_version"),
	},
	(t) => [
		unique().on(t.standard, t.inputKey),
		index("derive_request_experience").on(t.experienceId),
		index("derive_request_pending")
			.on(t.standard, t.id)
			.where(sql`${t.result} is null and ${t.failedVersion} is null`),
		check(
			"derive_request_one_result",
			sql`num_nonnulls(${t.result},${t.failedVersion}) <= 1`,
		),
	],
);

/** 此部署的解析排班偏好，管理员第一次设置后覆盖环境默认值。 */
export const deriveSchedule = pgTable(
	"derive_schedule",
	{
		kind: text("kind").primaryKey(),
		enabled: boolean("enabled").notNull(),
	},
	(t) => [check("derive_schedule_kind_derive", sql`${t.kind} = 'derive'`)],
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

/**
 * 词表：对一个短说法的判断——标准写法、宽细归属、是不是能力。判断说的是这个词本身，
 * 跨语料保留，没人写了也不删；此刻用着哪些词由 `termInUse` 推出来。不改经历上的原始说法。
 */
export const term = pgTable(
	"term",
	{
		word: text("word").primaryKey(),
		canonical: text("canonical").notNull(),
		/** 别名被退回、还没重新判：检索照旧按原来那一项算，新的同义判定不顺着它合并整项。 */
		aliasSentBack: boolean("alias_sent_back").notNull().default(false),
		parent: text("parent").references((): AnyPgColumn => term.word),
		/** 判定方认定它不是一项能力：不进筛选栏、候选词和参考词，人身上的说法不动。 */
		excluded: boolean("excluded").notNull().default(false),
		/**
		 * 上次判它的时间；null 是还没判过或被退回重判。收集只看此刻有人写的词：
		 * 没人写的词留着空值，等有人写它时再判。
		 */
		reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
	},
	(t) => [
		check(
			"term_parent_on_canonical",
			sql`${t.parent} is null or (${t.canonical} = ${t.word} and ${t.parent} <> ${t.word})`,
		),
		check(
			"term_excluded_alone",
			sql`not ${t.excluded} or (${t.canonical} = ${t.word} and ${t.parent} is null)`,
		),
	],
);

/** 待判队列：一个词连同它的参考词等着判它在词表里的位置，判定生效时写进 `term` 并删除这一行。 */
export const reviewWord = pgTable(
	"review_word",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		/** 收集与判定这个词所依据的 GUIDE 与回答形状摘要。 */
		guideIdentity: text("guide_identity").notNull(),
		word: text("word").notNull().unique(),
		/** 收集那一刻的人数：标准词连同它的其他写法和它下面的词一起数，别名只数写了这个写法的人。 */
		people: integer("people").notNull(),
		/** 词表里和它写法最接近的几个词，各带人数。 */
		near: jsonb("near").$type<{ word: string; people: number }[]>().notNull(),
		collectedAt: timestamp("collected_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		judge: text("judge"),
		/** 判定原话；生效时做领域校验。 */
		judgment: jsonb("judgment"),
	},
	(t) => [
		check(
			"review_word_judged",
			sql`(${t.judge} is null) = (${t.judgment} is null)`,
		),
	],
);

/**
 * 一段经历说自己做过什么的四类说法（组合方式见 `corpus/route-texts.ts`）：公司内一段任职
 * 整句一条，入职前的岗位名，读出来的能力，没读过的简历原文。
 * 公司名和单独的部门名只回答「在哪」，不在这里。
 */
const ROUTES = ["role", "title", "description", "skill"] as const;
export type Route = (typeof ROUTES)[number];
/** 短说法：几个字的能力词、入职前岗位名。现在用着的词（`termInUse`）和关键词搜索的候选词共用此范围。 */
export const SHORT_ROUTES = [
	"skill",
	"title",
] as const satisfies readonly Route[];

/**
 * 去重后的说法。未读段的整段原文也是说法，可以长过 btree 一行的上限，
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
		/** 能力那一类的投入档（`lib/engagement.ts`），排名时给深度打折；其余类为空。 */
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
		// 段看得见，它的边才看得见：子查询读 experience 时那张表自己的策略同样生效
		pgPolicy("experience_phrase_in_scope", {
			for: "select",
			to: "public",
			using: sql`${t.experienceId} in (select id from experience)`,
		}),
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

/**
 * 现在用着的词：词表的判断套在此刻的简历上推出来，每次读都是当下的语料，不另存一份。
 *
 * 一行一个词：有人写的每种短说法（标准词、并进去的写法、还没进词表的词），以及下面有人写的
 * 更宽的词。判成不是能力的词也在，读的一方自己挑。
 *
 * 词表本身（`term`）是对一个词的判断，跟有没有人写它无关，所以没人写了也留着，词再出现时
 * 不用重判；没人写的词不在这里，标签页和整理只读这里。
 */
export const termInUse = pgView("term_in_use", {
	word: text("word").notNull(),
	/**
	 * 标准词（还没进词表的词按它自己算）和更宽的词：连同其他写法和全部细分一起数的人；
	 * 并进去的写法只数写了这一种的人。
	 */
	people: integer("people").notNull(),
	/** 写了这一种写法本身的人；判定方起名、没人照这个写法写的更宽的词是 0 */
	writers: integer("writers").notNull(),
})
	// 以读的一方的身份执行：请求读到的人数只数它数据范围里的人，整理（表的属主）数全部
	.with({ securityInvoker: true })
	.as(
		/* 「谁写了哪个词」是不重复的集合（`written` 去重，`up` 的 union 不留重复），人数就是行数 */
		sql`with recursive written as (
			select distinct p.text as word, coalesce(t.canonical, p.text) as head, e.person_id
			from experience_phrase ep
			join phrase p on p.id = ep.phrase_id
			join experience e on e.id = ep.experience_id and not e.unemployed
			left join term t on t.word = p.text
			where ep.route in (${sql.raw(SHORT_ROUTES.map((route) => `'${route}'`).join(", "))})
		), own as (
			select word, head, count(*)::int as writers from written group by word, head
		), up(word, person_id) as (
			select head, person_id from written
			union
			select t.parent, up.person_id from up
			join term t on t.word = up.word and t.parent is not null
		)
		select under.word, under.people, coalesce(own.writers, 0) as writers
		from (select word, count(*)::int as people from up group by word) under
		left join own on own.word = under.word
		union all
		select word, writers, writers from own where word <> head`,
	);

/**
 * 不可变查询记录；仅待理解记录允许把 spec 从 null 补全一次。
 *
 * 对话的一轮写下之后 AI 接着处理它（`attempt` 开头的这几列）：说了一句话的一轮是理解这句话、写出
 * 条件、把候选人的经历确认完；直接改条件的一轮条件已经有了，只把新进范围的候选人确认完。
 */
export const searchTurn = pgTable(
	"search_turn",
	{
		id: text("id").primaryKey(),
		/**
		 * 发起这次找人任务的账号。一次任务只属于一个人，整条链同一个值（`search_turn_chain`）；
		 * 读、追加、重试、删除都只对它开放（`server/turn.ts`）。
		 */
		ownerId: text("owner_id")
			.notNull()
			.references(() => authUser.id),
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
		/** AI 处理这一轮时用工具走过的步骤，边跑边追加；不用 AI 处理的一轮没有。 */
		trace: jsonb("trace").$type<TraceStep[]>(),
		/**
		 * AI 这一次处理的编号。一轮写入时就开始，重试换一个新编号；写步骤、结果和失败原因都只写
		 * 编号还是自己的那一行，被换掉的那一次写不进来。说了一句话的一轮一定有；直接改条件的一轮
		 * 条件里有要 AI 确认的经历时才有。没有编号的一轮，`trace` 和开始的时刻也没有（`search_turn_attempt`）。
		 */
		attempt: text("attempt"),
		/**
		 * 这一次处理开始的时刻，和编号、清空 `trace` 同时写：等待时的计时和完成后的用时
		 * 都从它算，重试过也只算这一次。
		 */
		attemptStartedAt: timestamp("attempt_started_at", {
			withTimezone: true,
		}),
		/** 处理进程的最近心跳，排队和模型调用期间也更新；不用于界面的用时计算。 */
		attemptHeartbeatAt: timestamp("attempt_heartbeat_at", {
			withTimezone: true,
		}),
		/** 这一次处理为什么没成（`server/turn.ts` 的 `AttemptFault`）；还在处理或已完成为 null。 */
		attemptFault: text("attempt_fault"),
		/**
		 * 这一次处理做完了。说了一句话的一轮，它和条件同时写下；直接改条件的一轮，候选人确认完
		 * 时写下。
		 */
		attemptDone: boolean("attempt_done").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		check(
			"search_turn_state",
			sql`${t.spec} is not null or ${t.rawText} is not null`,
		),
		unique("search_turn_owner").on(t.id, t.ownerId),
		// 链上每一轮的归属都是链头的归属：换不了人，也接不到别人的链上
		foreignKey({
			name: "search_turn_chain",
			columns: [t.rootTurnId, t.ownerId],
			foreignColumns: [t.id, t.ownerId],
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
			"search_turn_attempt",
			sql`(${t.rawText} is null or ${t.attempt} is not null)
				and (${t.attempt} is null) = (${t.attemptStartedAt} is null)
				and (${t.attempt} is null) = (${t.trace} is null)`,
		),
		check(
			"search_turn_done",
			sql`case when ${t.rawText} is null
				then not ${t.attemptDone} or ${t.attempt} is not null
				else ${t.attemptDone} = (${t.spec} is not null) end`,
		),
		check(
			"search_turn_failed",
			sql`${t.attemptFault} is null
				or (${t.attempt} is not null and not ${t.attemptDone})`,
		),
		index("search_turn_root").on(t.rootTurnId),
		index("search_turn_recent").on(t.ownerId, t.createdAt),
	],
);

export type SearchTurn = typeof searchTurn.$inferSelect;

/**
 * 读过一段经历之后的结论：一次找人任务里，一条判据下这一段算不算。结论只在产生它的
 * 那次任务里算数（`root_turn_id` 是那条链的链头），链删掉时一起删。`criterion_key` 是判据文字的
 * 摘要，`content` 是确认的时候这一段的内容键和解析版本（`search/verdict.ts`），段的内容或解析结果
 * 变了就对不上，按没确认过算。不算的也存。
 */
export const experienceVerdict = pgTable(
	"experience_verdict",
	{
		rootTurnId: text("root_turn_id").notNull(),
		criterionKey: text("criterion_key").notNull(),
		content: text("content").notNull(),
		fits: boolean("fits").notNull(),
		matchScore: integer("match_score"),
		scoreTextKey: text("score_text_key"),
	},
	(t) => [
		primaryKey({ columns: [t.rootTurnId, t.criterionKey, t.content] }),
		check(
			"experience_verdict_positive_score",
			sql`(${t.matchScore} is null) = (${t.scoreTextKey} is null)
			and (${t.matchScore} is null or (${t.fits} and ${t.matchScore} between 1 and 100))`,
		),
		index("experience_verdict_scored_text")
			.on(t.rootTurnId, t.criterionKey, t.scoreTextKey)
			.where(sql`${t.scoreTextKey} is not null`),
		foreignKey({
			name: "experience_verdict_root",
			columns: [t.rootTurnId],
			foreignColumns: [searchTurn.id],
		}).onDelete("cascade"),
	],
);

/**
 * 操作记录：哪个账号在什么时候做了什么（`lib/audit.ts`），只追加。一行只有一个对象：搜索记的是
 * 那一轮说的话或改完的条件，查看和导出一个人一行、记工号，管理账号记那个账号。它自己带着内容，
 * 不引用搜索记录和员工档案：搜索被删、员工随同步消失之后，这一行照样读得出来；账号不删除，可以引用。
 * 读者是管理员的审计页（`server/audit.ts`）。
 */
export const auditEvent = pgTable(
	"audit_event",
	{
		id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
		at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
		userId: text("user_id").references(() => authUser.id),
		action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
		/** 查看详情、导出或交给外部解析服务的是谁。 */
		personId: text("person_id"),
		/** 搜索的内容。 */
		text: text("text"),
		/** 管理的是哪个账号。 */
		accountId: text("account_id").references(() => authUser.id),
	},
	(t) => [
		check(
			"audit_object_source_v2",
			sql`num_nonnulls(${t.text}, ${t.personId}, ${t.accountId}) = 1 and
				(${t.userId} is null) = (${t.action} = 'derive-read') and
				case ${t.action}
					when 'derive-read' then ${t.personId} is not null
					when 'search' then ${t.text} is not null
					when 'view' then ${t.personId} is not null
					when 'resume-preview' then ${t.personId} is not null
 when 'resume-download' then ${t.personId} is not null
 when 'talent-add' then ${t.personId} is not null
 when 'talent-link' then ${t.personId} is not null
 when 'talent-remove' then ${t.personId} is not null
 when 'export' then ${t.personId} is not null
					else ${t.accountId} is not null end`,
		),
	],
);

/** 每张含个人或来源资料的表都随读者角色安装这里定义的策略。 */
export const SCOPED_TABLES = [
	poolTouch,
	resumeImport,
	person,
	personIdentity,
	employment,
	talentPool,
	poolMember,
	resumeFile,
	profileSource,
	profileExperience,
	experience,
	employeeRecord,
	experiencePhrase,
] as const;
