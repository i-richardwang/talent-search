import "@tanstack/react-start/server-only";
import { prunePhrases } from "#/corpus/phrases";
import { corpusTransaction } from "#/corpus/session";
import { pool } from "#/db";
import { authorizedPool, withReadSnapshot } from "#/db/snapshot";
import { memberForWrite } from "#/ingestion/membership";
import { orgPathOf } from "#/lib/org";
import { pageAt, tablePage } from "#/lib/paging";
import { collectFiles } from "./resume-files";

const DEFAULT_POOL = "external";
export async function ensureDefaultPool() {
	await pool.query(
		"insert into talent_pool(id,name) values($1,'外部人才池') on conflict(id) do nothing",
		[DEFAULT_POOL],
	);
}

export function updateContactNote(
	user: string,
	poolId: string,
	personId: string,
	touched: string | null,
	notes: string,
) {
	return corpusTransaction(async (c) => {
		if (!(await memberForWrite(c, user, poolId, personId)))
			throw new Error("找不到该成员");
		await c.query(
			"update pool_member set touched_at=$3,notes=$4 where pool_id=$1 and person_id=$2",
			[poolId, personId, touched, notes],
		);
	});
}
export async function removeMember(
	user: string,
	poolId: string,
	personId: string,
) {
	await corpusTransaction(async (c) => {
		if (!(await memberForWrite(c, user, poolId, personId)))
			throw new Error("找不到该成员");
		await c.query(
			"delete from profile_source where person_id=$1 and pool_id=$2",
			[personId, poolId],
		);
		await c.query("delete from pool_member where person_id=$1 and pool_id=$2", [
			personId,
			poolId,
		]);
		await c.query(
			"delete from person_identity where person_id=$1 and origin=$2",
			[personId, poolId],
		);
		await c.query(
			"delete from experience e where person_id=$1 and not exists(select from profile_experience pe where pe.experience_id=e.id)",
			[personId],
		);
		await c.query(
			"delete from person where person_id=$1 and not exists(select from profile_source where person_id=$1) and not exists(select from pool_member where person_id=$1)",
			[personId],
		);
		await prunePhrases(c);
		await c.query(
			"insert into audit_event(user_id,action,person_id) values($1,'talent-remove',$2)",
			[user, personId],
		);
	});
	await collectFiles();
}

export async function setTalentPool(
	user: string,
	input: { id?: string; name: string; org: string | null },
) {
	const org = input.org === null ? null : orgPathOf(input.org);
	if (!input.name.trim() || org === "")
		throw new Error("请输入池名和有效的部门路径");
	await corpusTransaction(async (c) => {
		const admin = await c.query(
			"select id from auth_user where id=$1 and role='admin' and banned is not true for share",
			[user],
		);
		if (!admin.rowCount) throw new Error("仅管理员可以调整人才池");
		if (input.id) await authorizedPool(c, user, input.id);
		if (org) {
			const exists = await c.query(
				`select 1 from employment e, account_scope s where s.user_id=$2 and
				starts_with(e.cur_dept_path||'>',$1||'>') and starts_with($1||'>',s.org_path||'>') limit 1`,
				[org, user],
			);
			if (!exists.rowCount) throw new Error("请选择权限范围内的组织");
		}
		if (input.id)
			await c.query(
				"update talent_pool set name=$2,visibility=$3,org_path=$4 where id=$1",
				[input.id, input.name.trim(), org ? "org" : "public", org],
			);
		else
			await c.query(
				"insert into talent_pool(name,visibility,org_path,created_by) values($1,$2,$3,$4)",
				[input.name.trim(), org ? "org" : "public", org, user],
			);
	});
}

export async function importBoard(user: string, page: number) {
	await ensureDefaultPool();
	return withReadSnapshot({ account: user }, async (c) => {
		const pools = (
			await c.query<{
				id: string;
				name: string;
				org_path: string | null;
				created: string;
				creator: string;
			}>(
				"select p.id,p.name,p.org_path,to_char(p.created_at,'YYYY-MM-DD') as created,coalesce(u.name,'系统') as creator from talent_pool p left join auth_user u on u.id=p.created_by order by p.name",
			)
		).rows;
		const total = Number(
			(await c.query("select count(*) from resume_import")).rows[0].count,
		);

		const at = pageAt(total, page);
		const tasks = (
			await c.query<{
				id: string;
				filename: string;
				status: string;
				message: string;
				person_id: string | null;
				pool_id: string;
			}>(
				"select id,filename,status,message,person_id,pool_id from resume_import order by created_at desc,id limit $1 offset $2",
				[at.limit, at.offset],
			)
		).rows;
		return { pools, tasks: tablePage(tasks, total, at) };
	});
}
