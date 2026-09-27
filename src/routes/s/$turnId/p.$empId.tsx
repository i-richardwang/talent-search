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
	/* 找不到工号时只换这一栏：`notFound()` 由抛它的 loader 所属的路由接住，名单留着。 */
	notFoundComponent: PersonNotFound,
	/*
	 * 换人时 loader 要查一次库：超过 200ms 才画骨架，免得快的时候闪一下；画出来至少
	 * 留 300ms。
	 */
	pendingMs: 200,
	pendingMinMs: 300,
	pendingComponent: PersonPending,
});

/** 这个人的档案接上父路由那次检索里他的命中。 */
function Detail() {
	const { employee, timeline } = Route.useLoaderData();
	// 命中证据取自父路由已有的检索结果，不再查库
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
