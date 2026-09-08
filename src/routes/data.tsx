import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import { Input } from "#/components/ui/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { dataList } from "#/server/functions";

/**
 * 数据页：库里此刻有谁。点一个人看他的每一段和派生结果（`/data/$empId`）。
 *
 * 检索给招聘的人看命中，这一页给管数据的人看库里到底是什么。列表按名字或工号找，
 * 过滤在服务端做——几万人的表一次取齐不值得，找人的时候手里总有名字或工号。
 */
export const Route = createFileRoute("/data")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
	}),
	loaderDeps: ({ search }) => ({ q: search.q }),
	loader: ({ deps }) => dataList({ data: { q: deps.q } }),
	head: () => ({ meta: [{ title: "数据 · 人才搜索" }] }),
	component: Data,
});

function Data() {
	const list = Route.useLoaderData();
	const { q } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [needle, setNeedle] = useState(q);

	return (
		<main className="app-column flex flex-1 flex-col gap-6 py-8">
			<div className="flex flex-col gap-1">
				<h1 className="title-1 font-semibold">数据</h1>
				<p className="text-muted-foreground text-sm">
					{list.total === 0
						? "库里还没有人：先在命令行跑 bun run sync。"
						: `库里 ${list.total} 人${q ? `，匹配「${q}」的列在下面` : ""}。`}
				</p>
			</div>
			<div className="flex gap-6">
				<div className="flex min-w-0 flex-1 flex-col gap-3">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void navigate({ search: { q: needle.trim() } });
						}}
					>
						<Input
							aria-label="按名字或工号找"
							className="max-w-72"
							onChange={(event) => setNeedle(event.target.value)}
							placeholder="按名字或工号找，回车"
							type="search"
							value={needle}
						/>
					</form>
					{list.rows.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>没有匹配的人</EmptyTitle>
								<EmptyDescription>换个名字或工号试试。</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>工号</TableHead>
									<TableHead>姓名</TableHead>
									<TableHead>当前</TableHead>
									<TableHead className="text-end">段</TableHead>
									<TableHead className="text-end">待派生</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{list.rows.map((row) => (
									<TableRow key={row.empId}>
										<TableCell className="tabular-nums">
											<Link
												className="underline-offset-4 hover:underline"
												params={{ empId: row.empId }}
												search={{ q }}
												to="/data/$empId"
											>
												{row.empId}
											</Link>
										</TableCell>
										<TableCell className="font-medium">{row.name}</TableCell>
										<TableCell className="text-muted-foreground">
											{[row.curDept, row.curTitle].filter(Boolean).join(" · ")}
										</TableCell>
										<TableCell className="text-end tabular-nums">
											{row.segments}
										</TableCell>
										<TableCell className="text-end tabular-nums">
											{row.pending === 0 ? "—" : row.pending}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</div>
				<Outlet />
			</div>
		</main>
	);
}
