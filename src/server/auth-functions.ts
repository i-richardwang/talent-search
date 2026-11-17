import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { requireViewer, viewer } from "./access";
import {
	changeOwnPassword,
	createUser,
	listAccounts,
	resetUserPassword,
	setUserDisabled,
	setUserRole,
} from "./accounts";

export const currentUser = createServerFn({ method: "GET" }).handler(() =>
	viewer(getRequestHeaders()),
);

/** 登录后才能调；当前账号放进 `context.viewer`，按人取数据、记操作的 handler 从这里拿。 */
export const authenticated = createMiddleware({ type: "function" }).server(
	async ({ next }) =>
		next({ context: { viewer: await requireViewer(getRequestHeaders()) } }),
);

/** 管理员才能调；当前账号同样放进 `context.viewer`。 */
export const administrator = createMiddleware({ type: "function" }).server(
	async ({ next }) =>
		next({
			context: { viewer: await requireViewer(getRequestHeaders(), true) },
		}),
);

/** 改自己的密码：要当前密码，改完这个账号别处的登录都失效。返回没改成的原因。 */
export const changePassword = createServerFn({ method: "POST" })
	.middleware([authenticated])
	.validator((d: { current: unknown; next: unknown }) => {
		if (typeof d.current !== "string" || typeof d.next !== "string")
			throw new Error("密码格式无效");
		return { current: d.current, next: d.next };
	})
	.handler(({ data }) =>
		changeOwnPassword(getRequestHeaders(), data.current, data.next),
	);

/** 账号页的表：按用户名或显示名称找，一页一页地给。 */
export const accountTable = createServerFn({ method: "GET" })
	.middleware([administrator])
	.validator((d: { q: unknown; page: unknown }) => ({
		q: String(d.q ?? "").slice(0, 64),
		page: Number(d.page) || 1,
	}))
	.handler(({ data }) => listAccounts(data.q, data.page));

const username = (d: { username: unknown }) => String(d.username ?? "");

/** 建一个账号，返回初始密码；用户名已被占用时为 null。 */
export const createAccount = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((d: { username: unknown; name: unknown; admin: unknown }) => ({
		username: username(d),
		name: String(d.name ?? ""),
		admin: d.admin === true,
	}))
	.handler(({ data, context }) =>
		createUser(context.viewer.id, data.username, data.name, data.admin),
	);

/** 给别人的账号换一个新密码并撤销它的全部登录，返回新密码。 */
export const resetPassword = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((d: { username: unknown }) => ({ username: username(d) }))
	.handler(({ data, context }) =>
		resetUserPassword(context.viewer.id, data.username),
	);

/** 把别人的账号设为管理员或普通用户。 */
export const setAccountRole = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((d: { username: unknown; admin: unknown }) => ({
		username: username(d),
		admin: d.admin === true,
	}))
	.handler(({ data, context }) =>
		setUserRole(context.viewer.id, data.username, data.admin),
	);

/** 停用或恢复别人的账号；停用同时撤销它的全部登录。 */
export const setAccountDisabled = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((d: { username: unknown; disabled: unknown }) => ({
		username: username(d),
		disabled: d.disabled === true,
	}))
	.handler(({ data, context }) =>
		setUserDisabled(context.viewer.id, data.username, data.disabled),
	);
