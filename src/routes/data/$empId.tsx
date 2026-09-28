import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Empty } from "#/components/ui/empty";
import { dataEmployee } from "#/server/functions";
import { EmployeeDrawer, EmployeeRecord } from "./-components/employee-drawer";

/**
 * 一个人的每一段经历：登记的内容、推断的序列、抽取出的能力词和做过的事，以及这一段
 * 有没有派生到当前版本——没有的话抽取结果是上一版的。
 */
export const Route = createFileRoute("/data/$empId")({
	loader: async ({ params }) => {
		const data = await dataEmployee({ data: { empId: params.empId } });
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
	const { employee, segments } = Route.useLoaderData();
	return (
		<EmployeeRecord
			close={useClose()}
			employee={employee}
			segments={segments}
		/>
	);
}

function EmployeeNotFound() {
	return (
		<EmployeeDrawer close={useClose()} title="没有这个工号">
			<Empty
				description="工号可能写错了，或者还没有同步到数据。"
				title="找不到这位员工"
			/>
		</EmployeeDrawer>
	);
}
