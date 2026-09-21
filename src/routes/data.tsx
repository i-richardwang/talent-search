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
import { PageNav } from "./-components/page-nav";
import { pageOf } from "./-lib/paging";

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
									<TableRow
										data-state={row.empId === empId ? "selected" : undefined}
										key={row.empId}
									>
										<TableCell className="font-mono text-muted-foreground">
											{row.empId}
										</TableCell>
										{/*
										 * 通往详情的是姓名，一个普通的文字链接——工号那一格是给人
										 * 核对的，看的人认的是名字。表里不做铺满整行的覆盖层：
										 * `<a>` 包不住 `<tr>`，而用绝对定位去补这个缺口得让 `tr`
										 * 当包含块，那件事表格行做不到（覆盖层会落到 `tbody`，每一
										 * 行都铺满整张表）。名单那边整块可点，因为那是卡片
										 * （`result-list.tsx`）——形状不同，读法就不同。
										 */}
										<TableCell className="font-medium">
											<Link
												className="underline-offset-4 hover:underline"
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
							{/* 翻页件占着剩下的宽（它自带 `w-full`），这一句不让它挤成两行 */}
							<p className="whitespace-nowrap text-muted-foreground text-sm">
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
							<PageNav
								linkTo={(page) => <Link search={at(page, q)} to="/data" />}
								page={list.page}
								pages={list.pages}
							/>
						</CardFrameFooter>
					</CardFrame>
				)}
			</div>
			{/* 点开的那个人从右侧覆盖（`data.$empId.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
