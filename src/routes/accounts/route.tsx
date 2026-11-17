import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import {
	accountTable,
	createAccount,
	resetPassword,
	setAccountDisabled,
} from "#/server/auth-functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { type AccountActions, AccountTable } from "./-components/account-table";

/**
 * 账号页：全部账号，管理员在这里建普通账号、给普通账号重置密码、停用和恢复。只有管理员能进，
 * 服务端同样只对管理员开放，并且碰不到管理员账号（`server/accounts.ts`）。找词和翻页在
 * 服务端做，词和页码写进地址。
 */
export const Route = createFileRoute("/accounts")({
	beforeLoad: ({ context }) => {
		if (!context.user?.admin) throw redirect({ to: "/" });
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
	const router = useRouter();
	const actions: AccountActions = {
		create: async (username, name) => {
			const password = await createAccount({ data: { name, username } });
			if (password !== null) await router.invalidate();
			return password;
		},
		reset: (username) => resetPassword({ data: { username } }),
		setDisabled: async (username, disabled) => {
			await setAccountDisabled({ data: { disabled, username } });
			await router.invalidate();
		},
	};
	return (
		<AdminPage title="账号">
			<AccountTable actions={actions} list={list} pending={pending} q={q} />
		</AdminPage>
	);
}
