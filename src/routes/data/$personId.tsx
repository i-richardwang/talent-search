import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Empty } from "#/components/ui/empty";
import { dataEmployee } from "#/server/functions";
import { EmployeeDrawer, EmployeeRecord } from "./-components/employee-drawer";

/**
 * 一个人的每一段经历：登记的内容、推断的序列、抽取出的能力词和投入档，以及这一段
 * 有没有解析到当前版本——没有的话抽取结果是上一版的。
 */
export const Route = createFileRoute("/data/$personId")({
	loader: async ({ params }) => {
		const data = await dataEmployee({ data: { personId: params.personId } });
		if (!data) throw notFound();
		return data;
	},
	component: Employee,
	notFoundComponent: EmployeeNotFound,
});

/** 关掉抽屉是回到刚才那张表，所以词和页码原样带回去。 */
function useClose() {
	const navigate = useNavigate();
	const search = Route.useSearch();
	return () => void navigate({ search, to: "/data" });
}

function Employee() {
	const { employee, segments, sources } = Route.useLoaderData();
	return (
		<EmployeeRecord
			close={useClose()}
			employee={employee}
			sources={sources}
			segments={segments}
		/>
	);
}

function EmployeeNotFound() {
	return (
		<EmployeeDrawer close={useClose()} title="没有这份档案">
			<Empty
				description="可以回到人才库重新查找。"
				title="找不到这份人才档案"
			/>
		</EmployeeDrawer>
	);
}
