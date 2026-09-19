/**
 * 数据页看的东西：库里此刻有谁、每个人的每一段、以及派生给这一段算出了什么。
 *
 * 检索给招聘的人看命中；这两页给管数据的人看**库里到底是什么**——同步进来的
 * 原始一半和派生写上的那一半并排放着，一段有没有派生到当前版本、抽出了哪些能力词
 * 和做过的事、对到了哪个序列，都在这里核对。只读。
 */

import "@tanstack/react-start/server-only";
import { currentTree, identity } from "#/corpus/derive";
import type { Employee, Experience } from "#/db/schema";
import { withReadSnapshot } from "#/db/snapshot";
import { escapeLike } from "#/lib/sql";

/** 列表一页几个人。 */
const PAGE_SIZE = 50;

type EmployeeRow = Pick<Employee, "empId" | "name" | "curDept" | "curTitle"> & {
	/** 这个人有几段 */
	segments: number;
	/** 其中几段还没派生到当前版本 */
	pending: number;
};

type DataList = {
	/** 这个词一共找到多少人；不给词就是库里的所有人 */
	total: number;
	/** 一共分几页，至少一页 */
	pages: number;
	/** 这一页的第一个人在全部结果里排第几，从 1 起；一个人都没有时是 0 */
	from: number;
	/**
	 * 给出的是第几页，从 1 起。
	 *
	 * 页码由这里定夺，不是照抄地址栏里的那个数：搜过一次再改词，剩下的人可能填
	 * 不满原来那么多页，而一个越界的页码在表上就是一张空表。越界收回最后一页。
	 */
	page: number;
	rows: EmployeeRow[];
};

/** 按名字或工号找人，一页 `PAGE_SIZE` 个；不给词就按工号从头列。 */
export async function listEmployees(
	needle: string,
	page: number,
): Promise<DataList> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	return withReadSnapshot(async (client) => {
		const version = identity(await currentTree(client));
		const found = await client.query<{ n: string }>(
			"select count(*) as n from employee where name ilike $1 or emp_id ilike $1",
			[pattern],
		);
		const total = Number(found.rows[0]?.n ?? 0);
		const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
		const at = Math.min(Math.max(1, Math.trunc(page)), pages);
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
		 limit ${PAGE_SIZE} offset ${(at - 1) * PAGE_SIZE}`,
			[version, pattern],
		);
		return {
			total,
			pages,
			from: rows.length === 0 ? 0 : (at - 1) * PAGE_SIZE + 1,
			page: at,
			rows,
		};
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
	/** 派生的时刻，`MM-DD HH:MM`；没派生过是 null */
	derivedAt: string | null;
	skills: string[];
	did: { involvement: string | null; domain: string }[];
};

type EmployeeData = {
	employee: Employee;
	segments: SegmentView[];
};

export async function employeeData(
	empId: string,
): Promise<EmployeeData | null> {
	return withReadSnapshot(async (client) => {
		const version = identity(await currentTree(client));
		const found = await client.query<Employee>(
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
			to_char(x.derived_at, 'MM-DD HH24:MI') as "derivedAt",
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
