import { Link, useNavigate } from "@tanstack/react-router";
import { SearchXIcon, TableIcon } from "lucide-react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { SearchBar } from "#/components/ui/search-bar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
	TableSkeletonRows,
} from "#/components/ui/table";
import { TextLink } from "#/components/ui/text-link";
import { dots, integer } from "#/lib/format";
import type { TablePage } from "#/lib/paging";
import type { EmployeeRow } from "#/server/data";
import { listSearch, useSearchDraft } from "../../-components/admin-page";
import { TablePager } from "../../-components/table-pager";

/**
 * 数据页的内容：按姓名或工号找人，和库里的人那张表。`selected` 是右侧开着详情的工号；
 * `pending` 是换词或翻页后新的一页还没取回，表体画同样行数的占位。
 */
export function EmployeeTable({
	list,
	q,
	selected,
	pending = false,
}: {
	list: TablePage<EmployeeRow>;
	q: string;
	selected: string | undefined;
	pending?: boolean;
}) {
	const navigate = useNavigate({ from: "/data" });
	const [needle, setNeedle] = useSearchDraft(q);
	// 换词就回到第一页
	const search = (needle: string) =>
		void navigate({ search: listSearch(1, needle) });

	return (
		<div className="flex flex-col gap-4">
			<SearchBar
				aria-label="搜索姓名或工号"
				className="max-w-70"
				loading={pending}
				onChange={setNeedle}
				onSearch={search}
				placeholder="搜索姓名或工号"
				value={needle}
			/>
			<Block className="overflow-hidden" variant="outlined">
				{list.rows.length === 0 && !pending ? (
					// 找不到人时标题已经说完了，出路是清掉这个词；库是空的才说去哪同步
					<Empty
						action={
							q ? (
								<Button onClick={() => search("")}>清除搜索</Button>
							) : undefined
						}
						description={q ? undefined : "去任务页运行一次同步。"}
						icon={q ? SearchXIcon : TableIcon}
						size="large"
						title={q ? "没有匹配的人" : "还没有人员数据"}
					/>
				) : (
					<Table
						busy={pending}
						footer={
							<TablePager
								linkTo={(page) => (
									<Link search={listSearch(page, q)} to="/data" />
								)}
								table={list}
								units={{ row: "个", total: "人" }}
							/>
						}
						narrow="cards"
					>
						<TableHeader>
							<TableRow>
								<TableHead>工号</TableHead>
								<TableHead>姓名</TableHead>
								<TableHead className="w-full">当前</TableHead>
								<TableHead className="text-end">经历</TableHead>
								<TableHead className="text-end">待处理</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pending ? (
								<TableSkeletonRows
									columns={5}
									rows={Math.max(list.rows.length, 1)}
								/>
							) : (
								list.rows.map((row) => {
									const detail = {
										params: { empId: row.empId },
										search: listSearch(list.page, q),
										to: "/data/$empId",
									} as const;
									return (
										<TableRow
											data-state={
												row.empId === selected ? "selected" : undefined
											}
											key={row.empId}
											onActivate={() => void navigate(detail)}
										>
											<TableCell
												cellLabel="工号"
												className="whitespace-nowrap font-mono text-fg-secondary"
											>
												{row.empId}
											</TableCell>
											{/* 整行已在 Tab 序里；姓名是给中键、右键用的真链接，不另占 Tab 位 */}
											<TableCell cellSlot="title" className="whitespace-nowrap">
												<TextLink render={<Link {...detail} />} tabIndex={-1}>
													{row.name}
												</TextLink>
											</TableCell>
											<TableCell cellLabel="当前" className="text-fg-secondary">
												{dots(row.curDept, row.curTitle)}
											</TableCell>
											<TableCell
												cellLabel="经历"
												className="whitespace-nowrap text-end tabular-nums"
											>
												{integer(row.segments)}
											</TableCell>
											<TableCell
												cellLabel="待处理"
												className="whitespace-nowrap text-end tabular-nums"
											>
												{row.pending === 0 ? "—" : integer(row.pending)}
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				)}
			</Block>
		</div>
	);
}
