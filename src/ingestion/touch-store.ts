import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import type { Touch } from "./touch";

export const TOUCH_ORDER =
	"coalesce(t.touched_at,(t.created_at at time zone 'UTC')::date) desc,t.created_at desc,t.id desc";

/** 调用者已在写事务中核验目标池。成员外键随移出操作一起清理记录。 */
export async function appendTouch(
	c: PoolClient,
	user: string,
	pool: string,
	person: string,
	touch: Touch,
) {
	if (!touch.touched && !touch.notes) throw new Error("请填写接触日期或备注");
	const result = await c.query(
		`insert into pool_touch(pool_id,person_id,author_id,touched_at,notes)
 select pool_id,person_id,$3,$4,$5 from pool_member where pool_id=$1 and person_id=$2`,
		[pool, person, user, touch.touched, touch.notes],
	);
	if (!result.rowCount) throw new Error("找不到这个池成员");
}
