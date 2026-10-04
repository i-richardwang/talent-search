import { Link, useNavigate } from "@tanstack/react-router";
import { SearchXIcon, TagsIcon } from "lucide-react";
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
import { integer } from "#/lib/format";
import type { TablePage } from "#/lib/paging";
import type { TermEntry } from "#/server/terms";
import { listSearch, useSearchDraft } from "../../-components/admin-page";
import { TablePager } from "../../-components/table-pager";

export function daysAgo(days: number) {
	return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * 词表页的内容：找词，和词表那张表。`selected` 是右侧开着详情的词；`pending` 是换词
 * 或翻页后新的一页还没取回，表体画同样行数的占位。
 */
export function TermTable({
	table,
	q,
	selected,
	pending = false,
}: {
	table: TablePage<TermEntry>;
	q: string;
	selected: string | undefined;
	pending?: boolean;
}) {
	const navigate = useNavigate({ from: "/terms" });
	const [needle, setNeedle] = useSearchDraft(q);
	const search = (needle: string) =>
		void navigate({ search: listSearch(1, needle) });

	return (
		<div className="flex flex-col gap-4">
			<SearchBar
				aria-label="搜索标签"
				className="max-w-70"
				loading={pending}
				onChange={setNeedle}
				onSearch={search}
				placeholder="搜索标签、写法或所属的标签"
				value={needle}
			/>
			<Block className="overflow-hidden" variant="outlined">
				{table.rows.length === 0 && !pending ? (
					// 没匹配上时标题已经说完了，出路是清掉这个词；词表本身是空的才说它从哪来
					<Empty
						action={
							q ? (
								<Button onClick={() => search("")}>清除搜索</Button>
							) : undefined
						}
						description={
							q
								? undefined
								: "经历解析完成后，这里会列出简历里读出的标签及相关写法。"
						}
						icon={q ? SearchXIcon : TagsIcon}
						size="large"
						title={q ? "没有匹配的标签" : "还没有标签"}
					/>
				) : (
					/* 一行是一个词，表脚数「项」；人数在每一行里 */
					<Table
						busy={pending}
						footer={
							<TablePager
								linkTo={(page) => (
									<Link search={listSearch(page, q)} to="/terms" />
								)}
								table={table}
								units={{ row: "项", total: "项" }}
							/>
						}
						narrow="cards"
					>
						<TableHeader>
							<TableRow>
								<TableHead>标签</TableHead>
								<TableHead className="text-end">人数</TableHead>
								<TableHead>属于</TableHead>
								<TableHead className="text-end">细分</TableHead>
								<TableHead className="w-full">其他写法</TableHead>
								<TableHead className="text-end">上次整理</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pending ? (
								<TableSkeletonRows
									columns={6}
									rows={Math.max(table.rows.length, 1)}
								/>
							) : (
								table.rows.map((e) => {
									const detail = {
										params: { word: e.canonical },
										search: listSearch(table.page, q),
										to: "/terms/$word",
									} as const;
									return (
										<TableRow
											data-state={
												e.canonical === selected ? "selected" : undefined
											}
											key={e.canonical}
											onActivate={() => void navigate(detail)}
										>
											{/* 整行已在 Tab 序里；词是给中键、右键用的真链接，不另占 Tab 位 */}
											<TableCell cellSlot="title" className="whitespace-nowrap">
												<TextLink render={<Link {...detail} />} tabIndex={-1}>
													{e.canonical}
												</TextLink>
											</TableCell>
											<TableCell
												cellLabel="人数"
												className="whitespace-nowrap text-end tabular-nums"
											>
												{integer(e.people)}
											</TableCell>
											<TableCell
												cellLabel="属于"
												className="whitespace-nowrap text-fg-secondary"
											>
												{e.parent ?? "—"}
											</TableCell>
											{/* 细分只给项数：多的有二十几项，列全了这一格比整行还高；具体几项在详情里 */}
											<TableCell
												cellLabel="细分"
												className="whitespace-nowrap text-end text-fg-secondary tabular-nums"
											>
												{e.children ? integer(e.children) : "—"}
											</TableCell>
											<TableCell
												cellLabel="其他写法"
												className="text-fg-secondary"
											>
												{e.aliases.length ? e.aliases.join("、") : "—"}
											</TableCell>
											<TableCell
												cellLabel="上次整理"
												className="whitespace-nowrap text-end text-fg-secondary tabular-nums"
											>
												{daysAgo(e.reviewedDaysAgo)}
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
