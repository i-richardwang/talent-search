import {
	createFileRoute,
	notFound,
	useLoaderData,
} from "@tanstack/react-router";
import { fetchEmployee } from "#/server/functions";
import { Person, PersonNotFound, PersonPending } from "./-components/person";

export const Route = createFileRoute("/s/$turnId/p/$empId")({
	loader: async ({ params }) => {
		const data = await fetchEmployee({ data: { empId: params.empId } });
		if (!data) throw notFound();
		return data;
	},
	component: Detail,
	/* 找不到工号时只换这一栏：`notFound()` 由抛它的 loader 所属的路由处理，名单留着。 */
	notFoundComponent: PersonNotFound,
	/* 换人时 loader 要查一次库：快的时候不画骨架，免得闪一下；画出来就留够一段，也免得闪。 */
	pendingMs: 200,
	pendingMinMs: 300,
	pendingComponent: PersonPending,
});

/** 这个人的档案用父路由那次检索里他的证据，证据不另查库。 */
function Detail() {
	const { employee, timeline } = Route.useLoaderData();
	const { result: search } = useLoaderData({ from: "/s/$turnId" });
	// 按人排的名单没有证据：档案只有时间线
	const result =
		search?.order === "evidence"
			? search.results.find((r) => r.employee.empId === employee.empId)
			: undefined;
	return (
		<Person
			employee={employee}
			evidence={result?.evidence ?? []}
			timeline={timeline}
		/>
	);
}
