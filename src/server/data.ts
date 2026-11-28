/**
 * 数据页看的东西：库里此刻有谁、每个人的每一段、以及解析给这一段算出了什么。
 *
 * 检索给招聘的人看命中；这两页给管数据的人看**库里到底是什么**——同步进来的
 * 原始一半和解析写上的那一半并排放着，一段有没有解析到当前版本、抽出了哪些能力词
 * 和各自的投入档、对到了哪个序列，都在这里核对。只读。
 */

import "@tanstack/react-start/server-only";
import { asc, desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { deriveStandard } from "#/corpus/derive-standard";
import {
	company,
	companyAlias,
	type Experience,
	experience,
	type PersonCard,
	personCard,
} from "#/db/schema";
import {
	type DbExecutor,
	type Scope,
	withCorpusSnapshot,
	withReadSnapshot,
} from "#/db/snapshot";
import type { Engagement } from "#/lib/engagement";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";
import type { PersonDetail, ResultPerson } from "#/search/result";

/** 数据页那张表的一行。 */
export type PersonRow = Pick<
	PersonCard,
	| "personId"
	| "name"
	| "curDept"
	| "curTitle"
	| "recentCompany"
	| "recentTitle"
	| "empId"
	| "talentType"
> & {
	/** 这个人有几段 */
	segments: number;
	/** 其中几段还没解析到当前版本 */
	pending: number;
};

/**
 * 在 `scope` 看得到的人里按名字、工号或最近公司找，一页 `PAGE_SIZE` 个（`lib/paging.ts`）；不给词就按
 * 人员编号从头列。
 */
export async function listPeople(
	scope: Scope,
	needle: string,
	page: unknown,
): Promise<TablePage<PersonRow>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	return withReadSnapshot(scope, async (client) => {
		const { version } = await deriveStandard(client);
		const match =
			"(e.name ilike $1 or e.emp_id ilike $1 or e.recent_company ilike $1)";
		const found = await client.query<{ n: string }>(
			`select count(*) as n from person_card e where ${match}`,
			[pattern],
		);
		const total = Number(found.rows[0]?.n ?? 0);
		const at = pageAt(total, page);
		const { rows } = await client.query<PersonRow>(
			`select e.person_id as "personId", e.name,e.emp_id as "empId",e.talent_type as "talentType",e.cur_dept as "curDept",
			e.cur_title as "curTitle",e.recent_company as "recentCompany",e.recent_title as "recentTitle",
			count(x.id)::int as segments,
			count(x.id) filter (where x.derived_identity is distinct from $2)::int as pending
		 from person_card e
		 left join experience x on x.person_id = e.person_id
		 where ${match}
		 group by e.person_id,e.emp_id,e.name,e.cur_dept,e.cur_title,e.talent_type,e.recent_company,e.recent_title
		 order by e.person_id
		 limit ${at.limit} offset ${at.offset}`,
			[pattern, version],
		);
		return tablePage(rows, total, at);
	});
}

/** 导出快照中的每个人及其资料范围须与当前账号可见的名片一致。 */
export function canExport(
	scope: Scope,
	selected: readonly Pick<ResultPerson, "personId" | "accessKey">[],
) {
	return withReadSnapshot(scope, async (client) => {
		const {
			rows: [result],
		} = await client.query<{ n: number }>(
			`select count(distinct p.person_id)::int as n
			from jsonb_to_recordset($1) selection("personId" text, "accessKey" text)
			join person_card p on p.person_id=selection."personId" and p.access_key=selection."accessKey"`,
			[JSON.stringify(selected)],
		);
		return selected.length > 0 && result?.n === selected.length;
	});
}

/** 一段连它的解析结果。 */
export type SegmentView = Pick<
	Experience,
	| "id"
	| "kind"
	| "startDate"
	| "endDate"
	| "months"
	| "company"
	| "department"
	| "departmentPath"
	| "title"
	| "level"
	| "description"
	| "seqL1"
	| "seqL2"
	| "seqL3"
	| "seqInferredL1"
	| "seqInferredL2"
	| "unanswered"
> & {
	/** 解析到当前版本了没有 */
	derived: boolean;
	skills: { text: string; engagement: Engagement | null }[];
};

export type PersonProfile = PersonDetail["person"];

type PersonData = {
	person: PersonProfile;
	segments: SegmentView[];
};

/** 两个详情入口共用可见名片。人员编号优先，可见的工号也能定位到同一份档案。 */
async function profileFor(
	store: Pick<DbExecutor, "select">,
	reference: string,
) {
	const [person] = await store
		.select({
			personId: personCard.personId,
			empId: personCard.empId,
			talentType: personCard.talentType,
			pools: personCard.pools,
			recentCompany: personCard.recentCompany,
			recentTitle: personCard.recentTitle,
			name: personCard.name,
			curDept: personCard.curDept,
			curTitle: personCard.curTitle,
			curSeqL1: personCard.curSeqL1,
			curSeqL2: personCard.curSeqL2,
			curSeqL3: personCard.curSeqL3,
			curLevel: personCard.curLevel,
			hireDate: personCard.hireDate,
			educationLevel: personCard.educationLevel,
			school: personCard.school,
			schoolTier: personCard.schoolTier,
			overseasEducated: personCard.overseasEducated,
			recruitment: personCard.recruitment,
		})
		.from(personCard)
		.where(
			sql`${personCard.personId} in (${reference}, (select person_id from employment where emp_id=${reference}))`,
		)
		.orderBy(desc(eq(personCard.personId, reference)))
		.limit(1);
	return person ?? null;
}

/** `scope` 看得到的一个人的档案和每一段；看不到和没有这个人一样是 null。 */
export async function personData(
	scope: Scope,
	reference: string,
): Promise<PersonData | null> {
	return withReadSnapshot(scope, async (client) => {
		const { version } = await deriveStandard(client);
		const person = await profileFor(drizzle(client), reference);
		if (!person) return null;

		const { rows } = await client.query<
			Omit<SegmentView, "skills"> & { skills: SegmentView["skills"] | null }
		>(
			`select x.id, x.kind, x.start_date::text as "startDate", x.end_date::text as "endDate",
			x.months, x.company, x.department, x.department_path as "departmentPath", x.title, x.level, x.description,
			x.seq_l1 as "seqL1", x.seq_l2 as "seqL2", x.seq_l3 as "seqL3",
			x.seq_inferred_l1 as "seqInferredL1", x.seq_inferred_l2 as "seqInferredL2",
			x.derived_identity is not distinct from $2 as derived, x.unanswered,
			(select json_agg(json_build_object('text', p.text, 'engagement', ep.engagement) order by p.text)
			 from experience_phrase ep join phrase p on p.id = ep.phrase_id
			 where ep.experience_id = x.id and ep.route = 'skill') as skills
		 from experience x
		 where x.person_id = $1
		 order by x.start_date, x.id`,
			[person.personId, version],
		);
		return {
			person,
			segments: rows.map((row) => ({
				...row,
				skills: row.skills ?? [],
			})),
		};
	});
}

/**
 * 单人详情只读取展示所需的字段，存储身份与解析状态留在服务端。`scope` 看不到的人和没有
 * 这个人一样是 null。
 */
export function personDetail(
	scope: Scope,
	reference: string,
): Promise<PersonDetail | null> {
	return withCorpusSnapshot(scope, async (store) => {
		const person = await profileFor(store, reference);
		if (!person) return null;
		const timeline = await store
			.select({
				id: experience.id,
				kind: experience.kind,
				startDate: experience.startDate,
				endDate: experience.endDate,
				company: experience.company,
				department: experience.department,
				departmentPath: experience.departmentPath,
				companyMeta: experience.companyMeta,
				title: experience.title,
				level: experience.level,
				description: experience.description,
				seqL1: experience.seqL1,
				seqL2: experience.seqL2,
				seqL3: experience.seqL3,
				seqInferredL1: experience.seqInferredL1,
				seqInferredL2: experience.seqInferredL2,
				months: experience.months,
				// 库里的主营连同上级；详情只写最细的一级，上级从它看得出来
				mainIndustries: sql<string[]>`array(
					select m from unnest(${company.mainIndustries}) as m
					where not exists (
						select 1 from industry i
						where i.parent = m and i.name = any(${company.mainIndustries}))
					order by m)`,
			})
			.from(experience)
			.leftJoin(companyAlias, eq(companyAlias.rawName, experience.company))
			.leftJoin(company, eq(company.name, companyAlias.company))
			.where(eq(experience.personId, person.personId))
			.orderBy(asc(experience.startDate), asc(experience.id));
		return { person, timeline };
	});
}
