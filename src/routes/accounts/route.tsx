import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import {
	accountTable,
	createAccount,
	organizationTree,
	resetPassword,
	setAccountDisabled,
	setAccountRole,
	setAccountScope,
} from "#/server/auth-functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { type AccountActions, AccountTable } from "./-components/account-table";

/**
 * 账号页：全部账号，管理员在这里建账号（连同数据范围）、重置密码、改数据范围、设为或取消
 * 管理员、停用和恢复，自己的账号除外。只有管理员能进，服务端同样只对管理员开放
 * （`server/accounts.ts`）。找词和翻页在服务端做，词和页码写进地址。
 */
export const Route = createFileRoute("/accounts")({
	beforeLoad: ({ context }) => {
		if (!context.user?.admin) throw redirect({ to: "/" });
		return { self: context.user.username };
	},
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageParam(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => accountTable({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "账号 · 人才搜索" }] }),
	component: Accounts,
});

function Accounts() {
	const list = Route.useLoaderData();
	const { q } = Route.useSearch();
	const pending = useListPending("/accounts");
	const { self } = Route.useRouteContext();
	const router = useRouter();
	const actions: AccountActions = {
		create: async (username, name, admin, orgs) => {
			const password = await createAccount({
				data: { admin, name, orgs, username },
			});
			if (password !== null) await router.invalidate();
			return password;
		},
		reset: (username) => resetPassword({ data: { username } }),
		setScope: async (username, orgs) => {
			await setAccountScope({ data: { orgs, username } });
			await router.invalidate();
		},
		orgs: () => organizationTree(),
		setAdmin: async (username, admin) => {
			await setAccountRole({ data: { admin, username } });
			await router.invalidate();
		},
		setDisabled: async (username, disabled) => {
			await setAccountDisabled({ data: { disabled, username } });
			await router.invalidate();
		},
	};
	return (
		<AdminPage title="账号">
			<AccountTable
				actions={actions}
				list={list}
				pending={pending}
				q={q}
				self={self}
			/>
		</AdminPage>
	);
}
