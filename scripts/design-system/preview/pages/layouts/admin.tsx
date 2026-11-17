import { useNavigate, useRouterState } from "@tanstack/react-router";
import { pageAt, type TablePage, tablePage } from "#/lib/paging";
import { AdminPage } from "#/routes/-components/admin-page";
import { AccountTable } from "#/routes/accounts/-components/account-table";
import { AuditTable } from "#/routes/audit/-components/audit-table";
import { EmployeeRecord } from "#/routes/data/-components/employee-drawer";
import { EmployeeTable } from "#/routes/data/-components/employee-table";
import { TaskBoard } from "#/routes/tasks/-components/task-board";
import { TermRecord } from "#/routes/terms/-components/term-drawer";
import { TermTable } from "#/routes/terms/-components/term-table";
import { Routed } from "../../routed";
import {
	ACCOUNT_ROWS,
	AUDIT_ROWS,
	EMPLOYEE_ROWS,
	EXCLUDED_ROWS,
	SEGMENTS,
	SKILL_ROWS,
	TASK_LANES,
	TERM_DETAILS,
} from "../../samples/admin";
import { EMPLOYEES } from "../../samples/people";
import { LayoutSwitch, Shell } from "./home";

/*
 * 管理页：`src/routes/-components/admin-page.tsx` 的外壳里放任务、数据、词表、审计、账号五页的
 * 产品内容（`task-board.tsx`、`employee-table.tsx`、`term-table.tsx`、`audit-table.tsx`、
 * `account-table.tsx`）。
 * 哪一页由内存 router 的地址决定，导航栏底上的几项和页底的切换都能换。服务端函数
 * 在设计系统里是调用即失败的桩：找词和翻页按地址上的 `q`、`page` 在样例上算，
 * 一页的行数是产品的 `pageAt` 给的；「立即运行」和「日志」落在各自取不到的那一支。
 * 点开 Talent 0101、「推荐系统」或「不是能力」那张表里的「周报」，右侧出产品的详情抽屉
 *（样例只备了这三份）。账号页上新建账号、重置密码交出的是同一个样例密码，改角色、停用、
 * 恢复不改样例，表不变；当前账号是样例里的管理员 `admin`；新建时用户名填 `admin` 看用户名
 * 被占用的那一支。
 */

type Page = "tasks" | "data" | "terms" | "audit" | "accounts";

/**
 * 地址在 `/data` 下是数据页，`/terms` 下是「标签」页，`/audit` 下是审计页，`/accounts` 下是
 * 账号页，其余是任务页。
 */
function usePage(): Page {
	return useRouterState({
		select: (state) => {
			const path = state.location.pathname;
			if (path.startsWith("/data")) return "data";
			if (path.startsWith("/terms")) return "terms";
			if (path.startsWith("/audit")) return "audit";
			if (path.startsWith("/accounts")) return "accounts";
			return "tasks";
		},
	});
}

/** 地址上的词、页码和看的是不是「不是能力」那张表，以及路径最后一段（开着详情的那个工号或词）。 */
function useListView() {
	const { search, pathname } = useRouterState({
		select: (state) => state.location,
	});
	const {
		q = "",
		page,
		excluded = false,
	} = search as { q?: string; page?: number; excluded?: boolean };
	return {
		excluded,
		opened: /^\/[^/]+\/([^/]+)$/.exec(pathname)?.[1],
		page,
		q,
	};
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

/** 任务页：每类任务一张卡，解析正在跑，所以「立即运行」都是禁用的。 */
function Tasks() {
	const running = TASK_LANES.some((lane) => lane.latest?.outcome === "running");
	return (
		<AdminPage title="任务">
			<TaskBoard
				busy={running}
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
	const navigate = useNavigate();
	const employee = EMPLOYEES.find((e) => e.empId === opened);
	return (
		<AdminPage title="数据">
			<EmployeeTable list={pageOfRows(found, page)} q={q} selected={opened} />
			{employee && (
				<EmployeeRecord
					close={() => void navigate({ search: { page, q }, to: "/data" })}
					employee={employee}
					segments={SEGMENTS}
					key={employee.empId}
				/>
			)}
		</AdminPage>
	);
}

/** 「标签」页：词、其他写法或所属的词里有这个词就算匹配。 */
function Terms() {
	const { excluded, opened, page, q } = useListView();
	const found = (excluded ? EXCLUDED_ROWS : SKILL_ROWS).filter((row) =>
		[row.canonical, ...row.aliases, row.parent ?? ""].some((word) =>
			word.includes(q),
		),
	);
	const navigate = useNavigate();
	const word = opened && decodeURIComponent(opened);
	const detail = TERM_DETAILS.find((term) => term.canonical === word);
	return (
		<AdminPage title="标签">
			<TermTable
				excluded={excluded}
				q={q}
				rejudge={() => {}}
				selected={word}
				table={pageOfRows(found, page)}
			/>
			{detail && (
				<TermRecord
					close={() =>
						void navigate({
							search: { excluded: excluded || undefined, page, q },
							to: "/terms",
						})
					}
					key={detail.canonical}
					rejudge={() => {}}
					term={detail}
				/>
			)}
		</AdminPage>
	);
}

/** 审计页：账号、人或搜索内容里有这个词就算匹配。 */
function Audit() {
	const { page, q } = useListView();
	const found = AUDIT_ROWS.filter((row) =>
		[
			row.username,
			row.name,
			row.empId,
			row.empName,
			row.text,
			row.accountUsername,
			row.accountName,
		].some((value) => value?.includes(q)),
	);
	return (
		<AdminPage title="审计">
			<AuditTable list={pageOfRows(found, page)} q={q} />
		</AdminPage>
	);
}

/** 账号页样例里交出的密码。 */
const SAMPLE_PASSWORD = "kT7wq2NfHx9mRc4P";

/** 账号页：用户名或显示名称里有这个词就算匹配。 */
function Accounts() {
	const { page, q } = useListView();
	const found = ACCOUNT_ROWS.filter(
		(row) => row.username.includes(q) || row.name.includes(q),
	);
	return (
		<AdminPage title="账号">
			<AccountTable
				actions={{
					create: async (username) =>
						ACCOUNT_ROWS.some((row) => row.username === username)
							? null
							: SAMPLE_PASSWORD,
					reset: async () => SAMPLE_PASSWORD,
					setAdmin: async () => {},
					setDisabled: async () => {},
				}}
				list={pageOfRows(found, page)}
				q={q}
				self="admin"
			/>
		</AdminPage>
	);
}

function Admin() {
	const page = usePage();
	if (page === "data") return <Data />;
	if (page === "terms") return <Terms />;
	if (page === "audit") return <Audit />;
	if (page === "accounts") return <Accounts />;
	return <Tasks />;
}

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
				{ label: "标签", value: "terms" },
				{ label: "审计", value: "audit" },
				{ label: "账号", value: "accounts" },
			]}
			value={usePage()}
		/>
	);
}

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
