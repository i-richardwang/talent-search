import { useNavigate, useRouterState } from "@tanstack/react-router";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { AdminPage } from "#/routes/-components/admin-page";
import { EmployeeTable } from "#/routes/data/-components/employee-table";
import { SkillTable } from "#/routes/skills/-components/skill-table";
import { TaskBoard } from "#/routes/tasks/-components/task-board";
import { Routed } from "../../routed";
import {
	CORPUS_COUNTS,
	EMPLOYEE_ROWS,
	SKILL_ROWS,
	TASK_LANES,
} from "../../samples/admin";
import { LayoutSwitch, Shell } from "./home";

/*
 * 管理页：`src/routes/-components/admin-page.tsx` 的外壳里放任务、数据、技能三页的
 * 产品内容（`task-board.tsx`、`employee-table.tsx`、`skill-table.tsx`）。哪一页由内存
 * router 的地址决定，导航栏「管理」一组的三项和页底的切换都能换。服务端函数
 * 在设计系统里是调用即失败的桩：找词和翻页按地址上的 `q`、`page` 在样例上算，
 * 一页的行数是产品的 `pageAt` 给的；「立即运行」和「日志」落在各自取不到的那一支。
 */

type Page = "tasks" | "data" | "skills";

/** 地址在 `/data` 下是数据页，`/skills` 下是技能页，其余是任务页。 */
function usePage(): Page {
	return useRouterState({
		select: (state) => {
			const path = state.location.pathname;
			if (path.startsWith("/data")) return "data";
			if (path.startsWith("/skills")) return "skills";
			return "tasks";
		},
	});
}

/** 地址上的词和页码，以及路径最后一段（开着详情的那个工号或词）。 */
function useListView() {
	const { search, pathname } = useRouterState({
		select: (state) => state.location,
	});
	const { q = "", page } = search as { q?: string; page?: number };
	return { opened: /^\/[^/]+\/([^/]+)$/.exec(pathname)?.[1], page, q };
}

/** 服务端那一套算术用在样例上：按地址上的页码取一页。 */
function pageOfRows<T>(rows: T[], want: unknown): TablePage<T> {
	const at = pageAt(rows.length, want);
	return tablePage(
		rows.slice(at.offset, at.offset + at.limit),
		rows.length,
		at,
	);
}

/** 任务页：每类任务一张卡，派生正在跑，所以「立即运行」都是禁用的。 */
function Tasks() {
	const running = TASK_LANES.some((lane) => lane.latest?.outcome === "running");
	return (
		<AdminPage title="任务">
			<TaskBoard
				busy={running}
				corpus={CORPUS_COUNTS}
				judge="model"
				lanes={TASK_LANES}
				onDone={() => {}}
			/>
		</AdminPage>
	);
}

/** 数据页：按姓名或工号找人。 */
function Data() {
	const { opened, page, q } = useListView();
	const found = EMPLOYEE_ROWS.filter(
		(row) => row.name.includes(q) || row.empId.includes(q),
	);
	return (
		<AdminPage title="数据">
			<EmployeeTable list={pageOfRows(found, page)} q={q} selected={opened} />
		</AdminPage>
	);
}

/** 技能页：词本身、其他写法或所属的词里有这个词就算匹配。 */
function Skills() {
	const { opened, page, q } = useListView();
	const found = SKILL_ROWS.filter((row) =>
		[row.canonical, ...row.aliases, row.parent ?? ""].some((word) =>
			word.includes(q),
		),
	);
	return (
		<AdminPage title="技能">
			<SkillTable
				q={q}
				selected={opened && decodeURIComponent(opened)}
				table={pageOfRows(found, page)}
			/>
		</AdminPage>
	);
}

function Admin() {
	const page = usePage();
	return page === "data" ? (
		<Data />
	) : page === "skills" ? (
		<Skills />
	) : (
		<Tasks />
	);
}

/** 页底切换：任务、数据、技能三页。 */
function PageSwitch() {
	const navigate = useNavigate();
	return (
		<LayoutSwitch<Page>
			label="管理页"
			onChange={(next) =>
				void navigate(
					next === "tasks"
						? { to: "/tasks" }
						: { search: { page: undefined, q: "" }, to: `/${next}` },
				)
			}
			options={[
				{ label: "任务", value: "tasks" },
				{ label: "数据", value: "data" },
				{ label: "技能", value: "skills" },
			]}
			value={usePage()}
		/>
	);
}

/** 管理页：标题和一块内容，任务、数据、技能三种内容切换。 */
export function AdminLayoutPage() {
	return (
		<Routed url="/tasks">
			<Shell>
				<Admin />
			</Shell>
			<PageSwitch />
		</Routed>
	);
}
