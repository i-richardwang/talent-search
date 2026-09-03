import { Link } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import {
	Dot,
	EvidenceLine,
	MissedTerms,
	StrengthLegend,
} from "#/components/evidence";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";
import { Separator } from "#/components/ui/separator";
import { Skeleton } from "#/components/ui/skeleton";
import { Toggle } from "#/components/ui/toggle";
import { cn } from "#/lib/utils";
import { bestHitPerTerm } from "#/search/evidence";
import { activeChips, type Chip } from "#/search/parse";
import type {
	RankedResult,
	SearchOutcome,
	SearchResult,
	TermPlan,
} from "#/search/result";
import { type SearchSpec, unsupportedOf } from "#/search/spec";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";
import { emptyState } from "../-lib/empty-state";
import type { View } from "../-lib/view-params";

/** 一块卡片的内边距。骨架屏和候选人共用，加载完成的那一帧才不会抖。 */
const PAD = "px-4 py-3.5";

/** 首次检索的骨架块数。之后跟着上一次的结果数走，列表高度就不会每次跳。 */
const SKELETON_ROWS = 5;
const EMPTY_RESULTS: SearchResult[] = [];
const EMPTY_TERMS: TermPlan[] = [];

function isRanked(result: SearchResult): result is RankedResult {
	return "score" in result;
}

/**
 * 名单的表头：这份名单有多少人、按什么排、那三颗点各是什么意思，以及要不要
 * 只留任职记录能证明的那些人。
 *
 * 四样都是**关于这份名单**的，所以它们跟着名单走。放进查询台的角落，报数就会
 * 随着 chips 换行上下漂，而它回答的本来也不是「我搜了什么」。
 *
 * 图例必须和它解释的那些点同屏，所以只能排在这里；而那个开关要求的正是图例里
 * 第一颗点，两者挨着放，开关就不必再解释一遍自己是什么意思。
 *
 * 它只在有名单可介绍的时候出现，而那个判断归调用点——见下面空态那一支。
 */
export function ResultHeader({
	loading,
	order,
	total,
	terms,
	view,
	onChange,
	strongOn,
}: {
	loading: boolean;
	order: "relevance" | "employee";
	total: number;
	terms: TermPlan[];
	view: View;
	onChange: (next: Partial<View>) => void;
	/** 只留受控证据之后还剩多少人 */
	strongOn: number;
}) {
	return (
		<div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
			<p
				aria-live="polite"
				className="text-muted-foreground text-sm"
				role="status"
			>
				{loading ? (
					"搜索中…"
				) : (
					<>
						<b className="text-foreground tabular-nums">{total}</b> 人
						{/* 一份排过序的名单必须说出自己按什么排，否则「从上往下看」
						    这个动作没有依据。 */}
						{order === "relevance" ? " · 按相关度排序" : " · 按工号排序"}
					</>
				)}
			</p>
			{terms.length > 0 && (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
					<StrengthLegend />
					<ProvenOnly n={strongOn} onChange={onChange} view={view} />
				</div>
			)}
		</div>
	);
}

/**
 * 只看任职记录可查的。
 *
 * 四路证据的可信度差得很远（`search/weights.ts`）：序列和岗位是 HR 系统登记的
 * 任职记录，一段一个值、可追溯；部门和公司说的是团队在做什么，不是他本人；
 * 简历原文是本人自述，没有校验——「配合算法团队做过对接」的主语是别人，却照样
 * 会被算成一条「算法」证据。打开这个开关，每一条必须条件都得有受控证据才算数
 * （`search/rank.ts` 的 `complete`）。
 *
 * 名字说的是**留下什么**，不是命中了哪个字段：「序列」是 HR 的字段名，招聘的人
 * 不认得它，而「任职记录能查到」是他每天都在做的那个判断。
 *
 * 它不是一个筛选维度，所以不在左栏里：左栏那几维是「在这批人里再看哪一部分」，
 * 而它改的是**什么才算命中**，和左边那句报数、右边那三颗点是同一件事。
 *
 * 只有开关两态，没有值可选，所以不做成选择器——为一个布尔量弹一层，是多点
 * 一下换零信息。`Toggle` 是这件事的原生形状：按下态由组件自己用 `data-pressed`
 * 表示，不必手写 `aria-pressed` 再自配一套底色。
 */
function ProvenOnly({
	view,
	onChange,
	n,
}: {
	view: View;
	onChange: (next: Partial<View>) => void;
	n: number;
}) {
	const on = Boolean(view.strong);
	// 一个人都数不出来时不给这个开关——点下去必然清空名单，那是一条死路。
	// 左栏那几维是把数到 0 的那一行禁用掉（`filter-rail.tsx`），而这一档是布尔的，
	// 没有行可以禁用，只能整个不出现。
	// 已经打开的永远留着：否则筛到 0 人之后就没有任何东西能关掉它了。
	if (!on && n === 0) return null;
	return (
		<Toggle
			onPressedChange={(next) => onChange({ strong: next || undefined })}
			pressed={on}
			size="sm"
			variant="outline"
		>
			<Dot strength="controlled" />
			<span>只看任职记录可查的</span>
			{!on && <span className="text-muted-foreground tabular-nums">{n}</span>}
		</Toggle>
	);
}

/**
 * 候选人名单。
 *
 * 一个人一块，不是一行。表格的前提是**同一列的值可以竖着比**，而这里每一列
 * 要比的是「他的『项目管理』经历」——那不是一个数，是一段带来源、带时长、
 * 带上下文的证据，压不进一个格子；压进去就只剩一颗点，「凭什么算命中」
 * 于是必须点进详情才知道。
 */
export function ResultList({
	outcome,
	empId,
	loading,
	canMore,
	growing,
	onMore,
	withoutStrong,
	strongOn,
	spec,
	turnId,
	view,
	onChange,
	onReviseQuery,
	onEditQuery,
}: {
	outcome: SearchOutcome | null;
	empId: string | undefined;
	loading: boolean;
	/** 还翻得动吗。翻不动的原因有两种（看完了 / 到上限了），文案在页脚分。 */
	canMore: boolean;
	/** 正在翻下一页：已经看到的人留在原地，只有按钮转圈 */
	growing: boolean;
	onMore: () => void;
	/** 关掉「只看任职记录可查的」之后能看到多少人。空态那条出路走不走得通全看它。 */
	withoutStrong: number;
	/** 打开它之后还剩多少人。表头那个开关关着时报的就是这个数。 */
	strongOn: number;
	/** 这条查询记录上的条件。骨架屏的行数由它算，不等服务端。 */
	spec: SearchSpec;
	turnId: string;
	view: View;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Chip[]) => void;
	onEditQuery: () => void;
}) {
	const results = outcome?.results ?? EMPTY_RESULTS;
	const terms = outcome?.terms ?? EMPTY_TERMS;
	const order = outcome?.order ?? "relevance";
	const total = outcome?.total ?? 0;
	const chips = spec.evidence;
	// 上一次真正画出来的块数，见 SKELETON_ROWS。写在 effect 里而不是渲染中，
	// 渲染要保持纯：同一份 props 渲染两遍必须得到同一棵树。
	const lastRows = useRef(SKELETON_ROWS);
	useEffect(() => {
		if (!loading && results.length > 0) lastRows.current = results.length;
	}, [loading, results.length]);

	const head = (
		<ResultHeader
			loading={loading}
			onChange={onChange}
			order={order}
			strongOn={strongOn}
			terms={terms}
			total={total}
			view={view}
		/>
	);

	// 检索中绝不闪现「没有结果」。
	if (loading) {
		const pending = pendingTerms(chips);
		return (
			<div>
				{head}
				<div className="flex flex-col gap-2">
					{Array.from(
						{ length: Math.min(lastRows.current, RESULT_PAGE) },
						(_, row) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 骨架块没有身份
							<Card className={PAD} key={row}>
								<div className="flex items-center gap-3">
									<Skeleton className="h-4 w-24" />
									<Skeleton className="h-3 w-44" />
								</div>
								{/* 骨架屏画的是**这次查询会有几条证据**，不是一个通用的方块堆：
							    条件数取自记录上的 chips，所以加载完成时块高不变。 */}
								{pending.length > 0 && (
									<>
										<Separator className="my-3" />
										<div className="space-y-2">
											{pending.map((t) => (
												<div className="flex items-center gap-2.5" key={t.term}>
													<Skeleton className="size-2 rounded-full" />
													<Skeleton className="h-3 w-16" />
													<Skeleton className="h-3 flex-1" />
												</div>
											))}
										</div>
									</>
								)}
							</Card>
						),
					)}
				</div>
			</div>
		);
	}

	if (results.length === 0) {
		// 空态永远给一条出路，而且是能一键走的那条——不是让人自己回去猜该改哪。
		const state = emptyState({
			terms,
			chips,
			scope: spec.scope,
			unsupported: unsupportedOf(spec),
			overflow: outcome?.overflow ?? null,
			withoutStrong,
			view,
			onChange,
			onReviseQuery,
			onEditQuery,
		});
		return (
			/* 空态上不报数：一个人都没有这件事下面那句话自己会说，顶上再来一行
			   「0 人」是同一件事的第一遍。所以这一支没有表头。
			   也不给 Empty 补边框——coss 的 Empty 本来就是一块居中的内容，不是一张
			   卡片，手画一圈虚线只是在名单该在的位置上摆一个假的名单形状。 */
			<Empty>
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
		<div>
			{head}
			<ul className="flex flex-col gap-2">
				{results.map((r, rank) => {
					const selected = r.employee.empId === empId;
					const ranked = isRanked(r) ? r : null;
					const best = bestHitPerTerm(ranked?.hits ?? [], terms);
					// 命中的逐条画，没命中的收成一行。「未命中」这三个字重复五遍
					// 没有任何可读的东西，只是把每一块撑高一倍。
					const hits = terms.flatMap((t, i) =>
						best[i]
							? [{ basis: ranked?.basis[i] ?? null, hit: best[i], term: t }]
							: [],
					);
					const missed = terms.filter((_, i) => !best[i]);
					return (
						<Card
							className={cn(
								PAD,
								"transition-[border-color,background-color]",
								// ↑↓ 换人时 scrollIntoView 把卡片推到视口边缘上，留一点余量。
								// 查询台是吸顶的，所以上边的余量得比它高。
								"scroll-mt-40 scroll-mb-4",
								selected
									? // 蓝调环：绿在这套设计里只表达「受控字段命中」。
										"border-info/40 ring-1 ring-info/30"
									: "hoverable:hover:bg-accent/40",
							)}
							/* ↑↓ 换人时靠它把这一块滚进视口（-lib/keyboard-flow.ts） */
							data-emp={r.employee.empId}
							key={r.employee.empId}
							render={<li />}
						>
							<div className="flex items-baseline gap-2.5">
								{/*
								 * 名次。一列卡片本身看不出有序，而它是排过序的，
								 * 「从上往下看」这个动作的意义全靠这个顺序。
								 * 详情面板里那句「第 N 位」是同一个数。
								 */}
								<span className="w-5 shrink-0 text-right text-muted-foreground text-xs tabular-nums">
									{rank + 1}
								</span>
								<Link
									aria-current={selected ? "page" : undefined}
									/*
									 * 整块可点靠这条链接自己铺开的一层伪元素，不是挂在 `<li>` 上的
									 * onClick——那样得到的是只认鼠标左键的假按钮，中键开新标签、
									 * 右键复制地址、Tab 走到它、回车打开一样都不成立。
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
							 * 证据。命中的每条一行，四段固定的槽在所有卡片上位置相同——
							 * 这是把表格旋转成块之后仍然能上下扫的依据，只不过那条竖线上
							 * 现在写着凭据。
							 *
							 * 和上面那一行之间隔一条线：卡片的头说「这是谁」，身子说
							 * 「凭什么是他」，两件事。
							 */}
							{terms.length > 0 && (
								<>
									<Separator className="my-3" />
									<div className="space-y-1.5">
										{hits.map(({ term, hit, basis }) => (
											<EvidenceLine
												basis={basis}
												boost={term.mode === "boost"}
												hit={hit}
												key={term.term}
												term={term.term}
											/>
										))}
										<MissedTerms terms={missed.map((t) => t.term)} />
									</div>
								</>
							)}
						</Card>
					);
				})}
			</ul>

			{total > RESULT_PAGE && (
				/*
				 * 列表的结尾必须回答「我看完了吗」，所以永远同时说出两个数。
				 * 翻不动的时候不留一个按不动的按钮，改说原因——「看完了」和
				 * 「到上限了」是两件事，后者要给出路，前者不必。
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
 * 这次查询要画哪几条证据。
 *
 * 取自查询记录上的 chips，不等服务端返回 `terms`：改筛选那一帧服务端还是
 * 旧值，骨架屏的块高会先跳一下再回来。骨架只数条数，所以说法只放主词即可。
 *
 * 排除词和停用的词都不占一行：前者不产出证据，后者根本不参与这次检索。
 */
function pendingTerms(chips: Chip[]): TermPlan[] {
	return activeChips(chips).flatMap((c) =>
		c.mode === "exclude"
			? []
			: [{ term: c.term, members: [c.term], mode: c.mode } satisfies TermPlan],
	);
}
