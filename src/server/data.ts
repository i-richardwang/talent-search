/**
 * 数据页看的东西：库里此刻有谁、每个人的每一段、以及派生给这一段算出了什么。
 *
 * 检索给招聘的人看命中；这两页给管数据的人看**库里到底是什么**——同步进来的
 * 原始一半和派生写上的那一半并排放着，一段有没有派生到当前版本、抽出了哪些能力词
 * 和做过的事、对到了哪个序列，都在这里核对。只读。
 */

import "@tanstack/react-start/server-only";
import { asc, eq } from "drizzle-orm";
import { currentTree, identity } from "#/corpus/derive";
import {
	type Employee,
	type Experience,
	employee,
	experience,
} from "#/db/schema";
import { withCorpusSnapshot, withReadSnapshot } from "#/db/snapshot";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";
import type { EmployeeDetail } from "#/search/result";

/** 数据页那张表的一行。 */
export type EmployeeRow = Pick<
	Employee,
	"empId" | "name" | "curDept" | "curTitle"
> & {
	/** 这个人有几段 */
	segments: number;
	/** 其中几段还没派生到当前版本 */
	pending: number;
};

/** 按名字或工号找人，一页 `PAGE_SIZE` 个（`lib/paging.ts`）；不给词就按工号从头列。 */
export async function listEmployees(
	needle: string,
	page: unknown,
): Promise<TablePage<EmployeeRow>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	return withReadSnapshot(async (client) => {
		const version = identity(await currentTree(client));
		const found = await client.query<{ n: string }>(
			"select count(*) as n from employee where name ilike $1 or emp_id ilike $1",
			[pattern],
		);
		const total = Number(found.rows[0]?.n ?? 0);
		const at = pageAt(total, page);
		const { rows } = await client.query<EmployeeRow>(
			`select e.emp_id as "empId", e.name, e.cur_dept as "curDept",
			e.cur_title as "curTitle",
			count(x.id)::int as segments,
			count(x.id) filter (where x.derived_identity is distinct from $1)::int as pending
		 from employee e
		 left join experience x on x.emp_id = e.emp_id
		 where e.name ilike $2 or e.emp_id ilike $2
		 group by e.emp_id
		 order by e.emp_id
		 limit ${at.limit} offset ${at.offset}`,
			[version, pattern],
		);
		return tablePage(rows, total, at);
	});
}

/** 一段连它的派生结果。 */
export type SegmentView = Pick<
	Experience,
	| "id"
	| "kind"
	| "startDate"
	| "endDate"
	| "months"
	| "org"
	| "orgPath"
	| "title"
	| "level"
	| "description"
	| "seqL1"
	| "seqL2"
	| "seqL3"
	| "seqInferredL1"
	| "seqInferredL2"
> & {
	/** 派生到当前版本了没有 */
	derived: boolean;
	skills: string[];
	did: { involvement: string | null; domain: string }[];
};

export type EmployeeProfile = EmployeeDetail["employee"];

type EmployeeData = {
	employee: EmployeeProfile;
	segments: SegmentView[];
};

export async function employeeData(
	empId: string,
): Promise<EmployeeData | null> {
	return withReadSnapshot(async (client) => {
		const version = identity(await currentTree(client));
		const found = await client.query<EmployeeProfile>(
			`select emp_id as "empId", name, cur_dept as "curDept", cur_title as "curTitle",
			cur_seq_l1 as "curSeqL1", cur_seq_l2 as "curSeqL2", cur_seq_l3 as "curSeqL3",
			cur_level as "curLevel", hire_date::text as "hireDate",
			education_level as "educationLevel", school, recruitment
		 from employee where emp_id = $1`,
			[empId],
		);
		const employee = found.rows[0];
		if (!employee) return null;

		const { rows } = await client.query<
			Omit<SegmentView, "skills" | "did"> & {
				skills: string[] | null;
				did: { involvement: string | null; domain: string }[] | null;
			}
		>(
			`select x.id, x.kind, x.start_date::text as "startDate", x.end_date::text as "endDate",
			x.months, x.org, x.org_path as "orgPath", x.title, x.level, x.description,
			x.seq_l1 as "seqL1", x.seq_l2 as "seqL2", x.seq_l3 as "seqL3",
			x.seq_inferred_l1 as "seqInferredL1", x.seq_inferred_l2 as "seqInferredL2",
			x.derived_identity is not distinct from $2 as derived,
			(select array_agg(p.text order by p.text)
			 from experience_phrase ep join phrase p on p.id = ep.phrase_id
			 where ep.experience_id = x.id and ep.route = 'skill') as skills,
			(select json_agg(json_build_object('involvement', ep.involvement, 'domain', p.text) order by p.text)
			 from experience_phrase ep join phrase p on p.id = ep.phrase_id
			 where ep.experience_id = x.id and ep.route = 'did') as did
		 from experience x
		 where x.emp_id = $1
		 order by x.start_date, x.id`,
			[empId, version],
		);
		return {
			employee,
			segments: rows.map((row) => ({
				...row,
				skills: row.skills ?? [],
				did: row.did ?? [],
			})),
		};
	});
}

/** 单人详情只读取展示所需的字段，存储身份与派生状态留在服务端。 */
export function employeeDetail(empId: string): Promise<EmployeeDetail | null> {
	return withCorpusSnapshot(async (store) => {
		const [emp] = await store
			.select({
				empId: employee.empId,
				name: employee.name,
				curDept: employee.curDept,
				curTitle: employee.curTitle,
				curSeqL1: employee.curSeqL1,
				curSeqL2: employee.curSeqL2,
				curSeqL3: employee.curSeqL3,
				curLevel: employee.curLevel,
				hireDate: employee.hireDate,
				educationLevel: employee.educationLevel,
				school: employee.school,
				recruitment: employee.recruitment,
			})
			.from(employee)
			.where(eq(employee.empId, empId));
		if (!emp) return null;
		const timeline = await store
			.select({
				id: experience.id,
				kind: experience.kind,
				startDate: experience.startDate,
				endDate: experience.endDate,
				org: experience.org,
				orgPath: experience.orgPath,
				orgMeta: experience.orgMeta,
				title: experience.title,
				level: experience.level,
				description: experience.description,
				seqL1: experience.seqL1,
				seqL2: experience.seqL2,
				seqL3: experience.seqL3,
				seqInferredL1: experience.seqInferredL1,
				seqInferredL2: experience.seqInferredL2,
				months: experience.months,
			})
			.from(experience)
			.where(eq(experience.empId, empId))
			.orderBy(asc(experience.startDate), asc(experience.id));
		return { employee: emp, timeline };
	});
}
