import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Block } from "#/components/ui/block";
import { Empty } from "#/components/ui/empty";
import { SearchBar } from "#/components/ui/search-bar";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table";
import { TextLink } from "#/components/ui/text-link";
import { dots } from "#/lib/format";
import type { TablePage } from "#/lib/paging";
import type { EmployeeRow } from "#/server/data";
import { TablePager } from "../../-components/table-pager";

/** 一个链接指向的这一页。页码和词总是一起走：换了词，页码就不是同一批人了。 */
function at(page: number, q: string) {
	return { page: page > 1 ? page : undefined, q };
}

/**
 * 数据页（`routes/data/route.tsx`）的内容：按姓名或工号找人的输入框，和库里的人那张表。
 * `list` 是服务端按 `q` 找出、分好页的那一页，`selected` 是右侧开着详情的那个工号。
 */
export function EmployeeTable({
	list,
	q,
	selected,
}: {
	list: TablePage<EmployeeRow>;
	q: string;
	selected: string | undefined;
}) {
	const navigate = useNavigate({ from: "/data" });
	const [needle, setNeedle] = useState(q);
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
		<div className="flex flex-col gap-3">
			{/* 换词就回到第一页：上一次翻到的第 7 页在新的结果里不是同一批人 */}
			<SearchBar
				aria-label="搜索姓名或工号"
				className="max-w-96"
				onChange={setNeedle}
				onSearch={(needle) => void navigate({ search: at(1, needle) })}
				placeholder="搜索姓名或工号"
				value={needle}
			/>
			{list.rows.length === 0 ? (
				// 找不到人的时候标题已经说完了；库是空的才需要说出路
				<Empty
					description={q ? undefined : "还没有同步任何数据，请联系管理员。"}
					title={q ? "没有匹配的人" : "还没有人员数据"}
				/>
			) : (
				<Block className="overflow-hidden" variant="outlined">
					{/* 这张表和全部的关系属于表自身，所以在表下面那一条表脚，不在页面标题旁。 */}
					<Table
						footer={
							<TablePager
								linkTo={(page) => <Link search={at(page, q)} to="/data" />}
								table={list}
								units={{ row: "个", total: "人" }}
							/>
						}
						narrow="cards"
						size="middle"
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
							{list.rows.map((row) => {
								const detail = {
									params: { empId: row.empId },
									search: at(list.page, q),
									to: "/data/$empId",
								} as const;
								return (
									<TableRow
										data-state={row.empId === selected ? "selected" : undefined}
										key={row.empId}
										onActivate={() => void navigate(detail)}
									>
										<TableCell
											cellLabel="工号"
											className="whitespace-nowrap font-mono text-fg-secondary"
										>
											{row.empId}
										</TableCell>
										{/*
										 * 整行点开详情，行本身在 Tab 序里；姓名仍是一个真链接，
										 * 中键、右键、新标签页照常，所以它不单独占一个 Tab 位。
										 */}
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
											{row.segments}
										</TableCell>
										<TableCell
											cellLabel="待处理"
											className="whitespace-nowrap text-end tabular-nums"
										>
											{row.pending === 0 ? "—" : row.pending}
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</Block>
			)}
		</div>
	);
}
