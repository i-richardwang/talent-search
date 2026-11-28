/**
 * 数据页看的东西：库里此刻有谁、每个人的每一段、以及解析给这一段算出了什么。
 *
 * 检索给招聘的人看命中；这两页给管数据的人看**库里到底是什么**——同步进来的
 * 原始一半和解析写上的那一半并排放着，一段有没有解析到当前版本、抽出了哪些能力词
 * 和各自的投入档、对到了哪个序列，都在这里核对。只读。
 */

import "@tanstack/react-start/server-only";
import { asc, eq, sql } from "drizzle-orm";
import { deriveStandard } from "#/corpus/derive-standard";
import {
	company,
	companyAlias,
	type Employee,
	type Experience,
	experience,
	personCard,
} from "#/db/schema";
import {
	type Scope,
	withCorpusSnapshot,
	withReadSnapshot,
} from "#/db/snapshot";
import type { Engagement } from "#/lib/engagement";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";
import type { EmployeeDetail } from "#/search/result";

/** 数据页那张表的一行。 */
export type EmployeeRow = Pick<
	Employee,
	"personId" | "name" | "curDept" | "curTitle"
> & {
	/** 这个人有几段 */
	empId?: string | null;
	talentType?: string;
	segments: number;
	/** 其中几段还没解析到当前版本 */
	pending: number;
};

/**
 * 在 `scope` 看得到的人里按名字或工号找，一页 `PAGE_SIZE` 个（`lib/paging.ts`）；不给词就按
 * 工号从头列。
 */
export async function listEmployees(
	scope: Scope,
	needle: string,
	page: unknown,
): Promise<TablePage<EmployeeRow>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	return withReadSnapshot(scope, async (client) => {
		const { version } = await deriveStandard(client);
		const found = await client.query<{ n: string }>(
			"select count(*) as n from person_card where name ilike $1 or emp_id ilike $1",
			[pattern],
		);
		const total = Number(found.rows[0]?.n ?? 0);
		const at = pageAt(total, page);
		const { rows } = await client.query<EmployeeRow>(
			`select e.person_id as "personId", e.name,e.emp_id as "empId",e.talent_type as "talentType",e.cur_dept as "curDept",
			case when e.talent_type='外部候选人' then e.recent_title else e.cur_title end as "curTitle",
			count(x.id)::int as segments,
			count(x.id) filter (where x.derived_identity is distinct from $1)::int as pending
		 from person_card e
		 left join experience x on x.person_id = e.person_id
		 where e.name ilike $2 or e.emp_id ilike $2
		 group by e.person_id,e.emp_id,e.name,e.cur_dept,e.cur_title,e.talent_type,e.recent_title
		 order by e.person_id
		 limit ${at.limit} offset ${at.offset}`,
			[version, pattern],
		);
		return tablePage(rows, total, at);
	});
}

/** 已收藏的旧链接以工号寻址；只有能读到雇佣关系的账号可以解析它。 */
export function employeeNumberToPerson(scope: Scope, number: string) {
	return withReadSnapshot(
		scope,
		async (c) =>
			(
				await c.query<{ person_id: string }>(
					"select person_id from employment where emp_id=$1",
					[number],
				)
			).rows[0]?.person_id,
	);
}
/** 这些工号是不是都在 `scope` 里。 */
export async function allVisible(
	scope: Scope,
	personIds: readonly string[],
	accessKeys?: readonly string[],
): Promise<boolean> {
	return withReadSnapshot(scope, async (client) => {
		const { rows } = await client.query<{ n: number }>(
			`select count(*)::int as n from person_card c join unnest($1::text[],$2::text[]) pick(id,stamp) on pick.id=c.person_id
				where ($2::text[] is null or pick.stamp=c.access_key)`,
			[personIds, accessKeys ?? null],
		);
		return rows[0]?.n === new Set(personIds).size;
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

export type EmployeeProfile = EmployeeDetail["employee"];

type EmployeeData = {
	employee: EmployeeProfile;
	segments: SegmentView[];
};

/** `scope` 看得到的一个人的档案和每一段；看不到和没有这个人一样是 null。 */
export async function employeeData(
	scope: Scope,
	personId: string,
): Promise<EmployeeData | null> {
	return withReadSnapshot(scope, async (client) => {
		const { version } = await deriveStandard(client);
		const found = await client.query<EmployeeProfile>(
			`select person_id as "personId", name,emp_id as "empId",talent_type as "talentType",recent_company as "recentCompany",recent_title as "recentTitle", cur_dept as "curDept", cur_title as "curTitle",
			cur_seq_l1 as "curSeqL1", cur_seq_l2 as "curSeqL2", cur_seq_l3 as "curSeqL3",
			cur_level as "curLevel", hire_date::text as "hireDate",
			education_level as "educationLevel", school, school_tier as "schoolTier",
			overseas_educated as "overseasEducated", recruitment
		 from person_card where person_id = $1`,
			[personId],
		);
		const employee = found.rows[0];
		if (!employee) return null;

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
			[personId, version],
		);
		return {
			employee,
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
export function employeeDetail(
	scope: Scope,
	personId: string,
): Promise<EmployeeDetail | null> {
	return withCorpusSnapshot(scope, async (store) => {
		const [emp] = await store
			.select({
				personId: personCard.personId,
				empId: personCard.empId,
				talentType: personCard.talentType,
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
			.where(eq(personCard.personId, personId));
		if (!emp) return null;
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
			.where(eq(experience.personId, personId))
			.orderBy(asc(experience.startDate), asc(experience.id));
		return { employee: emp, timeline };
	});
}
