import {
	createFileRoute,
	notFound,
	useLoaderData,
} from "@tanstack/react-router";
import { claimName } from "#/search/condition-label";
import { fetchEmployee } from "#/server/functions";
import { Person, PersonNotFound, PersonPending } from "./-components/person";

export const Route = createFileRoute("/s/$turnId/p/$empId")({
	loader: async ({ params }) => {
		const data = await fetchEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Detail,
	/*
	 * 找不到工号时**只换这一栏**：外壳、检索结果、筛选、查询框全都留着。
	 *
	 * 这条要挂在本路由上，不能挂到 `/s/$turnId`。`notFound()` 由抛它的那个
	 * loader 所属的路由自己接住；挂到外壳那一层会让整个页面被这一句话替换掉，
	 * 连同旁边那份还成立的名单。
	 */
	notFoundComponent: PersonNotFound,
	/*
	 * 这块面板开着的时候一直在，而它的 loader 要打一次库。没有 pending 表示的话，
	 * ↑↓ 连着扫人时屏幕上挂的是**上一个人**，直到新数据回来才整块换掉——
	 * 库一慢就是「按了没反应，然后突然换人」。
	 *
	 * 200ms 才开始画骨架：快过这个数的话闪一下骨架比直接换人更晃眼。
	 * 画出来就至少留 300ms，免得它在肉眼刚注意到的一瞬间消失。
	 */
	pendingMs: 200,
	pendingMinMs: 300,
	pendingComponent: PersonPending,
});

/** 这个人的档案接上父路由那次检索里他的命中。 */
function Detail() {
	const { employee, timeline } = Route.useLoaderData();
	// 命中证据来自父路由已经拿到的检索结果——不为了标记而再查一次库
	const { result: search } = useLoaderData({ from: "/s/$turnId" });
	const result =
		search && search.order !== "employee"
			? search.results.find((r) => r.employee.empId === employee.empId)
			: undefined;
	return (
		<Person
			employee={employee}
			hits={result?.hits ?? []}
			names={search?.claims.map(claimName) ?? []}
			timeline={timeline}
		/>
	);
}
