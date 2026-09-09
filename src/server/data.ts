/**
 * 数据页看的东西：库里此刻有谁、每个人的每一段、以及派生给这一段算出了什么。
 *
 * 检索给招聘的人看命中；这两页给管数据的人看**库里到底是什么**——同步进来的
 * 原始一半和派生写上的那一半并排放着，一段有没有派生到当前版本、抽出了哪些能力词
 * 和做过的事、对到了哪个序列，都在这里核对。只读。
 */

import "@tanstack/react-start/server-only";
import { currentTree, identity } from "#/corpus/derive";
import { pool } from "#/db";
import type { Employee, Experience } from "#/db/schema";

/** 列表最多几个人。再多也没人往下翻，按名字或工号找。 */
const LIST_LIMIT = 200;

export type EmployeeRow = Pick<
	Employee,
	"empId" | "name" | "curDept" | "curTitle"
> & {
	/** 这个人有几段 */
	segments: number;
	/** 其中几段还没派生到当前版本 */
	pending: number;
};

export type DataList = {
	/** 库里一共多少人 */
	total: number;
	rows: EmployeeRow[];
	/**
	 * 这一份是不是被 `LIST_LIMIT` 截断了。
	 *
	 * 它得由这里说：截断在这条 SQL 上发生，而页面不认识那个上限。不说的话，
	 * 一张列着 200 行的表底下写着「库里 5000 人」——读起来像库里只有这些，
	 * 而两个数字都是对的，谁都不会报这个 bug。
	 */
	capped: boolean;
};

/** 按名字或工号找人；不给词就按工号列前几百个。 */
export async function listEmployees(needle: string): Promise<DataList> {
	const version = identity(await currentTree(pool));
	const pattern = `%${needle.trim()}%`;
	const [total, rows] = await Promise.all([
		pool.query<{ n: string }>("select count(*) as n from employee"),
		pool.query<EmployeeRow>(
			`select e.emp_id as "empId", e.name, e.cur_dept as "curDept",
				e.cur_title as "curTitle",
				count(x.id)::int as segments,
				count(x.id) filter (where x.derived_identity is distinct from $1)::int as pending
			 from employee e
			 left join experience x on x.emp_id = e.emp_id
			 where e.name ilike $2 or e.emp_id ilike $2
			 group by e.emp_id
			 order by e.emp_id
			 limit ${LIST_LIMIT}`,
			[version, pattern],
		),
	]);
	return {
		total: Number(total.rows[0]?.n ?? 0),
		rows: rows.rows,
		capped: rows.rows.length === LIST_LIMIT,
	};
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

export type EmployeeData = {
	employee: Employee;
	segments: SegmentView[];
};

export async function employeeData(
	empId: string,
): Promise<EmployeeData | null> {
	const version = identity(await currentTree(pool));
	const found = await pool.query<Employee>(
		`select emp_id as "empId", name, cur_dept as "curDept", cur_title as "curTitle",
			cur_seq_l1 as "curSeqL1", cur_seq_l2 as "curSeqL2", cur_seq_l3 as "curSeqL3",
			cur_level as "curLevel", hire_date::text as "hireDate",
			education_level as "educationLevel", school, recruitment
		 from employee where emp_id = $1`,
		[empId],
	);
	const employee = found.rows[0];
	if (!employee) return null;

	const { rows } = await pool.query<
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
}
