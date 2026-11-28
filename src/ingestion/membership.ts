import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { authorizedPool } from "#/db/snapshot";
import type { Resume } from "./resume";

/** 调用方持有语料写锁。可见池允许添加新成员，已有成员只由录入者或管理员维护。 */
export async function memberForWrite(
	c: PoolClient,
	user: string,
	pool: string,
	person: string,
) {
	await authorizedPool(c, user, pool);
	const { rows } = await c.query<{
		contacts: Resume["contacts"];
		allowed: boolean;
	}>(
		`select m.contacts,(m.added_by=u.id or u.role='admin') and u.banned is not true as allowed
		 from pool_member m join auth_user u on u.id=$3 where m.pool_id=$1 and m.person_id=$2 for share of u`,
		[pool, person, user],
	);
	const member = rows[0];
	if (member && !member.allowed)
		throw new Error("只有录入者或管理员可以修改该成员");
	return member;
}
