/**
 * 账号的全部管理动作，两个入口。
 *
 * - 本机命令行（`manageAccount`，`scripts/auth-user.ts`）什么账号都能管，包括建管理员、改角色。
 *   操作的是登录了服务器的人，不是一个账号，不进操作记录。
 * - 浏览器里的账号页（`createUser`、`resetUserPassword`、`setUserDisabled`）由管理员用，只管普通
 *   账号：建出来的都是普通账号，重置密码、停用、恢复碰不到管理员账号。管理员的浏览器登录被人
 *   拿到，也建不出新的管理员，接管或锁不住别的管理员。新密码由这里生成、只交出一次；每一件都和
 *   改动同一个事务记进操作记录。
 *
 * 账号不删除：搜索记录和操作记录引用它，离开的人停用即可。浏览器里另有改自己的密码
 * （`changeOwnPassword`），要当前密码。
 */
import "@tanstack/react-start/server-only";
import { randomInt, randomUUID } from "node:crypto";
import { APIError } from "better-auth/api";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { authAccount, authSession, authUser } from "#/db/schema";
import { withReadSnapshot } from "#/db/snapshot";
import {
	isAdmin,
	NAME_MAX,
	PASSWORD_MAX,
	PASSWORD_MIN,
	usernameOf,
} from "#/lib/auth";
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
			name?: string;
			role?: string;
	  }
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

function roleOf(raw: string): "user" | "admin" {
	if (raw !== "user" && raw !== "admin")
		throw new Error("角色只能是 user 或 admin");
	return raw;
}

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
	role: "user" | "admin";
	/** 已经取过哈希 */
	password: string;
};

/** 建一个账号和它的密码凭据，返回账号 id；用户名已被占用时为 null。 */
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
	return id;
}

type Locked = { id: string; role: string | null };

/** 锁住这个账号再改它：同一个账号上的两件事不交错。 */
function withAccount(
	username: string,
	change: (tx: Tx, account: Locked) => Promise<void>,
) {
	return db.transaction(async (tx) => {
		const [account] = await tx
			.select({ id: authUser.id, role: authUser.role })
			.from(authUser)
			.where(eq(authUser.username, username))
			.for("update");
		if (!account) throw new Error("用户名不存在");
		await change(tx, account);
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
			};
			const id = await db.transaction((tx) => insertAccount(tx, account));
			if (!id) throw new Error("用户名已存在");
			break;
		}
		case "reset-password": {
			const password = await hashed(change.password);
			await withAccount(username, (tx, account) =>
				setPassword(tx, account.id, password),
			);
			break;
		}
		case "set-role": {
			const role = roleOf(change.role);
			await withAccount(username, async (tx, account) => {
				await tx
					.update(authUser)
					.set({ role })
					.where(eq(authUser.id, account.id));
			});
			break;
		}
		case "disable":
		case "enable":
			await withAccount(username, (tx, account) =>
				setDisabled(tx, account.id, change.action === "disable"),
			);
			break;
	}
	return username;
}

/** 账号页对一个已有的普通账号做一件事，和改动同一个事务记下是哪个管理员做的。 */
function changeUser(
	adminId: string,
	username: string,
	action: AccountAction,
	change: (tx: Tx, userId: string) => Promise<void>,
) {
	return withAccount(checkedUsername(username), async (tx, account) => {
		if (isAdmin(account.role))
			throw new Error("管理员账号只能在服务器上用命令行管理");
		await change(tx, account.id);
		await recordAccount(tx, adminId, action, account.id);
	});
}

/**
 * 账号页建一个普通账号，返回生成的初始密码；用户名已被占用时为 null。
 * `name` 为空时显示名称用用户名。
 */
export async function createUser(
	adminId: string,
	username: string,
	name: string,
): Promise<string | null> {
	const password = generatedPassword();
	const account = {
		username: checkedUsername(username),
		name,
		role: "user" as const,
		password: await hashPassword(password),
	};
	return db.transaction(async (tx) => {
		const id = await insertAccount(tx, account);
		if (!id) return null;
		await recordAccount(tx, adminId, "create-account", id);
		return password;
	});
}

/** 账号页给一个普通账号换一个生成的密码并撤销它的全部登录，返回新密码。 */
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

/** 账号页停用或恢复一个普通账号。 */
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
};

/** 账号页的表：用户名或显示名称含这个词的账号，按用户名排，一页 `PAGE_SIZE` 行。 */
export async function listAccounts(
	needle: string,
	page: unknown,
): Promise<TablePage<AccountRow>> {
	const pattern = `%${escapeLike(needle.trim())}%`;
	const from = "from auth_user where username ilike $1 or name ilike $1";
	return withReadSnapshot(async (client) => {
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
		}>(
			`select username, name, role, banned ${from}
			order by username
			limit ${at.limit} offset ${at.offset}`,
			[pattern],
		);
		return tablePage(
			rows.map((row) => ({
				username: row.username,
				name: row.name,
				admin: isAdmin(row.role),
				disabled: row.banned === true,
			})),
			total,
			at,
		);
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
