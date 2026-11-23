/**
 * 搜索和账号变更在业务事务中留存记录。查看详情、导出名单和外部服务读取经历时，
 * 先记录本次涉及的人员，写入成功后才能返回数据。
 */
import "@tanstack/react-start/server-only";
import { db } from "#/db";
import { auditEvent } from "#/db/schema";
import { withReadSnapshot } from "#/db/snapshot";
import type { AuditAction } from "#/lib/audit";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";

type Store = Pick<typeof db, "insert">;

/** 账号页上对一个账号做的事。 */
export type AccountAction = Exclude<
	AuditAction,
	"search" | "view" | "export" | "derive-read"
>;

/** 这个账号搜了什么。`store` 是写下那一轮的事务。 */
export async function recordSearch(store: Store, userId: string, text: string) {
	await store.insert(auditEvent).values({ userId, action: "search", text });
}

/** 这个账号打开了这个人的详情。 */
export async function recordView(userId: string, empId: string) {
	await db.insert(auditEvent).values({ userId, action: "view", empId });
}

/** 这个账号导出了这些人，一个人一行。 */
export async function recordExport(userId: string, empIds: string[]) {
	await db
		.insert(auditEvent)
		.values(
			empIds.map((empId) => ({ userId, action: "export" as const, empId })),
		);
}

/** 发给外部解析服务之前记录本批提供了哪些人的经历。 */
export async function recordDeriveRead(empIds: string[]) {
	if (empIds.length)
		await db
			.insert(auditEvent)
			.values(
				empIds.map((empId) => ({ action: "derive-read" as const, empId })),
			);
}

/** 这个管理员对这个账号做了这件事。`store` 是改这个账号的事务。 */
export async function recordAccount(
	store: Store,
	userId: string,
	action: AccountAction,
	accountId: string,
) {
	await store.insert(auditEvent).values({ userId, action, accountId });
}

export type AuditRow = {
	id: number;
	/** `YYYY-MM-DD HH:MM:SS` */
	at: string;
	username: string;
	/** 账号的显示名称 */
	name: string;
	action: AuditAction;
	/** 查看、导出或交给外部解析服务的员工 */
	empId: string | null;
	/** 那个人现在的名字；已经不在人才库里为 null */
	empName: string | null;
	/** 搜索的内容；其余为 null */
	text: string | null;
	/** 管理的那个账号的用户名和显示名称；其余为 null */
	accountUsername: string | null;
	accountName: string | null;
};

/**
 * 审计页的表，新的在前，一页 `PAGE_SIZE` 行。词对的是做事的账号和被管理的账号（用户名、
 * 显示名称）、被查看或导出的人（工号、姓名）和搜索的内容，任一处含它就算。
 */
export async function listAudit(
	needle: string,
	page: unknown,
): Promise<TablePage<AuditRow>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	const from = `from audit_event a
		left join auth_user u on u.id = a.user_id
		left join employee e on e.emp_id = a.emp_id
		left join auth_user t on t.id = a.account_id
		where u.username ilike $1 or coalesce(u.name, '外部解析服务') ilike $1 or a.emp_id ilike $1
			or e.name ilike $1 or a.text ilike $1
			or t.username ilike $1 or t.name ilike $1`;
	// 管理员查整个系统的操作，被查看、导出的人不按谁的数据范围过滤
	return withReadSnapshot("all", async (client) => {
		const found = await client.query<{ n: string }>(
			`select count(*) as n ${from}`,
			[pattern],
		);
		const total = Number(found.rows[0]?.n ?? 0);
		const at = pageAt(total, page);
		const { rows } = await client.query<AuditRow>(
			`select a.id, to_char(a.at, 'YYYY-MM-DD HH24:MI:SS') as at,
				coalesce(u.username, '') as username, coalesce(u.name, '外部解析服务') as name, a.action, a.emp_id as "empId",
				e.name as "empName", a.text,
				t.username as "accountUsername", t.name as "accountName"
			${from}
			order by a.id desc
			limit ${at.limit} offset ${at.offset}`,
			[pattern],
		);
		return tablePage(rows, total, at);
	});
}
