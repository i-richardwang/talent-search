/**
 * 账号的全部管理动作，两个入口。
 *
 * - 本机命令行（`manageAccount`，`scripts/auth-user.ts`）什么账号都能管，包括建管理员、改角色。
 *   操作的是登录了服务器的人，不是一个账号，不进操作记录。
 * - 浏览器里的账号页（`createUser`、`resetUserPassword`、`setUserRole`、`setUserScope`、
 *   `setUserDisabled`）由管理员用，管除自己以外的全部账号：建账号时选角色和数据范围，重置密码、
 *   改数据范围、设为或取消管理员、停用、恢复。自己的账号在这里不能动，动手的管理员在改动的事务里
 *   锁住并核对仍是在用的管理员，所以库里至少剩一个管理员。新密码由这里生成、只交出一次；每一件
 *   都和改动同一个事务记进操作记录。
 *
 * 每个账号都有数据范围（`account_scope`）：建账号时必须给，最大是集团（最上一级的组织）。
 * 管理员的身份管能做什么，数据范围管看得到谁，两者互不替代。
 *
 * 账号不删除：搜索记录和操作记录引用它，离开的人停用即可。浏览器里另有改自己的密码
 * （`changeOwnPassword`），要当前密码。
 */
import "@tanstack/react-start/server-only";
import { randomInt, randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { and, eq, or } from "drizzle-orm";
import { db } from "#/db";
import { accountScope, authAccount, authSession, authUser } from "#/db/schema";
import { withReadSnapshot } from "#/db/snapshot";
import {
	isAdmin,
	NAME_MAX,
	PASSWORD_MAX,
	PASSWORD_MIN,
	usernameOf,
} from "#/lib/auth";
import { type OrgNode, orgsOf, orgTree } from "#/lib/org";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { escapeLike } from "#/lib/sql";
import { type AccountAction, recordAccount } from "./audit";
import { getAuth } from "./auth";

/** 命令行上来的一件事。字面都没校验过，在这里校验。 */
export type AccountChange =
	| {
			action: "create";
			username: string;
			password: string;
			orgs: string[];
			name?: string;
			role?: string;
	  }
	| { action: "set-scope"; username: string; orgs: string[] }
	| { action: "reset-password"; username: string; password: string }
	| { action: "set-role"; username: string; role: string }
	| { action: "disable" | "enable"; username: string };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function checkedUsername(raw: string): string {
	const username = usernameOf(raw);
	if (!username)
		throw new Error("用户名须为 3–30 个英文字母、数字、下划线或点");
	return username;
}

type Role = "user" | "admin";

function roleOf(raw: string): Role {
	if (raw !== "user" && raw !== "admin")
		throw new Error("角色只能是 user 或 admin");
	return raw;
}

const roleFor = (admin: boolean): Role => (admin ? "admin" : "user");

const validLength = (password: string) =>
	password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX;

/** 校验长度后取哈希。哈希慢，在拿锁之前算。 */
async function hashed(password: string) {
	if (!validLength(password))
		throw new Error(`密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符`);
	return hashPassword(password);
}

/** 不含 0/O、1/l/I 这类容易看错的字符：密码是照着念给人或抄下来的。 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 账号页交出的新密码：16 位，约 92 比特。 */
function generatedPassword() {
	return Array.from(
		{ length: 16 },
		() => ALPHABET[randomInt(ALPHABET.length)],
	).join("");
}

type NewAccount = {
	username: string;
	name: string;
	role: Role;
	/** 已经取过哈希 */
	password: string;
	/** 已经规范化（`checkedOrgs`） */
	orgs: string[];
};

/** 规范化一个账号的几个组织；一个都没有或有一个是空的时报错。 */
function checkedOrgs(raws: readonly string[]): string[] {
	const orgs = orgsOf(raws);
	if (!orgs) throw new Error("数据范围至少要有一个组织");
	return orgs;
}

/**
 * 账号页给的组织都得在此刻的组织树上：页面上的树可能已经过时。命令行不经过这里，第一次同步
 * 之前就要建第一个管理员。
 */
async function onTree(orgs: readonly string[]) {
	const tree = new Set((await organizations()).map((node) => node.path));
	const unknown = orgs.filter((org) => !tree.has(org));
	if (unknown.length > 0)
		throw new Error(`组织树上没有：${unknown.join("、")}`);
}

/** 换掉这个账号的数据范围。 */
async function setScope(tx: Tx, userId: string, orgs: readonly string[]) {
	await tx.delete(accountScope).where(eq(accountScope.userId, userId));
	await tx
		.insert(accountScope)
		.values(orgs.map((orgPath) => ({ userId, orgPath })));
}

/** 建一个账号、它的密码凭据和数据范围，返回账号 id；用户名已被占用时为 null。 */
async function insertAccount(tx: Tx, account: NewAccount) {
	const name = account.name.trim() || account.username;
	if (name.length > NAME_MAX)
		throw new Error(`显示名称不能超过 ${NAME_MAX} 个字符`);
	const id = randomUUID();
	const [created] = await tx
		.insert(authUser)
		.values({
			id,
			// Better Auth 的用户契约要求 email；放一个不可投递的内部地址，不向用户索取邮箱。
			email: `${id}@users.invalid`,
			name,
			role: account.role,
			username: account.username,
		})
		.onConflictDoNothing({ target: authUser.username })
		.returning({ id: authUser.id });
	if (!created) return null;
	await tx.insert(authAccount).values({
		id: randomUUID(),
		accountId: id,
		providerId: "credential",
		userId: id,
		password: account.password,
	});
	await setScope(tx, id, account.orgs);
	return id;
}

/** 锁住这个账号再改它：同一个账号上的两件事不交错。`change` 拿到的是账号 id。 */
function withAccount(
	username: string,
	change: (tx: Tx, userId: string) => Promise<void>,
) {
	return db.transaction(async (tx) => {
		const [account] = await tx
			.select({ id: authUser.id })
			.from(authUser)
			.where(eq(authUser.username, username))
			.for("update");
		if (!account) throw new Error("用户名不存在");
		await change(tx, account.id);
	});
}

const signOutEverywhere = (tx: Tx, userId: string) =>
	tx.delete(authSession).where(eq(authSession.userId, userId));

/** 换掉密码，撤销这个账号的全部登录。 */
async function setPassword(tx: Tx, userId: string, password: string) {
	const changed = await tx
		.update(authAccount)
		.set({ password })
		.where(
			and(
				eq(authAccount.userId, userId),
				eq(authAccount.providerId, "credential"),
			),
		)
		.returning({ id: authAccount.id });
	if (!changed.length) throw new Error("账号没有密码凭据，未作修改");
	await signOutEverywhere(tx, userId);
}

/** 改角色；角色每次请求都从库里读，下一次请求就按新的。 */
async function setRole(tx: Tx, userId: string, role: Role) {
	await tx.update(authUser).set({ role }).where(eq(authUser.id, userId));
}

/** 停用时同时撤销全部登录。 */
async function setDisabled(tx: Tx, userId: string, disabled: boolean) {
	await tx
		.update(authUser)
		.set({ banned: disabled, banExpires: null })
		.where(eq(authUser.id, userId));
	if (disabled) await signOutEverywhere(tx, userId);
}

/**
 * 命令行做一件账号管理的事，返回规范化后的用户名。角色和停用状态每次请求都从库里读
 * （`access.ts`），改完下一次请求就生效。
 */
export async function manageAccount(change: AccountChange): Promise<string> {
	const username = checkedUsername(change.username);
	switch (change.action) {
		case "create": {
			const account = {
				username,
				name: change.name ?? "",
				role: roleOf(change.role ?? "user"),
				password: await hashed(change.password),
				orgs: checkedOrgs(change.orgs),
			};
			const id = await db.transaction((tx) => insertAccount(tx, account));
			if (!id) throw new Error("用户名已存在");
			break;
		}
		case "reset-password": {
			const password = await hashed(change.password);
			await withAccount(username, (tx, userId) =>
				setPassword(tx, userId, password),
			);
			break;
		}
		case "set-role": {
			const role = roleOf(change.role);
			await withAccount(username, (tx, userId) => setRole(tx, userId, role));
			break;
		}
		case "set-scope": {
			const orgs = checkedOrgs(change.orgs);
			await withAccount(username, (tx, userId) => setScope(tx, userId, orgs));
			break;
		}
		case "disable":
		case "enable":
			await withAccount(username, (tx, userId) =>
				setDisabled(tx, userId, change.action === "disable"),
			);
			break;
	}
	return username;
}

const LOCKED = {
	id: authUser.id,
	username: authUser.username,
	role: authUser.role,
	banned: authUser.banned,
};

/**
 * 动手的管理员此刻还在用、还是管理员。中间件的检查在事务之外：两个管理员同时互相取消或停用，
 * 后一个锁在这里等前一个提交，再看到自己已经不是管理员；所以库里总剩一个管理员。
 */
function checkActor(
	actor: { role: string | null; banned: boolean | null } | undefined,
) {
	if (!actor || !isAdmin(actor.role) || actor.banned)
		throw new Error("只有在用的管理员能管理账号");
}

/**
 * 账号页对别人的一个账号做一件事，和改动同一个事务记下是哪个管理员做的。动手的管理员和这个
 * 账号按 id 的顺序一起锁住，两件事互相等也不会死锁。
 */
function changeUser(
	adminId: string,
	username: string,
	action: AccountAction,
	change: (tx: Tx, userId: string) => Promise<void>,
) {
	const target = checkedUsername(username);
	return db.transaction(async (tx) => {
		const locked = await tx
			.select(LOCKED)
			.from(authUser)
			.where(or(eq(authUser.id, adminId), eq(authUser.username, target)))
			.orderBy(authUser.id)
			.for("update");
		checkActor(locked.find((row) => row.id === adminId));
		const account = locked.find((row) => row.username === target);
		if (!account) throw new Error("用户名不存在");
		if (account.id === adminId) throw new Error("不能在账号页改自己的账号");
		await change(tx, account.id);
		await recordAccount(tx, adminId, action, account.id);
	});
}

/**
 * 账号页建一个账号，返回生成的初始密码；用户名已被占用时为 null。`name` 为空时显示名称用
 * 用户名。建成管理员时另记一行「设为管理员」。
 */
export async function createUser(
	adminId: string,
	username: string,
	name: string,
	admin: boolean,
	orgs: readonly string[],
): Promise<string | null> {
	const password = generatedPassword();
	const account = {
		username: checkedUsername(username),
		name,
		role: roleFor(admin),
		password: await hashPassword(password),
		orgs: checkedOrgs(orgs),
	};
	await onTree(account.orgs);
	return db.transaction(async (tx) => {
		const [actor] = await tx
			.select(LOCKED)
			.from(authUser)
			.where(eq(authUser.id, adminId))
			.for("update");
		checkActor(actor);
		const id = await insertAccount(tx, account);
		if (!id) return null;
		await recordAccount(tx, adminId, "create-account", id);
		if (admin) await recordAccount(tx, adminId, "grant-admin", id);
		return password;
	});
}

/** 账号页给别人的账号换一个生成的密码并撤销它的全部登录，返回新密码。 */
export async function resetUserPassword(
	adminId: string,
	username: string,
): Promise<string> {
	const password = generatedPassword();
	const hash = await hashPassword(password);
	await changeUser(adminId, username, "reset-password", (tx, userId) =>
		setPassword(tx, userId, hash),
	);
	return password;
}

/** 账号页把别人的账号设为管理员或普通用户。 */
export async function setUserRole(
	adminId: string,
	username: string,
	admin: boolean,
) {
	await changeUser(
		adminId,
		username,
		admin ? "grant-admin" : "revoke-admin",
		(tx, userId) => setRole(tx, userId, roleFor(admin)),
	);
}

/** 账号页换掉别人的账号的数据范围；下一次读取就按新的。 */
export async function setUserScope(
	adminId: string,
	username: string,
	orgs: readonly string[],
) {
	const checked = checkedOrgs(orgs);
	await onTree(checked);
	await changeUser(adminId, username, "set-scope", (tx, userId) =>
		setScope(tx, userId, checked),
	);
}

/** 账号页停用或恢复别人的账号。 */
export async function setUserDisabled(
	adminId: string,
	username: string,
	disabled: boolean,
) {
	await changeUser(
		adminId,
		username,
		disabled ? "disable-account" : "enable-account",
		(tx, userId) => setDisabled(tx, userId, disabled),
	);
}

export type AccountRow = {
	username: string;
	name: string;
	admin: boolean;
	disabled: boolean;
	/** 数据范围里的组织（部门路径）；没有数据范围的账号是空的，什么人都看不到 */
	orgs: string[];
	/** 此刻数据范围里有多少人 */
	people: number;
};

/** 账号页的表：用户名或显示名称含这个词的账号，按用户名排，一页 `PAGE_SIZE` 行。 */
export async function listAccounts(
	needle: string,
	page: unknown,
): Promise<TablePage<AccountRow>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	const from = "from auth_user where username ilike $1 or name ilike $1";
	return withReadSnapshot("all", async (client) => {
		const found = await client.query<{ n: string }>(
			`select count(*) as n ${from}`,
			[pattern],
		);
		const total = Number(found.rows[0]?.n ?? 0);
		const at = pageAt(total, page);
		const { rows } = await client.query<{
			username: string;
			name: string;
			role: string | null;
			banned: boolean | null;
			orgs: string[];
			people: number;
		}>(
			`select u.username, u.name, u.role, u.banned,
				array(select org_path from account_scope s
					where s.user_id = u.id order by org_path) as orgs,
				(select count(*)::int from scope_member m where m.user_id = u.id) as people
			from (select * ${from}
				order by username
				limit ${at.limit} offset ${at.offset}) u
			order by u.username`,
			[pattern],
		);
		return tablePage(
			rows.map((row) => ({
				username: row.username,
				name: row.name,
				admin: isAdmin(row.role),
				disabled: row.banned === true,
				orgs: row.orgs,
				people: row.people,
			})),
			total,
			at,
		);
	});
}

/** 这个账号的数据范围里的组织，按路径排。 */
export async function accountOrgs(userId: string): Promise<string[]> {
	const rows = await db
		.select({ org: accountScope.orgPath })
		.from(accountScope)
		.where(eq(accountScope.userId, userId))
		.orderBy(accountScope.orgPath);
	return rows.map((row) => row.org);
}

/** 此刻的组织树：账号页选数据范围时用，每个节点带它下面有多少人。 */
export async function organizations(): Promise<OrgNode[]> {
	return withReadSnapshot("all", async (client) => {
		const { rows } = await client.query<{ path: string; people: number }>(
			`select cur_dept_path as path, count(*)::int as people from employee
			where cur_dept_path <> '' group by cur_dept_path`,
		);
		return orgTree(rows);
	});
}

/** 改自己的密码没成的原因：当前密码不对，或新密码长度不合规。 */
export type PasswordRefusal = "wrong" | "length";

/**
 * 登录的人改自己的密码。要当前密码；改完这个账号别处的登录都失效，这一处换一个新的会话。
 * `headers` 是这次请求的头，里面的会话决定改的是谁。
 */
export async function changeOwnPassword(
	headers: Headers,
	current: string,
	next: string,
): Promise<PasswordRefusal | null> {
	if (!validLength(next)) return "length";
	// 比上限还长的不可能是当前密码，不拿去比对
	if (current.length > PASSWORD_MAX) return "wrong";
	try {
		await getAuth().api.changePassword({
			headers,
			body: {
				currentPassword: current,
				newPassword: next,
				revokeOtherSessions: true,
			},
		});
	} catch (error) {
		if (error instanceof APIError && error.body?.code === "INVALID_PASSWORD")
			return "wrong";
		throw error;
	}
	return null;
}
