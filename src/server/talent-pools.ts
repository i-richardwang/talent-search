import "@tanstack/react-start/server-only";
import { prunePhrases } from "#/corpus/phrases";
import { corpusTransaction } from "#/corpus/session";
import { pool } from "#/db";
import { authorizedPool, withReadSnapshot } from "#/db/snapshot";
import type { Touch } from "#/ingestion/touch";
import { appendTouch, TOUCH_ORDER } from "#/ingestion/touch-store";
import { orgPathOf } from "#/lib/org";
import { pageAt, tablePage } from "#/lib/paging";

const DEFAULT_POOL = "external";
export async function ensureDefaultPool() {
	await pool.query(
		"insert into talent_pool(id,name) values($1,'外部人才池') on conflict(id) do nothing",
		[DEFAULT_POOL],
	);
}

export function addTouch(
	user: string,
	poolId: string,
	person: string,
	touch: Touch,
) {
	return corpusTransaction(async (c) => {
		await authorizedPool(c, user, poolId);
		await appendTouch(c, user, poolId, person, touch);
	});
}
export function changeTouch(
	user: string,
	poolId: string,
	id: number,
	touch: Touch | null,
) {
	return corpusTransaction(async (c) => {
		await authorizedPool(c, user, poolId);
		const where =
			"where pool_id=$1 and id=$2 and (author_id=$3 or exists(select from auth_user where id=$3 and role='admin' and banned is not true))";
		const keys = [poolId, id, user];
		if (touch && !touch.touched && !touch.notes)
			throw new Error("请填写接触日期或备注");
		const result = touch
			? await c.query(`update pool_touch set touched_at=$4,notes=$5 ${where}`, [
					...keys,
					touch.touched,
					touch.notes,
				])
			: await c.query(`delete from pool_touch ${where}`, keys);
		if (!result.rowCount) throw new Error("找不到可修改的接触记录");
	});
}
export async function removeMember(
	user: string,
	poolId: string,
	personId: string,
) {
	await corpusTransaction(async (c) => {
		await authorizedPool(c, user, poolId);
		const allowed = await c.query(
			`select 1 from pool_member m join auth_user u on u.id=$3 and u.banned is not true
 where m.pool_id=$1 and m.person_id=$2 and (m.added_by=u.id or u.role='admin') for share of u`,
			[poolId, personId, user],
		);
		if (!allowed.rowCount)
			throw new Error("只有成员录入者或管理员可以移出该成员");
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

export type PoolSummary = {
	id: string;
	name: string;
	org_path: string | null;
	created: string;
	creator: string;
};

export async function poolBoard(
	user: string,
	query: { pool?: string; tab: "members" | "imports"; page: number },
) {
	await ensureDefaultPool();
	return withReadSnapshot({ account: user }, async (c) => {
		const pools = (
			await c.query<PoolSummary>(
				"select p.id,p.name,p.org_path,to_char(p.created_at,'YYYY-MM-DD') as created,coalesce(u.name,'系统') as creator from talent_pool p left join auth_user u on u.id=p.created_by order by p.name",
			)
		).rows;
		const selected =
			pools.find((p) => p.id === query.pool) ??
			pools.find((p) => p.id === DEFAULT_POOL) ??
			pools[0];
		const poolId = selected?.id ?? null;
		if (query.tab === "members") {
			const total =
				(
					await c.query<{ n: number }>(
						"select count(*)::int as n from pool_member where pool_id=$1",
						[poolId],
					)
				).rows[0]?.n ?? 0;
			const at = pageAt(total, query.page);
			const { rows } = await c.query<{
				personId: string;
				name: string;
				company: string;
				title: string;
				touched: string | null;
				notes: string;
			}>(
				`select m.person_id as "personId",p.name,p.recent_company as company,p.recent_title as title,last.touched_at::text as touched,coalesce(last.notes,'') as notes
 from pool_member m join person_card p using(person_id)
 left join lateral (
   select max(t.touched_at) as touched_at,
     (array_agg(t.notes order by ${TOUCH_ORDER}) filter (where t.notes<>''))[1] as notes
   from pool_touch t where t.pool_id=m.pool_id and t.person_id=m.person_id
 ) last on true
 where m.pool_id=$1 order by p.name,m.person_id limit $2 offset $3`,
				[poolId, at.limit, at.offset],
			);
			return {
				pools,
				selected: poolId,
				list: { tab: "members" as const, table: tablePage(rows, total, at) },
			};
		}
		const total = Number(
			(
				await c.query("select count(*) from resume_import where pool_id=$1", [
					poolId,
				])
			).rows[0].count,
		);

		const at = pageAt(total, query.page);
		const tasks = (
			await c.query<{
				id: string;
				filename: string;
				status: string;
				message: string;
				person_id: string | null;
			}>(
				"select id,filename,status,message,person_id from resume_import where pool_id=$1 order by created_at desc,id limit $2 offset $3",
				[poolId, at.limit, at.offset],
			)
		).rows;
		return {
			pools,
			selected: poolId,
			list: { tab: "imports" as const, table: tablePage(tasks, total, at) },
		};
	});
}
