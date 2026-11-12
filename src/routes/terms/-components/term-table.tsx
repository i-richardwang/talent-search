import { Link, useNavigate } from "@tanstack/react-router";
import { ListRestartIcon, SearchXIcon, TagsIcon } from "lucide-react";
import { Block } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { SearchBar } from "#/components/ui/search-bar";
import { Segmented } from "#/components/ui/segmented";
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
import type { Rejudge } from "#/lib/task";
import type { TermEntry } from "#/server/terms";
import { listSearch, useSearchDraft } from "../../-components/admin-page";
import { TablePager } from "../../-components/table-pager";

/** 上次判定是几天前；null 是在等判定。 */
export function daysAgo(days: number | null) {
	return days === null ? "等待判定" : days === 0 ? "今天" : `${days} 天前`;
}

type View = "terms" | "excluded";
const VIEWS: { label: string; value: View }[] = [
	{ label: "标签", value: "terms" },
	{ label: "不是能力", value: "excluded" },
];

/**
 * 词表页的内容：找词，和词表那张表。`excluded` 看的是判成不是能力的词：它们没有归属、
 * 细分和其他写法，那三列不画。`selected` 是右侧开着详情的词；`pending` 是换词
 * 或翻页后新的一页还没取回，表体画同样行数的占位。`rejudge` 只有管理员有：没在找词时，
 * 把眼前这一整张表退回重新判定。
 */
export function TermTable({
	table,
	q,
	excluded,
	selected,
	pending = false,
	rejudge,
}: {
	table: TablePage<TermEntry>;
	q: string;
	excluded: boolean;
	selected: string | undefined;
	pending?: boolean;
	rejudge?: (scope: Rejudge) => void;
}) {
	const navigate = useNavigate({ from: "/terms" });
	const [needle, setNeedle] = useSearchDraft(q);
	const at = (page: number, needle: string, view = excluded) => ({
		...listSearch(page, needle),
		excluded: view || undefined,
	});
	const search = (needle: string) => void navigate({ search: at(1, needle) });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3">
				<Segmented
					aria-label="看哪一类词"
					onChange={(view) =>
						void navigate({ search: at(1, "", view === "excluded") })
					}
					options={VIEWS}
					value={excluded ? "excluded" : "terms"}
				/>
				<SearchBar
					aria-label={excluded ? "搜索不是能力的词" : "搜索标签"}
					className="max-w-70"
					loading={pending}
					onChange={setNeedle}
					onSearch={search}
					placeholder={excluded ? "搜索词" : "搜索标签、写法或所属的标签"}
					value={needle}
				/>
				{rejudge && !q && table.total > 0 && (
					<Button
						className="ms-auto"
						icon={ListRestartIcon}
						onClick={() => rejudge({ scope: excluded ? "excluded" : "all" })}
					>
						全部重新判定
					</Button>
				)}
			</div>
			<Block className="overflow-hidden" variant="outlined">
				{table.rows.length === 0 && !pending ? (
					// 没匹配上时标题已经说完了，下一步是清掉这个词；词表是空的才说它从哪来
					<Empty
						action={
							q ? (
								<Button onClick={() => search("")}>清除搜索</Button>
							) : undefined
						}
						description={
							q
								? undefined
								: excluded
									? "整理时判成不是一项能力的词会列在这里，它们不出现在筛选和候选词里。"
									: "经历解析完成后，这里会列出简历里读出的标签及相关写法。"
						}
						icon={q ? SearchXIcon : TagsIcon}
						size="large"
						title={
							q
								? excluded
									? "没有匹配的词"
									: "没有匹配的标签"
								: excluded
									? "没有判成不是能力的词"
									: "还没有标签"
						}
					/>
				) : (
					/* 一行是一个词，表脚数「项」；人数在每一行里 */
					<Table
						busy={pending}
						footer={
							<TablePager
								linkTo={(page) => <Link search={at(page, q)} to="/terms" />}
								table={table}
								units={{ row: "项", total: "项" }}
							/>
						}
						narrow="cards"
					>
						<TableHeader>
							<TableRow>
								<TableHead>{excluded ? "词" : "标签"}</TableHead>
								<TableHead className="text-end">人数</TableHead>
								{!excluded && (
									<>
										<TableHead>属于</TableHead>
										<TableHead className="text-end">细分</TableHead>
										<TableHead className="w-full">其他写法</TableHead>
									</>
								)}
								<TableHead className="text-end">上次判定</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{pending ? (
								<TableSkeletonRows
									columns={excluded ? 3 : 6}
									rows={Math.max(table.rows.length, 1)}
								/>
							) : (
								table.rows.map((e) => {
									const detail = {
										params: { word: e.canonical },
										search: at(table.page, q),
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
											{!excluded && (
												<>
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
												</>
											)}
											<TableCell
												cellLabel="上次判定"
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
