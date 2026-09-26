import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { Empty } from "#/components/ui/empty";
import { dataEmployee } from "#/server/functions";
import { EmployeeDrawer, EmployeeRecord } from "./-components/employee-drawer";

/**
 * 一个人的每一段经历：登记的字段和解析出的结果并排展示。
 *
 * 用抽屉从右侧覆盖，而不是跳转到新页面。管理数据的人是顺着表往下看的——看一个、
 * 回到表、再看下一个；跳页的话每次返回，表格都已经滚回顶部。抽屉底下的表保持
 * 原样，关掉就能接着刚才那一行继续。
 *
 * 每一段展示四件事：登记的内容（同步写入）、推断的序列归属、抽取出的能力词和做过
 * 的事（派生写入），以及这一段有没有派生到当前版本——没有的话下面那些是上一版的
 * 结果。只列这一段真有的，空的那几项整行不出现。
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
