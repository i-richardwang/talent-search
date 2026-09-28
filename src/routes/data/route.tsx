import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { dataList } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { EmployeeTable } from "./-components/employee-table";

/**
 * 数据页：库里此刻有谁。点一个人看他的每一段和派生结果（`/data/$empId`）。
 * 按名字或工号找人，找词和翻页在服务端做，词和页码写进地址。
 */
export const Route = createFileRoute("/data")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageParam(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => dataList({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "数据 · 人才搜索" }] }),
	component: Data,
});

function Data() {
	const list = Route.useLoaderData();
	const { q } = Route.useSearch();
	// 开着的是哪一个人。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { empId } = useParams({ strict: false });
	const pending = useListPending("/data");

	return (
		<AdminPage title="数据">
			<EmployeeTable list={list} q={q} selected={empId} pending={pending} />
			{/* 点开的那个人从右侧覆盖（`data/$empId.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
