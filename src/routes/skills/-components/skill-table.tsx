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
import type { TablePage } from "#/lib/paging";
import type { SkillEntry } from "#/server/skills";
import { TablePager } from "../../-components/table-pager";

/** 一个链接指向的这一页。页码和词总是一起走：换了词，页码就不是同一批词了。 */
function at(page: number, q: string) {
	return { page: page > 1 ? page : undefined, q };
}

function daysAgo(days: number) {
	return days === 0 ? "今天" : `${days} 天前`;
}

/**
 * 技能页（`routes/skills/route.tsx`）的内容：找词的输入框，和词表那张表。
 * `table` 是服务端按 `q` 找出、分好页的那一页，`selected` 是右侧开着详情的那个词。
 */
export function SkillTable({
	table,
	q,
	selected,
}: {
	table: TablePage<SkillEntry>;
	q: string;
	selected: string | undefined;
}) {
	const navigate = useNavigate({ from: "/skills" });
	const [needle, setNeedle] = useState(q);
	/*
	 * 输入框里的草稿跟随地址栏上的 q，同数据页：后退、前进或从别的链接进来时，它要
	 * 回到那一次搜索的词，否则输入框和它下面的表显示的不是同一件事。在渲染中直接
	 * 同步，不放进 effect——effect 要等这一帧画完才跑，那一帧屏幕上是新表配旧词。
	 */
	const seen = useRef(q);
	if (seen.current !== q) {
		seen.current = q;
		setNeedle(q);
	}

	return (
		<div className="flex flex-col gap-3">
			{/* 换词就回到第一页：上一次翻到的第 7 页在新的结果里不是同一批词 */}
			<SearchBar
				aria-label="搜索技能"
				className="max-w-96"
				onChange={setNeedle}
				onSearch={(needle) => void navigate({ search: at(1, needle) })}
				placeholder="搜索技能、写法或所属的词"
				value={needle}
			/>
			{table.rows.length === 0 ? (
				// 没匹配上的时候标题已经把话说完了；只有词表本身是空的，才需要说该怎么办
				<Empty
					description={
						q ? undefined : "经历处理完成后，这里会列出技能及相关写法。"
					}
					title={q ? "没有匹配的技能" : "还没有技能"}
				/>
			) : (
				<Block className="overflow-hidden" variant="outlined">
					{/* 表脚数的是「项」不是「人」：这里一行是一个词，每一行右边那个数才是人。 */}
					<Table
						footer={
							<TablePager
								linkTo={(page) => <Link search={at(page, q)} to="/skills" />}
								table={table}
								units={{ row: "项", total: "项" }}
							/>
						}
						narrow="cards"
						size="middle"
					>
						<TableHeader>
							<TableRow>
								<TableHead>技能</TableHead>
								<TableHead className="text-end">人数</TableHead>
								<TableHead>属于</TableHead>
								<TableHead className="text-end">细分</TableHead>
								<TableHead className="w-full">其他写法</TableHead>
								<TableHead className="text-end">上次更新</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{table.rows.map((e) => {
								const detail = {
									params: { word: e.canonical },
									search: at(table.page, q),
									to: "/skills/$word",
								} as const;
								return (
									<TableRow
										data-state={
											e.canonical === selected ? "selected" : undefined
										}
										key={e.canonical}
										onActivate={() => void navigate(detail)}
									>
										{/*
										 * 整行点开详情，行本身在 Tab 序里；词仍是一个真链接，
										 * 中键、右键、新标签页照常，所以它不单独占一个 Tab 位。
										 */}
										<TableCell cellSlot="title" className="whitespace-nowrap">
											<TextLink render={<Link {...detail} />} tabIndex={-1}>
												{e.canonical}
											</TextLink>
										</TableCell>
										<TableCell
											cellLabel="人数"
											className="whitespace-nowrap text-end tabular-nums"
										>
											{e.people}
										</TableCell>
										<TableCell
											cellLabel="属于"
											className="whitespace-nowrap text-fg-secondary"
										>
											{e.parent ?? "—"}
										</TableCell>
										{/*
										 * 往上一列、往下一列：「属于」说它归在哪个更宽的词底下，
										 * 「细分」说有几项更细的词归在它底下。细分给的是项数不是
										 * 词——多的一个词底下有二十几项，列出来这一格比整行都高，
										 * 而扫表时要知道的只是「这个词有没有下一层」。具体是哪几项
										 * 在点开的那一层里。
										 */}
										<TableCell
											cellLabel="细分"
											className="whitespace-nowrap text-end text-fg-secondary tabular-nums"
										>
											{e.children || "—"}
										</TableCell>
										<TableCell
											cellLabel="其他写法"
											className="text-fg-secondary"
										>
											{e.aliases.length ? e.aliases.join("、") : "—"}
										</TableCell>
										<TableCell
											cellLabel="上次更新"
											className="whitespace-nowrap text-end text-fg-secondary tabular-nums"
										>
											{daysAgo(e.reviewedDaysAgo)}
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
