import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { tableQuery } from "#/lib/paging";
import { requireViewer, viewer } from "./access";
import {
	accountOrgs,
	changeOwnPassword,
	createUser,
	listAccounts,
	organizations,
	resetUserPassword,
	setUserDisabled,
	setUserRole,
	setUserScope,
} from "./accounts";

/** 当前登录的账号，连同它的数据范围里的组织；没登录为 null。 */
export const currentUser = createServerFn({ method: "GET" }).handler(
	async () => {
		const user = await viewer(getRequestHeaders());
		return user && { ...user, orgs: await accountOrgs(user.id) };
	},
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
	.validator(tableQuery)
	.handler(({ data }) => listAccounts(data.q, data.page));

const username = (d: { username: unknown }) => String(d.username ?? "");

/** 一个账号的数据范围最多几个组织。 */
const ORGS_MAX = 50;

/** 账号的数据范围在入参里是几条部门路径；路径本身在 `accounts.ts` 里规范化、校验。 */
function orgsIn(raw: unknown): string[] {
	if (
		!Array.isArray(raw) ||
		!raw.every((org): org is string => typeof org === "string")
	)
		throw new Error("数据范围应是几条部门路径");
	if (raw.length > ORGS_MAX) throw new Error(`数据范围最多 ${ORGS_MAX} 个组织`);
	return raw;
}

/** 建一个账号，返回初始密码；用户名已被占用时为 null。 */
export const createAccount = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator(
		(d: {
			username: unknown;
			name: unknown;
			admin: unknown;
			orgs: unknown;
		}) => ({
			username: username(d),
			name: String(d.name ?? ""),
			admin: d.admin === true,
			orgs: orgsIn(d.orgs),
		}),
	)
	.handler(({ data, context }) =>
		createUser(
			context.viewer.id,
			data.username,
			data.name,
			data.admin,
			data.orgs,
		),
	);

/** 换掉别人的账号的数据范围。 */
export const setAccountScope = createServerFn({ method: "POST" })
	.middleware([administrator])
	.validator((d: { username: unknown; orgs: unknown }) => ({
		username: username(d),
		orgs: orgsIn(d.orgs),
	}))
	.handler(({ data, context }) =>
		setUserScope(context.viewer.id, data.username, data.orgs),
	);

/** 此刻的组织树，账号页选数据范围用。 */
export const organizationTree = createServerFn({ method: "GET" })
	.middleware([administrator])
	.handler(() => organizations());

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
