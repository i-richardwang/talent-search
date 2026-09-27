import { createFileRoute, Outlet, useParams } from "@tanstack/react-router";
import { pageParam } from "#/lib/paging";
import { dataList } from "#/server/functions";
import { AdminPage, useListPending } from "../-components/admin-page";
import { EmployeeTable } from "./-components/employee-table";

/**
 * 数据页：库里此刻有谁。点一个人看他的每一段和派生结果（`/data/$empId`）。
 *
 * 检索给招聘的人看命中，这一页给管数据的人看库里到底是什么。找人按名字或工号，
 * 翻页和过滤都在服务端做——几万人一次取齐不值得，而这一页是要能一直往后翻到底的：
 * 没有词的时候它就是库的全部内容。页码在地址里，所以某一页可以直接发给别人。
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
