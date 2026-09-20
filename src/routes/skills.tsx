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
import { skillTable } from "#/server/functions";
import { AdminPage } from "./-components/admin-page";
import { PageNav } from "./-components/page-nav";
import { pageOf } from "./-lib/paging";

/**
 * 技能词表的管理页：哪些写法认成了同一个词、哪个词属于哪个更宽的词。
 * 点一个词看它的释义和上下从属（`/skills/$word`）。
 *
 * 只读。整理是后台每天自动做的（`src/corpus/vocabulary.ts`），这一页存在的理由是让管理员
 * 看得见它在做什么——筛选栏「入职前技能」上一个词后面的人数，是几种写法加上它下面
 * 的词一起数的，这里能看到是哪几种、下面有谁。没有改的入口：改了下一轮灌库就被盖回去，
 * 一个会被静默撤销的编辑框比没有更糟。想改结论走判定那条路（外部判定方提交），不走这一页。
 *
 * 谁判的、队列里还有几组待判都不上屏：前者是库里的留痕（`skill_term.judge`），排查时查库；
 * 后者是整理任务自己的事，过程在任务台那张卡片的运行记录里。这一页只答「词表认了什么」，
 * 没有第二句话。
 *
 * 找词和翻页都在服务端做，和数据页同一个形状：词表是一千多行，全发到页面是三兆多的
 * HTML，而只在当前页里过滤的搜索框会给出错的总数。词和页码在地址里，所以某一页、
 * 某一次搜索可以直接发给别人。
 */
export const Route = createFileRoute("/skills")({
	validateSearch: (search: Record<string, unknown>) => ({
		q: typeof search.q === "string" ? search.q : "",
		page: pageOf(search.page),
	}),
	loaderDeps: ({ search }) => ({ page: search.page, q: search.q }),
	loader: ({ deps }) => skillTable({ data: { page: deps.page, q: deps.q } }),
	head: () => ({ meta: [{ title: "技能 · 人才搜索" }] }),
	component: Skills,
});

/** 一个链接指向的这一页。页码和词总是一起走：换了词，页码就不是同一批词了。 */
function at(page: number, q: string) {
	return { page: page > 1 ? page : undefined, q };
}

function daysAgo(days: number) {
	return days === 0 ? "今天" : `${days} 天前`;
}

function Skills() {
	const table = Route.useLoaderData();
	const { q } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [needle, setNeedle] = useState(q);
	// 开着的是哪一个词。它是子路由的参数，所以宽松地取——没开详情时就是 undefined。
	const { word } = useParams({ strict: false });

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
		<AdminPage title="技能">
			<div className="flex flex-col gap-3">
				<form
					onSubmit={(event) => {
						event.preventDefault();
						// 换词就回到第一页：上一次翻到的第 7 页在新的结果里不是同一批词
						void navigate({ search: at(1, needle.trim()) });
					}}
				>
					<InputGroup className="max-w-96">
						<InputGroupAddon>
							<SearchIcon />
						</InputGroupAddon>
						<InputGroupInput
							aria-label="搜索技能"
							onChange={(event) => setNeedle(event.target.value)}
							placeholder="搜索技能、写法或所属的词"
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
				{table.rows.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>{q ? "没有匹配的技能" : "还没有技能"}</EmptyTitle>
							{/* 没匹配上的时候标题已经把话说完了；只有词表本身是空的，才需要说该怎么办 */}
							{!q && (
								<EmptyDescription>
									经历处理完成后，这里会列出技能及相关写法。
								</EmptyDescription>
							)}
						</EmptyHeader>
					</Empty>
				) : (
					<CardFrame>
						<Table variant="card">
							<TableHeader>
								<TableRow>
									<TableHead>技能</TableHead>
									<TableHead className="text-end">人数</TableHead>
									<TableHead>属于</TableHead>
									<TableHead className="text-end">细分</TableHead>
									<TableHead>其他写法</TableHead>
									<TableHead className="text-end">上次更新</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{table.rows.map((e) => (
									<TableRow
										data-state={e.canonical === word ? "selected" : undefined}
										key={e.canonical}
									>
										{/*
										 * 通往详情的是词本身，一个普通的文字链接。表里不做铺满整行
										 * 的覆盖层：`<a>` 包不住 `<tr>`，而用绝对定位去补这个缺口
										 * 得让 `tr` 当包含块，那件事表格行做不到（覆盖层会落到
										 * `tbody`，每一行都铺满整张表）。名单那边整块可点，因为
										 * 那是卡片（`result-list.tsx`）——形状不同，读法就不同。
										 */}
										<TableCell className="font-medium">
											<Link
												className="underline-offset-4 hover:underline"
												params={{ word: e.canonical }}
												search={at(table.page, q)}
												to="/skills/$word"
											>
												{e.canonical}
											</Link>
										</TableCell>
										<TableCell className="text-end tabular-nums">
											{e.people}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{e.parent ?? "—"}
										</TableCell>
										{/*
										 * 往上一列、往下一列：「属于」说它归在哪个更宽的词底下，
										 * 「细分」说有几项更细的词归在它底下。细分给的是项数不是
										 * 词——多的一个词底下有二十几项，列出来这一格比整行都高，
										 * 而扫表时要知道的只是「这个词有没有下一层」。具体是哪几项
										 * 在点开的那一层里。
										 */}
										<TableCell className="text-end text-muted-foreground tabular-nums">
											{e.children || "—"}
										</TableCell>
										{/* 这一格允许换行：一个词并进十来种写法是常事，截断就看不到了 */}
										<TableCell className="whitespace-normal text-muted-foreground">
											{e.aliases.length ? e.aliases.join("、") : "—"}
										</TableCell>
										<TableCell className="text-end text-muted-foreground tabular-nums">
											{daysAgo(e.reviewedDaysAgo)}
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
						{/*
						 * 表脚说这张表和全部的关系，排法照数据页那张表。单位是「项」不是
						 * 「人」：这里一行是一个词，而每一行右边那个数才是人。
						 */}
						<CardFrameFooter className="flex items-center justify-between gap-2 p-2">
							<p className="whitespace-nowrap text-muted-foreground text-sm">
								{table.pages > 1 && (
									<>
										第 {table.from}–{table.from + table.rows.length - 1} 项，共{" "}
									</>
								)}
								<strong className="font-medium text-foreground">
									{table.total}
								</strong>{" "}
								项
							</p>
							<PageNav
								linkTo={(page) => <Link search={at(page, q)} to="/skills" />}
								page={table.page}
								pages={table.pages}
							/>
						</CardFrameFooter>
					</CardFrame>
				)}
			</div>
			{/* 点开的那个词从右侧覆盖（`skills.$word.tsx`），表在底下保持原样 */}
			<Outlet />
		</AdminPage>
	);
}
