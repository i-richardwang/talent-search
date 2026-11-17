import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { auditList } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { AuditTable } from "./-components/audit-table";

/**
 * 审计页：哪个账号在什么时候搜了什么、看了谁、导出了谁、管理了哪个账号，新的在前。只有管理员能进，
 * 服务端同样只对管理员开放（`auditList`）。找词和翻页在服务端做，词和页码写进地址。
 */
export const Route = createFileRoute("/audit")({
	beforeLoad: ({ context }) => {
		if (!context.user?.admin) throw redirect({ to: "/" });
	},
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageParam(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => auditList({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "审计 · 人才搜索" }] }),
	component: Audit,
});

function Audit() {
	const list = Route.useLoaderData();
	const { q } = Route.useSearch();
	const pending = useListPending("/audit");
	return (
		<AdminPage title="审计">
			<AuditTable list={list} pending={pending} q={q} />
		</AdminPage>
	);
}
