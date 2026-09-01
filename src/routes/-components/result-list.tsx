import { Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";
import { Skeleton } from "#/components/ui/skeleton";
import { cn } from "#/lib/utils";
import { bestHitPerTerm } from "#/search/evidence";
import { activeChips, type Chip } from "#/search/parse";
import type { SearchResult, TermPlan } from "#/search/result";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";
import { emptyState } from "../-lib/empty-state";
import type { View } from "../-lib/view-params";
import { EvidenceLine } from "./evidence";

/**
 * 一块卡片的形状。骨架屏、候选人、（将来的）任何一种条目共用一份——
 * 分开写会让加载完成的那一帧里块高、圆角或内边距差那么一点，
 * 表现就是整列在数据到达时抖一下。
 */
const CARD =
	"relative rounded-xl border border-border/60 bg-card px-4 py-3.5 shadow-xs";

/**
 * 骨架屏的块数：首次检索用它，之后跟着上一次的结果数走（上限一页）。
 *
 * 固定块数的代价是每换一次查询列表的高度都要跳一次，而页面高度跳变是
 * 「这东西还没做完」最廉价的信号。跟着上一次走则是一个合理的先验：
 * 连着改条件时结果数量级相近。
 */
const SKELETON_ROWS = 5;

/**
 * 候选人名单。
 *
 * 一个人一块，不是一行。表格的前提是**同一列的值可以竖着比**，而这里每一列
 * 要比的是「他的『项目管理』经历」——那不是一个数，是一段带来源、带时长、
 * 带上下文的证据，压不进一个格子；压进去就只剩一颗点，「凭什么算命中」
 * 于是必须点进详情才知道。
 *
 * 卡片把这件事反过来：一个条件一行，命中的字段值当场写出来。竖着比的能力
 * 没有因此丢掉——所有卡片的证据行位置严格对齐（点、条件词、时长三处横坐标
 * 相同），眼睛照样能沿一条竖线往下扫，只是那条线上现在写着凭据。
 */
export function ResultList({
	results,
	terms,
	empId,
	loading,
	total,
	canMore,
	growing,
	onMore,
	withoutStrong,
	chips,
	tooWide,
	turnId,
	view,
	onChange,
	onReviseQuery,
	onFocusQuery,
}: {
	results: SearchResult[];
	terms: TermPlan[];
	empId: string | undefined;
	loading: boolean;
	/** 命中的总人数，翻页之前。列表里最多只有已经翻出来的那些。 */
	total: number;
	/** 还翻得动吗。翻不动的原因有两种（看完了 / 到上限了），文案在页脚分。 */
	canMore: boolean;
	/** 正在翻下一页：已经看到的人留在原地，只有按钮转圈 */
	growing: boolean;
	onMore: () => void;
	/** 关掉「匹配来源」之后能看到多少人。空态要给出的那条路走不走得通，全看它。 */
	withoutStrong: number;
	/** 这条查询记录上的条件。骨架屏的行数由它算，不等服务端。 */
	chips: Chip[];
	/** 词太宽，命中的经历段超过了上限：有词、没有结果，走空态的引导。 */
	tooWide: boolean;
	turnId: string;
	view: View;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Chip[]) => void;
	onFocusQuery: () => void;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	// 上一次真正画出来的块数，见 SKELETON_ROWS。写在 effect 里而不是渲染中，
	// 渲染要保持纯：同一份 props 渲染两遍必须得到同一棵树。
	const lastRows = useRef(SKELETON_ROWS);
	useEffect(() => {
		if (!loading && results.length > 0) lastRows.current = results.length;
	}, [loading, results.length]);

	// 检索中绝不闪现「没有结果」。
	if (loading) {
		const pending = pendingTerms(chips);
		return (
			<div className="flex flex-col gap-2">
				{Array.from(
					{ length: Math.min(lastRows.current, RESULT_PAGE) },
					(_, row) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 骨架块没有身份
						<div className={cn(CARD, "border-border")} key={row}>
							<div className="flex items-center gap-3">
								<Skeleton className="h-4 w-24" />
								<Skeleton className="h-3 w-44" />
							</div>
							{/* 骨架屏画的是**这次查询会有几条证据**，不是一个通用的方块堆：
							    条件数取自记录上的 chips，所以加载完成时块高不变。 */}
							{pending.length > 0 && (
								<div className="mt-3 space-y-2 border-border/60 border-t pt-3">
									{pending.map((t) => (
										<div className="flex items-center gap-2.5" key={t.term}>
											<Skeleton className="size-2 rounded-full" />
											<Skeleton className="h-3 w-16" />
											<Skeleton className="h-3 flex-1" />
										</div>
									))}
								</div>
							)}
						</div>
					),
				)}
			</div>
		);
	}

	if (results.length === 0) {
		// 空态永远给一条出路，而且是能一键走的那条——不是让人自己回去猜该改哪。
		const state = emptyState({
			terms,
			chips,
			tooWide,
			withoutStrong,
			view,
			onChange,
			onReviseQuery,
			onFocusQuery,
		});
		return (
			<Empty className="rounded-xl border border-border border-dashed">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SearchXIcon />
					</EmptyMedia>
					<EmptyTitle>{state.title}</EmptyTitle>
					<EmptyDescription>{state.hint}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button onClick={state.action.onClick} variant="outline">
						{state.action.label}
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	return (
		<div className="relative" ref={boxRef}>
			<SelectionRail boxRef={boxRef} empId={empId} rows={results.length} />
			<ul className="flex flex-col gap-2">
				{results.map((r, rank) => {
					const selected = r.employee.empId === empId;
					const best = bestHitPerTerm(r.hits, terms);
					return (
						<li
							className={cn(
								CARD,
								"transition-[box-shadow,border-color]",
								// ↑↓ 换人时 scrollIntoView 把卡片推到视口边缘上，留一点余量。
								// 查询台是吸顶的，所以上边的余量得比它高——否则「选中的
								// 那一块」会正好停在半透明的吸顶层底下。
								"scroll-mt-40 scroll-mb-4",
								selected
									? // 选中态是**升起来**，不只是变个底色。详情面板此刻正从
										// 右边推进来，两者说的是同一件事：这一块被拎出来了。
										// 蓝调环保持不变——绿在这套设计里只表达「受控字段命中」。
										"border-info/40 shadow-lift ring-1 ring-info/30"
									: "[@media(hover:hover)]:hover:border-border [@media(hover:hover)]:hover:shadow-lift",
							)}
							data-emp={r.employee.empId}
							key={r.employee.empId}
						>
							<div className="flex items-baseline gap-2.5">
								{/*
								 * 名次。不写出来的话，一列卡片看起来就是一堆无序的块，
								 * 而它是排过序的——「从上往下看」这个动作有没有意义
								 * 全靠这个顺序。详情面板里那句「第 N 位」是同一个数。
								 *
								 * 定宽右对齐，所以两位数和一位数的姓名仍然对齐在同一条竖线上；
								 * 等宽数字，所以竖着扫下来数字不跳。
								 */}
								<span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
									{rank + 1}
								</span>
								<Link
									aria-current={selected ? "page" : undefined}
									/*
									 * 整块可点，靠的是这条链接自己铺开的一层伪元素，
									 * 不是挂在 `<li>` 上的 onClick。
									 *
									 * 差别不在写法，在于**得到的是不是一个真链接**：铺开之后
									 * 中键开新标签、右键复制地址、Tab 走到它、回车打开全都成立，
									 * 而 `<li onClick>` 一样都没有——那是一个只认鼠标左键的
									 * 假按钮，键盘用户只能靠 ↑↓ 那套快捷键绕过去。
									 *
									 * replace：点一块是「看哪一个」，不是一次导航。扫过三十个人
									 * 不该在历史栈里压三十条，否则后退键就废了。
									 */
									className="title-2 shrink-0 truncate rounded-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:underline"
									params={{ turnId, empId: r.employee.empId }}
									replace
									search={(prev) => prev}
									to="/s/$turnId/p/$empId"
								>
									{r.employee.name}
								</Link>
								<span className="min-w-0 truncate text-muted-foreground text-sm">
									{r.employee.curDept} · {r.employee.curTitle}
									{r.employee.curLevel && ` · ${r.employee.curLevel}`}
								</span>
							</div>

							{/*
							 * 证据。**每个条件都出现一行，顺序恒定**，命中与否都画。
							 *
							 * 这是把表格旋转成块之后还能上下比对的全部依据：所有人的
							 * 第 n 行说的都是同一个条件，点、条件词、时长三处的横向位置
							 * 也都一样。只画命中的那些会让每一块的行数各不相同，于是
							 * 「谁的『项目管理』最硬」这个问题又得一块一块地找。
							 *
							 * 和上面那一行之间隔一条线：卡片的头说「这是谁」，身子说
							 * 「凭什么是他」，两件事。没有线的话六七行长短不一的文本
							 * 糊成一片，姓名也就不再是这一块的入口了。
							 */}
							{terms.length > 0 && (
								<div className="mt-3 space-y-1.5 border-border/60 border-t pt-3">
									{terms.map((t, i) => (
										<EvidenceLine
											basis={r.basis[i]}
											boost={t.mode === "boost"}
											hit={best[i]}
											key={t.term}
											term={t.effective}
										/>
									))}
								</div>
							)}
						</li>
					);
				})}
			</ul>

			{total > RESULT_PAGE && (
				/*
				 * 列表的结尾必须回答一个问题：**我看完了吗**。
				 *
				 * 读者必须能分辨「这就是全部」和「后面还有更多」。所以这里永远同时
				 * 说出两个数（已显示、共）。排序依据不在这里说——它常驻在查询台上，
				 * 只在超过一页时才写一遍等于说：五十人以内的列表不必知道自己是按
				 * 什么排的。
				 *
				 * 翻不动的时候不留一个按不动的按钮，改说原因——「看完了」和
				 * 「到上限了」是两件事，后者要给出路（收窄查询），前者不必。
				 */
				<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-6">
					<span className="text-muted-foreground text-xs">
						已显示 <b className="tabular-nums">{results.length}</b> 人{"，共 "}
						<b className="tabular-nums">{total}</b> 人
					</span>
					{canMore ? (
						<Button
							loading={growing}
							onClick={onMore}
							size="sm"
							variant="outline"
						>
							再加载 {RESULT_PAGE} 人
						</Button>
					) : (
						<span className="text-muted-foreground text-xs">
							{total > RESULT_MAX
								? `已达到 ${RESULT_MAX} 人的显示上限，请添加条件或筛选以缩小范围。`
								: "已显示全部结果。"}
						</span>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * 选中轨：签名微交互的一半。
 *
 * 按住 ↓ 连着换人时，如果选中态只是「这一块升起、那一块落下」，眼睛拿不到
 * 方向，十几块之后就不知道自己在哪了。一根**同一个 DOM 节点**、只改位置的
 * 竖轨解决这件事：它从上一个人滑到下一个人，方向和距离都是看得见的。
 * 另一半在详情面板（styles.css 的 settle）。
 *
 * 它住在卡片外面那条 16px 的空白里，不贴着卡片边——贴上去就会和卡片自己的
 * 圆角边框叠在一起，读起来像某一块的边框莫名其妙地粗了一段。
 *
 * 量位置而不是算位置：块高取决于中文断行、条件个数和字体回落，算出来的值
 * 迟早对不上。正因为是量出来的，尺寸一变就得重量：改窗宽会让字段值重新断行，
 * 块高跟着变，所以还挂了一个 ResizeObserver。
 * 用 useEffect 而不是 useLayoutEffect 是故意的——晚一帧正好让 transition
 * 有起点可动，而且避开了服务端渲染时 useLayoutEffect 的告警。
 *
 * 150ms 是上限：连按 ↑↓ 的间隔大约就是这个数，再长动画就会排队，手感变粘。
 */
function SelectionRail({
	boxRef,
	empId,
	rows,
}: {
	boxRef: React.RefObject<HTMLDivElement | null>;
	empId: string | undefined;
	/** 结果集换了要重新量：同一个 empId 在新结果里的位置不一样 */
	rows: number;
}) {
	const [at, setAt] = useState<{ top: number; height: number } | null>(null);

	useEffect(() => {
		// rows 参与判断也参与依赖：同一个 empId 在换了结果集之后位置不一样
		// （比如放宽了匹配来源，前面多插进来十个人），不跟着它重量一次，
		// 轨会停在旧块的位置上。
		if (!empId || rows === 0) return setAt(null);
		const box = boxRef.current;
		const measure = () => {
			const row = box?.querySelector<HTMLElement>(
				`[data-emp="${CSS.escape(empId)}"]`,
			);
			setAt(row ? { top: row.offsetTop, height: row.offsetHeight } : null);
		};
		measure();
		if (!box) return;
		const ro = new ResizeObserver(measure);
		ro.observe(box);
		return () => ro.disconnect();
	}, [empId, rows, boxRef]);

	return (
		<span
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute -left-2 w-0.5 rounded-full bg-info",
				"transition-[top,height,opacity] duration-150 ease-out",
				at ? "opacity-100" : "opacity-0",
			)}
			style={{ top: at?.top ?? 0, height: at?.height ?? 0 }}
		/>
	);
}

/**
 * 这次查询要画哪几条证据。
 *
 * 取自查询记录上的 chips，不等服务端返回 `terms`：改筛选那一帧服务端还是
 * 旧值，骨架屏的块高会先跳一下再回来。这里给的是未经语料松弛的原词
 * （`effective` 先等于 `term`），而松弛只改文案不改条数。
 *
 * 排除词和停用的词都不占一行：前者不产出证据，后者根本不参与这次检索，
 * 那一行里都没有任何东西可画。
 */
function pendingTerms(chips: Chip[]): TermPlan[] {
	return activeChips(chips).flatMap((c) =>
		c.mode === "exclude"
			? []
			: [{ term: c.term, effective: c.term, mode: c.mode }],
	);
}
