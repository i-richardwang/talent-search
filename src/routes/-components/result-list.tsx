import { Button, cn, Empty, SkeletonLine, Table } from "@cloudflare/kumo";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { bestHitPerTerm } from "#/search/evidence";
import { activeChips, type Chip } from "#/search/parse";
import type { SearchResult, TermPlan } from "#/search/result";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";
import { emptyState } from "../-lib/empty-state";
import type { View } from "../-lib/view-params";
import { EvidenceCell } from "./evidence";

/**
 * 列宽（rem）。姓名与概念词定宽，当前岗位在一个区间里弹。
 *
 * 概念词列 6rem 是量出来的，不是估的：格子里是一颗 8px 的点、8px 间隙、
 * 一个右对齐的「前 2.3 年」，两侧各 10px 内边距，14px 正文下最宽的串约 75px，
 * 占 96px 的不到八成。装得下靠的是把时长折成年（lib/format.ts 的 years），
 * 不是更小的字——精确写法余量不到一个汉字，只能靠 truncate 收场，
 * 而省略号是把放不下这件事推给读者。
 * 表头是概念词本身，五个字（70px + 20px 内边距）刚好触到列宽，
 * 再长就 truncate——这是这一列能承受的上限，不是留给它长的余量。
 *
 * 岗位列有上下界，两头都是量出来的：
 *
 * 下界 12rem 是 1280 宽下、**三个概念词**放得下的预算：7.5 + 12 + 3×6 = 37.5rem
 * = 600px，而 xl 上中栏的可用宽是 1280 − 左栏 224 − 详情栏 416
 * − 面板的 24px 外边距与 2px 边框 = 614px，正好容得下。第四个词起（超过 614）
 * 中栏开始横滚，这是接受的代价——按词数改列宽会让同一列在
 * 不同查询下宽度不同，而横向比对靠的正是列宽稳定。低于下界就该横滚而不是继续挤。
 * 上界 22rem 是「区域安全 · 安全与风险合规负责人 · M5」这类最长串的长度，
 * 14px 正文下约 25 个汉字。**不封顶它会吃掉全部富余**：2560 宽的屏上中栏有
 * 1856px，姓名和概念词占掉 408，剩下 1448 全归这一格，而那串字最多用 340。
 * 于是屏幕越宽，姓名和右边的证据点之间的空白河越宽——横向扫这张表
 * （「这五十个人里谁的『项目管理』是受控命中」）正是这个界面的主任务，
 * 表格因为变宽而变得难读不是审美问题。
 *
 * 封顶的富余**不留在中栏里**：中栏自己按 `mainBasis` 封同一个顶，多出来的
 * 宽度全部让给详情栏（见 route.tsx）。富余留在栏里读起来不是「表格到此为止」，
 * 是一张贴着左边、右边空着一两百像素的表，连滚动条都画在那片空白的最外侧。
 * 所以表格在中栏里是 `w-full`：中栏有多宽它就有多宽，表头那条线、结果头
 * 那条线、行的 hover 底色于是全都一样长。
 */
const COL_WIDTH = {
	name: 7.5,
	positionMin: 12,
	positionMax: 22,
	term: 6,
} as const;

/** 概念词列之外的固定列：姓名、当前岗位 */
const FIXED_COLUMNS = 2;

/**
 * 中栏的宽度预算（rem）：岗位列吃满 22rem 时整张表有多宽。
 *
 * 它是 `<main>` 的 flex-basis，不是 `max-width`——basis 让中栏在**不够宽**时
 * 照常收缩（xl 上 614px，表格自己横滚），在**有富余**时不再长，富余归详情栏。
 * 换成 max-width，中栏会先长满再在自己内部空出来，富余就烂在栏里。
 */
export function mainBasis(termCount: number) {
	return `${COL_WIDTH.name + COL_WIDTH.positionMax + termCount * COL_WIDTH.term}rem`;
}

/**
 * 骨架屏的行数：首次检索用它，之后跟着上一次的结果数走（上限一页）。
 *
 * 固定 16 行的代价是每换一次查询表格的高度都要跳一次——16 行不出滚动条，
 * 50 行出，于是滚动条在每次检索时闪现一遍，而页面高度跳变是「这东西还没做完」
 * 最廉价的信号。跟着上一次走则是一个合理的先验：连着改条件时结果数量级相近。
 */
const SKELETON_ROWS = 16;

/**
 * 单元格内边距。首末列对齐到全局 16px 水平轴，让表格的左边缘和左栏、
 * 顶栏、详情栏连成一条线；中间列保持 10px，那是「密集档案感」的行距，
 * 也是概念词列宽算得刚好的前提（见 COL_WIDTH）——把它一起放宽会让五个字
 * 的表头立刻 truncate。密度留在数据行内部，界面骨架不参与。
 *
 * 纵向 8px 配 14px 正文（行高 1.5，21px）得到 37px 的行：够手指点、够眼睛
 * 分行，又还在密集表格的量级里。表头给到 10px，得到 36px——它是这张表的
 * 标签行，比数据行矮一点点等于没有分层；36px 正好是下面 `scroll-mt-9`
 * 那个数，↑↓ 换人时行才不会被推到吸顶表头底下。
 *
 * 页脚那一行里坐着一个按钮，12px 才不至于让按钮顶着两条边。
 */
const CELL_PADDING = cn(
	"[&_td]:px-2.5 [&_td]:py-2.5 [&_th]:px-2.5 [&_th]:py-2.5",
	"[&_tfoot_td]:py-3",
	"[&_td:first-child]:pl-4 [&_th:first-child]:pl-4",
	"[&_td:last-child]:pr-4 [&_th:last-child]:pr-4",
);

/**
 * 行分隔线。Kumo 的表格只在表头底下画一条，行与行之间什么都没有——而斑马纹
 * 在这里是关掉的（见下面 Table.Row 那条注释），两样都不给的话，五十行就是一片
 * 没有横向结构的灰，眼睛锁不住自己正在读第几行。
 *
 * 用 hairline 而不是 line：这条线的活是「分行」，不是「画格子」。最后一行不画，
 * 那条线改由页脚自己的上边框来画——有页脚时它把「数据到此为止」说清楚，
 * 没有页脚时列表就干净地收在最后一行，两种情况都不会出现两条并排的线。
 *
 * 线挂在 `td` 上而不是 `tr` 上：`border-collapse: separate` 下 `tr` 的边框
 * 根本不绘制。Tailwind 的 preflight 确实把表格设成了 collapse，但那是这张表
 * 之外的一个前提——挂在单元格上两种模式都成立，不必依赖它。
 */
const ROW_RULE = cn(
	"[&_tbody_td]:border-kumo-hairline [&_tbody_td]:border-b",
	"[&_tbody_tr:last-child_td]:border-b-0",
	"[&_tfoot_td]:border-kumo-hairline [&_tfoot_td]:border-t",
);

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
	/** 命中的总人数，翻页之前。表格里最多只有已经翻出来的那些。 */
	total: number;
	/** 还翻得动吗。翻不动的原因有两种（看完了 / 到上限了），文案在页脚分。 */
	canMore: boolean;
	/** 正在翻下一页：已经看到的人留在原地，只有按钮转圈 */
	growing: boolean;
	onMore: () => void;
	/** 关掉「匹配来源」之后能看到多少人。空态要给出的那条路走不走得通，全看它。 */
	withoutStrong: number;
	/** 这条查询记录上的条件。骨架屏的列数由它算，不等服务端。 */
	chips: Chip[];
	/** 词太宽，命中的经历段超过了上限：有词、没有结果，走空态的引导。 */
	tooWide: boolean;
	turnId: string;
	view: View;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Chip[]) => void;
	onFocusQuery: () => void;
}) {
	const navigate = useNavigate();
	const boxRef = useRef<HTMLDivElement>(null);
	// 上一次真正画出来的行数，见 SKELETON_ROWS。写在 effect 里而不是渲染中，
	// 渲染要保持纯：同一份 props 渲染两遍必须得到同一棵树。
	const lastRows = useRef(SKELETON_ROWS);
	useEffect(() => {
		if (!loading && results.length > 0) lastRows.current = results.length;
	}, [loading, results.length]);

	// 检索中绝不闪现「没有结果」。
	if (loading) {
		const pending = pendingTerms(chips);
		return (
			<TableShell terms={pending}>
				<Table.Body>
					{Array.from(
						{ length: Math.min(lastRows.current, RESULT_PAGE) },
						(_, row) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 骨架行没有身份
							<Table.Row key={row}>
								{Array.from(
									{ length: FIXED_COLUMNS + pending.length },
									(_, col) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: 骨架格同理
										<Table.Cell key={col}>
											<SkeletonLine className="h-3" />
										</Table.Cell>
									),
								)}
							</Table.Row>
						),
					)}
				</Table.Body>
			</TableShell>
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
			<div className="flex justify-center px-4 py-16">
				<Empty
					contents={
						<Button onClick={state.action.onClick} variant="outline">
							{state.action.label}
						</Button>
					}
					description={state.hint}
					icon={<MagnifyingGlassIcon size={36} weight="duotone" />}
					title={state.title}
				/>
			</div>
		);
	}

	return (
		/* 列表末尾留一段：最后一行直接顶到面板底边时，读起来是这张表被切断了，
		   而不是到此为止。16px 和面板的水平轴同宽。 */
		<div className="relative pb-4" ref={boxRef}>
			<SelectionRail boxRef={boxRef} empId={empId} rows={results.length} />
			<TableShell terms={terms}>
				<Table.Body>
					{results.map((r) => {
						const selected = r.employee.empId === empId;
						const best = bestHitPerTerm(r.hits, terms);
						return (
							<Table.Row
								className={cn(
									"cursor-pointer",
									// 表头是吸顶的，↑↓ 换人时 scrollIntoView 会把行推到滚动
									// 容器的上边缘，也就是推到表头**底下**。留出表头的高度，
									// 选中的那一行才真的看得见。36px = 16px 表头 + 上下各 10px。
									"scroll-mt-9",
									// 斑马纹关掉：交替底色只在很宽的表格（12 列以上）里帮得上忙，
									// 这里只有四五列，hover 与选中已经是两套背景，再叠一层就只剩噪声。
									"even:bg-kumo-base",
									!selected &&
										"[@media(hover:hover)]:hover:bg-kumo-fill [@media(hover:hover)]:hover:even:bg-kumo-fill",
									// 蓝调选中态：橙色在这套设计里只表达「受控字段命中」，
									// 不能挪作选中。底色瞬时切换，「移动」那一份由 SelectionRail 负责。
									selected && "bg-kumo-info-tint even:bg-kumo-info-tint",
								)}
								data-emp={r.employee.empId}
								key={r.employee.empId}
								onClick={(e) => {
									// 姓名那一格是真链接（能中键开新标签、能被键盘走到）。
									// 不让它冒泡上来再导航一次：同一个目标跑两遍路由。
									if ((e.target as HTMLElement).closest("a")) return;
									// replace：点行是"看哪一个"，不是一次导航。扫过三十个人
									// 不该在历史栈里压三十条，否则后退键就废了。
									navigate({
										to: "/s/$turnId/p/$empId",
										params: { turnId, empId: r.employee.empId },
										search: (prev) => prev,
										replace: true,
									});
								}}
							>
								<Table.Cell>
									<Link
										aria-current={selected ? "page" : undefined}
										/* 这一列是主体，其余列是它的属性。同为 14px 时只靠
										   「它是个链接」区分不出主次，medium 一档就够——
										   再重就成了标题，而这是五十行里的一行。 */
										className="block min-w-0 truncate rounded-control font-medium text-kumo-default no-underline hover:underline"
										params={{ turnId, empId: r.employee.empId }}
										search={(prev) => prev}
										to="/s/$turnId/p/$empId"
										replace
									>
										{r.employee.name}
									</Link>
								</Table.Cell>
								<Table.Cell>
									<span className="block truncate text-kumo-subtle">
										{r.employee.curDept} · {r.employee.curTitle}
										{r.employee.curLevel && ` · ${r.employee.curLevel}`}
									</span>
								</Table.Cell>
								{terms.map((t, i) => (
									<Table.Cell key={t.term}>
										<EvidenceCell basis={r.basis[i]} hit={best[i]} />
									</Table.Cell>
								))}
							</Table.Row>
						);
					})}
				</Table.Body>
				{total > RESULT_PAGE && (
					/*
					 * 表格的结尾必须回答一个问题：**我看完了吗**。
					 *
					 * 读者必须能分辨「这就是全部」和「后面还有更多」。所以这里永远同时
					 * 说出两个数（已显示、共）。排序依据不在这里说——它常驻在结果头上
					 * （result-head.tsx），只在超过一页时才写一遍等于说：五十人以内的
					 * 列表不必知道自己是按什么排的。
					 *
					 * 翻不动的时候不留一个按不动的按钮，改说原因——「看完了」和
					 * 「到上限了」是两件事，后者要给出路（收窄查询），前者不必。
					 */
					<Table.Footer>
						<Table.Row>
							<Table.Cell colSpan={FIXED_COLUMNS + terms.length}>
								<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
									<span className="text-kumo-subtle text-xs">
										已显示 <b className="tabular-nums">{results.length}</b> 人
										{"，共 "}
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
										<span className="text-kumo-subtle text-xs">
											{total > RESULT_MAX
												? `已达到 ${RESULT_MAX} 人的显示上限，请添加条件或筛选以缩小范围。`
												: "已显示全部结果。"}
										</span>
									)}
								</div>
							</Table.Cell>
						</Table.Row>
					</Table.Footer>
				)}
			</TableShell>
		</div>
	);
}

/**
 * 选中轨：签名微交互的一半。
 *
 * 按住 ↓ 连着换人时，如果选中态只是「这一行变蓝、那一行变白」，眼睛拿不到
 * 方向，十几行之后就不知道自己在哪了。一根**同一个 DOM 节点**、只改位置的
 * 竖轨解决这件事：它从上一个人滑到下一个人，方向和距离都是看得见的。
 * 另一半在详情栏（styles.css 的 settle）。
 *
 * 量位置而不是算位置：行高取决于中文断行和字体回落，算出来的值迟早对不上。
 * 正因为是量出来的，尺寸一变就得重量：改窗宽会让岗位列变宽、中文重新断行，
 * 行高跟着变，所以还挂了一个 ResizeObserver。
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
		// 轨会停在旧行的位置上。
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
				"pointer-events-none absolute left-0 w-0.5 bg-kumo-info",
				"transition-[top,height,opacity] duration-150 ease-out",
				at ? "opacity-100" : "opacity-0",
			)}
			style={{ top: at?.top ?? 0, height: at?.height ?? 0 }}
		/>
	);
}

/**
 * 列几何（colgroup + min-width）与表头。骨架屏和真实结果共用同一个外壳，
 * 所以加载完成时列宽、表头、水平滚动阈值都不会变——不存在"加载完跳一下"。
 */
function TableShell({
	terms,
	children,
}: {
	terms: TermPlan[];
	children: React.ReactNode;
}) {
	// 窄到这个宽度就横向滚，不让概念词列被压成读不出来的宽度
	const minWidth = `${COL_WIDTH.name + COL_WIDTH.positionMin + terms.length * COL_WIDTH.term}rem`;

	// 不封顶：中栏已经按 mainBasis 封过同一个顶，这里再封一次就是把富余
	// 留在中栏内部，变成表格右边那片对不齐的空白。
	return (
		<Table
			className={cn("w-full text-base", CELL_PADDING, ROW_RULE)}
			layout="fixed"
			style={{ minWidth }}
		>
			<colgroup>
				<col style={{ width: `${COL_WIDTH.name}rem` }} />
				<col />
				{terms.map((t) => (
					<col key={t.term} style={{ width: `${COL_WIDTH.term}rem` }} />
				))}
			</colgroup>
			{/*
			 * 表头吸顶。z 值取自 styles.css 里那份三档尺度，不另发明数字。
			 *
			 * 12px 次要色：表头是标签，正文是内容，两者必须不同重。全站都用同一档
			 * 字号时没有层次可言——眼睛在任何一屏上都找不到落点，整屏读起来是一张
			 * 灰网。这里和正文差两档（12 / 14）是让这张表可扫的最低代价。
			 *
			 * 只改字号和颜色，不碰字重：Kumo 在 `<table>` 上挂了 `[&_th]:font-semibold`，
			 * 和这里写的 `[&_th]:font-*` 特异性相同，胜负只由 CSS 顺序定——semibold
			 * 排在后面，写什么都是无效类。而 12px 的汉字上字重差异本来就几乎不可见
			 * （左栏组标题那条注释同理），层次由字号和颜色扛得住，不必去争。
			 */}
			<Table.Header className="[&_th]:sticky [&_th]:top-0 [&_th]:z-stick [&_th]:text-kumo-subtle [&_th]:text-xs">
				<Table.Row>
					<Table.Head>姓名</Table.Head>
					<Table.Head>当前任职</Table.Head>
					{terms.map((t) => (
						<Table.Head
							key={t.term}
							title={
								t.term === t.effective
									? undefined
									: `未找到「${t.term}」的直接匹配，当前按「${t.effective}」搜索`
							}
						>
							{/*
							 * 加分词的表头带一个 `+`，和查询条上那枚 chip 用同一个符号。
							 * 不带符号的就是必须词——默认不该有标记，否则一排记号会让人
							 * 以为那是要读的内容。强度不靠颜色区分：色相在这套界面里已经
							 * 各有其主（橙 = 受控命中、蓝 = 选中、黄 = 退子串）。
							 */}
							<span className="block truncate">
								{t.mode === "boost" && (
									<span className="font-mono text-kumo-subtle">+</span>
								)}
								{t.effective}
							</span>
						</Table.Head>
					))}
				</Table.Row>
			</Table.Header>
			{children}
		</Table>
	);
}

/**
 * 这次查询要占哪几列。
 *
 * 取自查询记录上的 chips，不等服务端返回 `terms`：改筛选那一帧服务端还是
 * 旧值，中栏的宽度会先跳一下再回来。这里给的是未经语料松弛的原词
 * （`effective` 先等于 `term`），而松弛只改文案不改列数——列几何因此完全稳定。
 *
 * 排除词和停用的词都不占列：前者不产出证据，后者根本不参与这次检索，
 * 格子里都没有任何东西可画。
 */
export function pendingTerms(chips: Chip[]): TermPlan[] {
	return activeChips(chips).flatMap((c) =>
		c.mode === "exclude"
			? []
			: [{ term: c.term, effective: c.term, mode: c.mode }],
	);
}
