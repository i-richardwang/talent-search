import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { authAccount, authSession, authUser } from "#/db/schema";
import { PASSWORD_MAX, PASSWORD_MIN } from "#/lib/auth";
import { getAuth } from "./auth";

/** 仅供本机运维命令使用，不接到 RPC 或 HTTP。 */
export async function manageAccount(input: {
	action: "create" | "reset-password";
	username: string;
	password: string;
	name?: string;
	role?: string;
}) {
	const username = input.username.trim().toLowerCase();
	if (!/^[a-z0-9_.]{3,30}$/.test(username))
		throw new Error("用户名须为 3–30 个英文字母、数字、下划线或点");
	if (
		input.password.length < PASSWORD_MIN ||
		input.password.length > PASSWORD_MAX
	)
		throw new Error(`密码须为 ${PASSWORD_MIN}–${PASSWORD_MAX} 个字符`);
	if (input.action === "create") {
		const role = input.role ?? "user";
		if (role !== "user" && role !== "admin")
			throw new Error("角色只能是 user 或 admin");
		const name = input.name?.trim() || username;
		if (name.length > 80) throw new Error("显示名称不能超过 80 个字符");
		// Better Auth 的用户契约仍要求 email；保留随机的不可投递内部地址，不向用户索取邮箱。
		const { user } = await getAuth().api.createUser({
			body: {
				email: `${randomUUID()}@users.invalid`,
				name,
				password: input.password,
				role,
				data: { username },
			},
		});
		return { username, id: user.id };
	}
	const password = await hashPassword(input.password);
	return db.transaction(async (tx) => {
		const [user] = await tx
			.select({ id: authUser.id })
			.from(authUser)
			.where(eq(authUser.username, username))
			.for("update");
		if (!user) throw new Error("用户名不存在");
		const changed = await tx
			.update(authAccount)
			.set({ password })
			.where(
				and(
					eq(authAccount.userId, user.id),
					eq(authAccount.providerId, "credential"),
				),
			)
			.returning({ id: authAccount.id });
		if (!changed.length) throw new Error("账号没有密码凭据，未作修改");
		await tx.delete(authSession).where(eq(authSession.userId, user.id));
		return { username, id: user.id };
	});
}
