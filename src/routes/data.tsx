import {
	createFileRoute,
	Link,
	Outlet,
	useParams,
} from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useRef, useState } from "react";
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

	/*
	 * 输入框里的草稿跟随地址栏上的 q：后退、前进或从别的链接进来时，它要回到那一
	 * 次搜索的词，否则输入框和它下面的表显示的不是同一件事，而用户会以为表是按
	 * 输入框里的词列出来的。
	 *
	 * 在渲染中直接同步，不放进 effect：effect 要等这一帧画完才跑，那一帧屏幕上是
	 * 新表配旧词（和 `s/$turnId/-lib/picks.ts` 换记录时重置同理）。用户自己提交的
	 * 那次 q 恰好等于草稿，这里是一次同值 setState，焦点和光标都不动。
	 */
	const seen = useRef(q);
	if (seen.current !== q) {
		seen.current = q;
		setNeedle(q);
	}

	return (
		<AdminPage title="数据">
			<div className="flex flex-col gap-3">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void navigate({ search: { q: needle.trim() } });
					}}
				>
					{/*
					 * 输入框和提交按钮在同一块面上。这里必须提交才会搜（几万人需要回
					 * 服务端查），所以末尾放一个真按钮表明这一点；技能页是即时过滤，
					 * 开头只有一个漏斗图标，两者形状不同是因为行为不同。
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
								<EmptyDescription>先在命令行跑 bun run sync。</EmptyDescription>
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
									 * 整行可点，但链接只有一个：姓名上的 `after:inset-0` 铺满整行，
									 * 名单卡片用的是同一个做法（`result-list.tsx`）。这一行就是这
									 * 个人在表上的全部内容，只让工号可点的话，点击区域只有最左边
									 * 那几个字，而用户看的是姓名。
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
						 * 「库里多少人」放在表自身上（`CardFrameFooter`，排法照上游
						 * `p-table-8`），不放在页面标题旁：它说的是这张表和库的关系——列出
						 * 200 行，而库里有 5000 人。两个数分写两处的话，读起来像库里只有这
						 * 些，而且两个数都是对的，不会有人报这个问题。
						 */}
						<CardFrameFooter className="text-muted-foreground text-xs">
							{list.capped
								? `库里 ${list.total} 人，只列了前 ${list.rows.length} 个——用名字或工号缩小范围。`
								: `库里 ${list.total} 人。`}
						</CardFrameFooter>
					</CardFrame>
				)}
			</div>
			{/* 点开的那个人从右侧覆盖（`data.$empId.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
