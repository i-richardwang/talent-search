import {
	createFileRoute,
	Link,
	Outlet,
	useParams,
} from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { CardFrame, CardFrameFooter } from "#/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "#/components/ui/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "#/components/ui/input-group";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { dots } from "#/lib/format";
import { dataList } from "#/server/functions";
import { AdminPage } from "./-components/admin-page";

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
	// 开着的是哪一个人。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { empId } = useParams({ strict: false });

	return (
		<AdminPage title="数据">
			{/* 窄屏上详情栏排到列表下面：这一页只有管数据的人会开，不值得为它再搭一套
			    模态；而两栏并排的下限就是详情栏那 28rem 加上一张读得下的表。 */}
			<div className="flex flex-col gap-6 xl:flex-row">
				<div className="flex min-w-0 flex-1 flex-col gap-3">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							void navigate({ search: { q: needle.trim() } });
						}}
					>
						{/*
						 * 框和它的提交按钮是同一块面。这里非回车不可（几万人得回服务端
						 * 找），所以末尾挂一个真按钮说出这件事——技能那一页是即时过滤，
						 * 起头只有一枚漏斗，两者形状不同正是因为它们做的不是同一件事。
						 */}
						<InputGroup className="max-w-96">
							<InputGroupAddon>
								<SearchIcon />
							</InputGroupAddon>
							<InputGroupInput
								aria-label="搜索姓名或工号"
								onChange={(event) => setNeedle(event.target.value)}
								placeholder="搜索姓名或工号"
								type="search"
								value={needle}
							/>
							<InputGroupAddon align="inline-end">
								<Button size="xs" type="submit" variant="ghost">
									搜索
								</Button>
							</InputGroupAddon>
						</InputGroup>
					</form>
					{list.rows.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>
									{list.total === 0 ? "库里还没有人" : "没有匹配的人"}
								</EmptyTitle>
								{/* 找不到人的时候标题已经说完了；库是空的才需要说出路 */}
								{list.total === 0 && (
									<EmptyDescription>
										先在命令行跑 bun run sync。
									</EmptyDescription>
								)}
							</EmptyHeader>
						</Empty>
					) : (
						<CardFrame>
							<Table variant="card">
								<TableHeader>
									<TableRow>
										<TableHead>工号</TableHead>
										<TableHead>姓名</TableHead>
										<TableHead>当前</TableHead>
										<TableHead className="text-end">经历</TableHead>
										<TableHead className="text-end">待解析</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{list.rows.map((row) => (
										/*
										 * 整行可点，链接只有一个：姓名上那个 `after:inset-0` 铺满
										 * 整行——名单卡片上用的是同一招（`result-list.tsx`）。
										 * 行是这个人在这张表上的全部，只让工号那一格可点的话，
										 * 命中区是屏幕最左边那几个字，而人眼盯着的是姓名。
										 */
										<TableRow
											className="relative"
											data-state={row.empId === empId ? "selected" : undefined}
											key={row.empId}
										>
											<TableCell className="font-mono text-muted-foreground">
												{row.empId}
											</TableCell>
											<TableCell className="font-medium">
												<Link
													className="after:absolute after:inset-0 after:content-['']"
													params={{ empId: row.empId }}
													search={{ q }}
													to="/data/$empId"
												>
													{row.name}
												</Link>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{dots(row.curDept, row.curTitle)}
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
							{/*
							 * 「库里多少人」长在表自己身上（`CardFrameFooter`，排法照上游
							 * `p-table-8`），不在这一页的抬头上：它说的是这张表和库的关系——
							 * 列着 200 行，而库里有 5000 个人。两个数分开写在两处的话，读起来
							 * 像库里只有这些，而且两个数都是对的，谁都不会报这个 bug。
							 */}
							<CardFrameFooter className="text-muted-foreground text-xs">
								{list.capped
									? `库里 ${list.total} 人，只列了前 ${list.rows.length} 个——用名字或工号缩小范围。`
									: `库里 ${list.total} 人。`}
							</CardFrameFooter>
						</CardFrame>
					)}
				</div>
				<Outlet />
			</div>
		</AdminPage>
	);
}
