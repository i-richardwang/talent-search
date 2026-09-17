import {
	createFileRoute,
	Link,
	Outlet,
	useParams,
} from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
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
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
} from "#/components/ui/pagination";
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
 * 检索给招聘的人看命中，这一页给管数据的人看库里到底是什么。找人按名字或工号，
 * 翻页和过滤都在服务端做——几万人一次取齐不值得，而这一页是要能一直往后翻到底的：
 * 没有词的时候它就是库的全部内容。页码在地址里，所以某一页可以直接发给别人。
 */
export const Route = createFileRoute("/data")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageOf(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => dataList({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "数据 · 人才搜索" }] }),
	component: Data,
});

/**
 * 地址栏上的页码。第一页是 undefined——默认值不写进地址，否则刚进来的链接和
 * 翻回第一页的链接是两个不同的字符串（检索那边同一条规矩，见 `view-params.ts`）。
 */
function pageOf(v: unknown) {
	const n = Math.trunc(Number(v));
	return Number.isFinite(n) && n > 1 ? n : undefined;
}

/** 一个链接指向的这一页。页码和词总是一起走：换了词，页码就不是同一批人了。 */
function at(page: number, q: string) {
	return { page: page > 1 ? page : undefined, q };
}

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
						// 换词就回到第一页：上一次翻到的第 7 页在新的结果里不是同一批人
						void navigate({ search: at(1, needle.trim()) });
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
							<EmptyTitle>{q ? "没有匹配的人" : "还没有人员数据"}</EmptyTitle>
							{/* 找不到人的时候标题已经说完了；库是空的才需要说出路 */}
							{!q && (
								<EmptyDescription>
									还没有同步任何数据，请联系管理员。
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
									<TableHead className="text-end">待处理</TableHead>
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
												search={at(list.page, q)}
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
						 * 这一行说的是「这张表」和「全部」的关系：正在看第几个到第几个，
						 * 一共多少人，以及往前往后。它属于表自身，所以在 `CardFrameFooter`
						 * 里，不在页面标题旁；排法照上游 `p-table-8`：左边范围，右边翻页。
						 *
						 * 只有一页的时候不说范围也不放翻页件：那一页就是全部，「第 1–20 个，
						 * 共 20 人」是同一件事说两遍。
						 */}
						<CardFrameFooter className="flex items-center justify-between gap-2 p-2">
							<p className="text-muted-foreground text-sm">
								{list.pages > 1 && (
									<>
										第 {list.from}–{list.from + list.rows.length - 1} 个，共{" "}
									</>
								)}
								<strong className="font-medium text-foreground">
									{list.total}
								</strong>{" "}
								人
							</p>
							{/*
							 * 不列页码：按工号排的第 37 页对找人的人不说明任何事，几千人
							 * 就是几十个这样的页码。找某一个人用上面的搜索框，翻页是用来把
							 * 库看完的。
							 */}
							{list.pages > 1 && (
								<Pagination className="w-auto justify-end">
									<PaginationContent>
										<PaginationItem>
											<PageLink page={list.page - 1} pages={list.pages} q={q}>
												上一页
											</PageLink>
										</PaginationItem>
										<PaginationItem>
											<PageLink page={list.page + 1} pages={list.pages} q={q}>
												下一页
											</PageLink>
										</PaginationItem>
									</PaginationContent>
								</Pagination>
							)}
						</CardFrameFooter>
					</CardFrame>
				)}
			</div>
			{/* 点开的那个人从右侧覆盖（`data.$empId.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}

/**
 * 翻到第 `page` 页。到头的那一头不带链接、禁用，但位置留着——两个按钮一直都在，
 * 翻到最后一页时「下一页」不会消失、让「上一页」跳过来。
 */
function PageLink({
	page,
	pages,
	q,
	children,
}: {
	page: number;
	pages: number;
	q: string;
	children: ReactNode;
}) {
	const beyond = page < 1 || page > pages;
	return (
		<PaginationLink
			render={
				<Button
					disabled={beyond}
					render={beyond ? undefined : <Link search={at(page, q)} to="/data" />}
					size="sm"
					variant="outline"
				/>
			}
		>
			{children}
		</PaginationLink>
	);
}
