import { Link } from "@tanstack/react-router";
import { ListChecksIcon, SearchXIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import {
	Dot,
	EvidenceLine,
	MissedClaims,
	StrengthLegend,
} from "#/components/evidence";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { CheckboxGroup } from "#/components/ui/checkbox-group";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";
import { Label } from "#/components/ui/label";
import { Separator } from "#/components/ui/separator";
import { Skeleton } from "#/components/ui/skeleton";
import { Toggle } from "#/components/ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { positionLabel } from "#/lib/format";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { conditionKey } from "#/search/condition";
import { claimName } from "#/search/condition-label";
import { type Claim, claimsOf, type SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import { RESULT_MAX, RESULT_PAGE } from "#/search/weights";
import { emptyState } from "../-lib/empty-state";
import type { Picks } from "../-lib/picks";
import type { View } from "../-lib/view-params";
import { PickDock } from "./pick-dock";

/** 一块卡片的内边距。骨架屏和候选人共用，加载完成的那一帧才不会抖。 */
const PAD = "px-4 py-3.5";

/** 首次检索的骨架块数。之后跟着上一次的结果数走，列表高度就不会每次跳。 */
const SKELETON_ROWS = 5;

/** 计数那一行怎么描述这份名单的排序。 */
const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按证据排序",
	depth: "按经历深度排序",
	employee: "按工号排序",
};

/**
 * 名单的表头：这份名单有多少人、按什么排、图例三个点各是什么意思、要不要只留
 * 任职记录能证明的那些人，以及要不要只看深度。
 *
 * 这些都是名单自身的属性，所以跟着名单走。放进查询区的话，计数会随 chips 换行
 * 上下移动，而它回答的也不是「我搜了什么」。
 *
 * 图例必须和它解释的那些点在同一屏，所以排在这里；旁边的开关要求的正是图例里
 * 第一个点，两者相邻，开关就不必再解释一遍自己的含义。
 *
 * 排序方式是整份名单的属性，一句话说完即可：名次由每个人在列表里的位置表示
 * （AGENTS.md「分数不上屏」），这里只需说明顺序按什么排。
 *
 * 只在有名单可介绍时渲染，该判断由调用方做——见下面空态那一支。
 */
export function ResultHeader({
	loading,
	order,
	total,
	claims,
	strong,
	byDepth,
	onChange,
	strongOn,
	planned,
	picking,
	onPicking,
	pickable,
}: {
	loading: boolean;
	/** 屏幕上这份名单实际按什么排（结果说的）。 */
	order: SearchOutcome["order"];
	total: number;
	claims: Claim[];
	/**
	 * 这次查询有没有经历主张，从记录上算，不等服务端返回。
	 *
	 * 右边那一组（图例和开关）因此从第一帧就在，而不是等 `claims` 回来。等的话
	 * 这一行会在结果到达时增高（开关比一行文字高 8px），整份名单跟着下移一次。
	 */
	planned: boolean;
	/** 「仅岗位或序列」是否打开。它是这份名单的属性，不是视图状态。 */
	strong: boolean;
	/** 「只看深度」是否打开（取自视图状态）。结果还没回来时它就已经是按下态。 */
	byDepth: boolean;
	onChange: (next: Partial<View>) => void;
	/** 只留受控证据之后还剩多少人 */
	strongOn: number;
	/** 是否处于挑人模式。挑人时整份名单左侧让出一列复选框，表头这一行最左边是全选。 */
	picking: boolean;
	/** 进入或退出挑人。 */
	onPicking: (on: boolean) => void;
	/** 是否有可挑的名单。没有时按钮保留位置但禁用，理由和「仅岗位或序列」相同。 */
	pickable: boolean;
}) {
	return (
		/* 这是表头行的内容格，左边那一格由调用方（`ResultList` 的 `head`）给出，
		   所以这里只负责自己这一格内部的排布。 */
		<div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
			<p className="text-muted-foreground text-sm" role="status">
				{loading ? (
					"搜索中…"
				) : (
					<>
						<b className="text-foreground tabular-nums">{total}</b> 人
						{` · ${ORDER_LABEL[order]}`}
					</>
				)}
			</p>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				{/* 图例和旁边的开关说的都是证据，没有条件的查询里两者都没有意义；
				    挑人与条件无关，按部门筛出的一批人同样需要导出。 */}
				{(planned || claims.length > 0) && (
					<>
						<StrengthLegend />
						<ProvenOnly
							loading={loading}
							n={strongOn}
							on={strong}
							onChange={onChange}
						/>
						<ByDepth on={byDepth} onChange={onChange} />
						{/*
						 * 竖线分开两类控件：左边描述这份名单是什么（图例、只留受控
						 * 证据），右边是对这份名单执行的操作。连续排列的控件会被读成
						 * 同一类，而这两半不是。
						 */}
						<Separator className="h-4 max-sm:hidden" orientation="vertical" />
					</>
				)}
				{/*
				 * 挑人是一个操作，不是名单的一种性质：按下之后名单内容不变，只是
				 * 开始从中选择。所以用按钮，而不是左边那种 `Toggle`——「仅岗位或
				 * 序列」按下会让人从名单里消失，两者同款同尺寸并排会被当成同一类。
				 *
				 * 进入和退出都用动作文案（「挑人导出」／「退出挑人」），不靠按下态
				 * 表示当前模式：名单左侧那一列复选框已经表示了。
				 */}
				<Button
					disabled={!pickable}
					onClick={() => onPicking(!picking)}
					size="sm"
					variant="outline"
				>
					{picking ? <XIcon /> : <ListChecksIcon />}
					{picking ? "退出挑人" : "挑人导出"}
				</Button>
			</div>
		</div>
	);
}

/**
 * 仅岗位或序列。
 *
 * 打开之后，每一条必须条件都要落在岗位或序列上才算命中（`rank.ts` 的 `complete`）。
 * 部门、公司、简历、技能都不算。文案和图例最强的一档一致，不另造说法。
 *
 * 它不是筛选维度，所以不在左栏：左栏那几维是在这批人里再看其中一部分，而它改的
 * 是什么才算命中，和左边的计数、右边的图例说的是同一件事。
 *
 * 只有开关两态、没有值可选，所以不做成选择器——为一个布尔量弹一层浮层，多点一次
 * 却不增加信息。`Toggle` 就是这件事对应的控件：按下态由组件用 `data-pressed`
 * 表示，不必手写 `aria-pressed` 再另配底色。
 */
function ProvenOnly({
	on,
	onChange,
	n,
	loading,
}: {
	on: boolean;
	onChange: (next: Partial<View>) => void;
	n: number;
	/** 还在等结果：这个数此刻是「不知道」，不是 0。 */
	loading: boolean;
}) {
	// 一个人都数不出来时禁用，但保留位置：点下去必然清空名单，属于无效操作，左栏
	// 各维处理无效操作的办法同样是把计数为 0 的行禁用并留在原地（`filter-rail.tsx`
	// 开头）。整个移除的话，这一行会在结果到达时增高，整份名单跟着下移。
	// 已经打开的始终可点，否则筛到 0 人之后就没有办法关掉它。
	return (
		<Toggle
			disabled={!on && n === 0}
			onPressedChange={(next) => onChange({ strong: next || undefined })}
			pressed={on}
			size="sm"
			variant="outline"
		>
			<Dot strength="controlled" />
			<span>仅岗位或序列</span>
			{/*
			 * 数字位一直占着。按下去之后这个数就没意义了（开着的时候表头那个总数
			 * 就是它），但位子不留着的话按钮当场变窄，它左边的图例跟着往右滑——
			 * 而位移的正是人刚点下去的那个东西。等结果的时候同样占着位、不写数：
			 * 那一刻它是「不知道」，写 0 就是在报一个假的事实。
			 */}
			<span
				className={cn(
					"text-muted-foreground tabular-nums",
					(on || loading) && "invisible",
				)}
			>
				{n}
			</span>
		</Toggle>
	);
}

/**
 * 只看深度。
 *
 * 默认的排法先按证据分档、档内按做得多深（`result.ts` 的 `Order`）；这个开关
 * 抹掉分档，只看做得多像、多久、多近。组团队要找做得久的人时用它：自述八年的
 * 经历排到登记三个月的岗位前面，点阵仍在旁边说那是自述。
 *
 * 和「仅岗位或序列」并排：两个都在讲**这份名单怎么看证据**，一个收紧、一个放开。
 * 它没有数可报——换排法不改变人数，所以没有那个占位的数字。
 */
function ByDepth({
	on,
	onChange,
}: {
	on: boolean;
	onChange: (next: Partial<View>) => void;
}) {
	return (
		<Toggle
			onPressedChange={(next) =>
				onChange({ order: next ? "depth" : undefined })
			}
			pressed={on}
			size="sm"
			variant="outline"
		>
			<span>只看深度</span>
		</Toggle>
	);
}

/**
 * 挑人时名单左侧让出的那一列，在每一行上对应的那一格。
 *
 * 表头、骨架块、候选卡片都以它开头，宽度只有 `--pick-column` 一个出处
 * （styles.css），所以加载中和结果到达后的几何完全一致：名单只在进入挑人模式时
 * 位移一次。
 *
 * 不挑人时宽度为 0 且 `invisible`（`visibility: hidden`），里面的复选框同时退出
 * Tab 序和读屏，留下的是一格宽度而不是一个隐藏但仍可聚焦的控件——筛选栏的
 * 「清除」用的是同一个办法。宽度做成过渡而不是瞬变，因为它由用户显式切换触发。
 */
function PickCell({ children }: { children?: ReactNode }) {
	return (
		<div className="invisible w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out group-data-picking/list:visible group-data-picking/list:w-(--pick-column)">
			{children}
		</div>
	);
}

/**
 * 没有匹配到人时的空态。
 *
 * 空态总是给一条可以一键执行的出路，而不是让用户自己猜该改哪里。成因由检索层
 * 给出（`search/empty.ts`），这里只把它翻译成一句话和一个按钮；检索还没开始跑
 * （换查询的第一帧）时按「还没有条件」处理。
 *
 * 这一支不渲染表头：空态文案已经说明了没有结果，顶上再加一行「0 人」是重复。
 * 也不给 `Empty` 加边框——coss 的 `Empty` 是一块居中内容而不是卡片，加一圈虚线
 * 等于在名单的位置上放一个假的名单外形。
 */
function NoResults({
	outcome,
	spec,
	onChange,
	onReviseQuery,
	onEditQuery,
}: {
	outcome: SearchOutcome;
	spec: SearchSpec;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
}) {
	const state = emptyState(outcome.empty ?? { kind: "noConditions" }, {
		conditions: spec.conditions,
		onChange,
		onEditQuery,
		onReviseQuery,
	});
	return (
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
	strongOn,
	spec,
	turnId,
	strong,
	byDepth,
	onChange,
	onReviseQuery,
	onEditQuery,
	picks,
}: {
	/** 这次检索的结果。还没跑出来的那一份是 `NO_OUTCOME`，不是 `null`。 */
	outcome: SearchOutcome;
	empId: string | undefined;
	loading: boolean;
	/** 还翻得动吗。翻不动的原因有两种（看完了 / 到上限了），文案在页脚分。 */
	canMore: boolean;
	/** 正在翻下一页：已经看到的人留在原地，只有按钮转圈 */
	growing: boolean;
	onMore: () => void;
	/** 打开它之后还剩多少人。表头那个开关关着时报的就是这个数。 */
	strongOn: number;
	/** 这条查询记录上的条件。骨架屏的行数由它算，不等服务端。 */
	spec: SearchSpec;
	turnId: string;
	/** 「仅岗位或序列」开着没有，给表头那个开关。 */
	strong: boolean;
	/** 「只看深度」开着没有，给表头那个开关。 */
	byDepth: boolean;
	onChange: (next: Partial<View>) => void;
	/** 改查询：给一份新的证据要求，派生一条新记录。 */
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
	/** 挑人这件事的全部状态，以及名单每一块推好的那份东西（`-lib/picks.ts`）。 */
	picks: Picks;
}) {
	const { results, claims, order, total } = outcome;
	// 上一次真正画出来的块数，见 SKELETON_ROWS。写在 effect 里而不是渲染中，
	// 渲染要保持纯：同一份 props 渲染两遍必须得到同一棵树。
	const lastRows = useRef(SKELETON_ROWS);
	useEffect(() => {
		if (!loading && results.length > 0) lastRows.current = results.length;
	}, [loading, results.length]);

	// 这次查询会画几条证据，从记录上算，不等服务端返回 `claims`：改筛选那一帧
	// 服务端还是旧值，骨架屏的块高会先跳一下再回来。骨架屏的块高和表头右边
	// 那一组都读它——两处都是「结果回来之前就得把位子占好」。
	const pending = claimsOf(spec.conditions);

	// 有名单可挑吗。表头那颗按钮和表头这一行的第一格（全选）说的是同一件事。
	const pickable = !loading && results.length > 0;

	const head = (
		/* 名单的第一行，和下面每一块同一副骨架：挑格加内容。于是表头那个全选和
		   每一块的那个框落在同一条竖线上——那是表格用了几十年的第一列，只不过
		   这里的「行」是一块卡片。 */
		<div className="mb-2.5 flex items-start">
			<PickCell>
				{pickable && (
					/* 这一个框没有写出来的标签——它的位置（表头这一行的第一格）就是它的
					   说明。说明挂在 Tooltip 上，和图例那三颗点同一个办法：不确定它是
					   什么的人，停一下就读得到。 */
					<Tooltip>
						<TooltipTrigger
							render={
								<Label className="p-1">
									<Checkbox aria-label={`全选这 ${results.length} 人`} parent />
								</Label>
							}
						/>
						<TooltipPopup>全选这 {results.length} 人</TooltipPopup>
					</Tooltip>
				)}
			</PickCell>
			<ResultHeader
				byDepth={byDepth}
				loading={loading}
				onChange={onChange}
				onPicking={picks.start}
				order={order}
				pickable={pickable}
				picking={picks.picking}
				planned={pending.length > 0}
				strong={strong}
				strongOn={strongOn}
				claims={claims}
				total={total}
			/>
		</div>
	);

	// 检索中绝不闪现「没有结果」。
	const content = loading ? (
		<div>
			{head}
			<div className="flex flex-col gap-2">
				{Array.from(
					{ length: Math.min(lastRows.current, RESULT_PAGE) },
					(_, row) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: 骨架块没有身份
						<div className="flex" key={row}>
							<PickCell />
							<Card className={cn(PAD, "min-w-0 flex-1")}>
								{/*
								 * 骨架屏画的是**这次查询会有几条证据**，不是一个通用的方块堆：
								 * 条件数取自记录上的 chips。
								 *
								 * 每一行的高度也从真卡片来：`h-lh` 是这一档字阶自己的行高
								 * （姓名那行 `title-2`、证据行 `text-sm`，和 `EvidenceLine`
								 * 同一档），所以块高等于加载完成之后的块高，名单不会在结果
								 * 落地的那一帧长高。灰条自己多高无所谓——它住在行盒里，
								 * 撑起高度的是行盒。
								 */}
								<div className="title-2 flex h-lh items-center gap-2.5">
									<Skeleton className="h-4 w-24" />
									<Skeleton className="h-3 w-44" />
								</div>
								{pending.length > 0 && (
									<div className="mt-3 space-y-1.5">
										{pending.map((c) => (
											<div
												className="flex h-lh items-center gap-2.5 text-sm"
												key={conditionKey(c)}
											>
												<Skeleton className="size-2 rounded-full" />
												<Skeleton className="h-3 w-16" />
												<Skeleton className="h-3 flex-1" />
											</div>
										))}
									</div>
								)}
							</Card>
						</div>
					),
				)}
			</div>
		</div>
	) : results.length === 0 ? (
		<NoResults
			onChange={onChange}
			onEditQuery={onEditQuery}
			onReviseQuery={onReviseQuery}
			outcome={outcome}
			spec={spec}
		/>
	) : (
		<>
			{head}
			<ul className="flex flex-col gap-2">
				{/* 命中的逐条渲染，没命中的合成一行。这份推导在 `-lib/picks.ts` 完成，
				    因为选中时要写进 CSV 的是同一份数据。「未命中」重复五遍不增加信息，
				    只会让每张卡片高一倍。 */}
				{picks.rows.map(({ employee: e, hits, missed }) => {
					const selected = e.empId === empId;
					return (
						<li className="flex" key={e.empId}>
							{/*
							 * 复选框放在卡片外面：整张卡片是一条打开详情的链接，往整块
							 * 可点的区域里再嵌一个控件，就是 AGENTS.md 说的形状选错。
							 * 它放在这一行让出的那一格里，两者各有各的点击区域。
							 *
							 * `mt-2.5` 让复选框对齐卡片里的第一行文字：卡片上内边距是
							 * 14px，复选框比那行文字矮一档。
							 */}
							<PickCell>
								<Label className="mt-2.5 p-1">
									<Checkbox aria-label={`选择 ${e.name}`} value={e.empId} />
								</Label>
							</PickCell>
							<Card
								className={cn(
									PAD,
									"min-w-0 flex-1 transition-[border-color,background-color]",
									// ↑↓ 换人时 scrollIntoView 把卡片推到视口边缘上，两头各留一档余量。
									// 上边还要让开常驻的那一叠（顶栏加查询带），高度只有
									// `--chrome-height` 一个出处（styles.css）。
									"scroll-mt-[calc(var(--chrome-height)+--spacing(4))] scroll-mb-4",
									selected
										? // 蓝调环：绿在这套设计里只表达「受控字段命中」。
											"border-info/40 ring-1 ring-info/30"
										: "hoverable:hover:bg-accent/40",
								)}
								/* ↑↓ 换人时靠它把这一块滚进视口（-lib/keyboard-flow.ts） */
								data-emp={e.empId}
							>
								<div className="flex items-baseline gap-2.5">
									<Link
										aria-current={selected ? "page" : undefined}
										/*
										 * 整块可点靠这条链接自己铺开的一层伪元素，不是挂在 `<li>` 上的
										 * onClick——那样得到的是只认鼠标左键的假按钮，中键开新标签、
										 * 右键复制地址、Tab 走到它、回车打开一样都不成立。
										 *
										 * replace：点一块是「看哪一个」，不是一次导航。扫过三十个人
										 * 不该在历史栈里压三十条，否则后退键就废了。
										 *
										 * 悬停的反馈归卡片（它整块换底色，而鼠标落在哪里命中的都是
										 * 这条链接）；焦点环归这里，那件事卡片没有替它说。
										 */
										className="title-2 shrink-0 truncate rounded-sm font-semibold after:absolute after:inset-0 after:content-['']"
										params={{ turnId, empId: e.empId }}
										replace
										search={(prev) => prev}
										to="/s/$turnId/p/$empId"
									>
										{e.name}
									</Link>
									<span className="min-w-0 truncate text-muted-foreground text-sm">
										{positionLabel(e)}
									</span>
								</div>

								{/*
								 * 证据。命中的每条一行，四段固定的槽在所有卡片上位置相同——
								 * 这是把表格旋转成块之后仍然能上下扫的依据，只不过那条竖线上
								 * 现在写着凭据。
								 *
								 * 和上面那一行之间空 12px：证据行彼此是 6px，两倍就读成另一段。
								 * 头和身子的分界靠字重字号的落差，够了（AGENTS.md「线只画在有
								 * 结构含义的地方」）。
								 */}
								{claims.length > 0 && (
									<div className="mt-3 space-y-1.5">
										{hits.map(({ claim, name, hit, basis }) => (
											<EvidenceLine
												basis={basis}
												boost={claim.mode === "boost"}
												hit={hit}
												key={conditionKey(claim)}
												name={name}
											/>
										))}
										<MissedClaims names={missed} />
									</div>
								)}
							</Card>
						</li>
					);
				})}
			</ul>

			{total > RESULT_PAGE && (
				/*
				 * 列表的结尾必须回答「我看完了吗」，所以永远同时说出两个数。总数在表头
				 * 也说过一次，但这一段只在超过一页（RESULT_PAGE 人）时才出现，那时表头早滚出屏幕
				 * 了——两个数从来不同屏，不是同一句话说了两遍。
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
		</>
	);

	return (
		/*
		 * 只有这一层容器，挑人时让出一列由它负责：骨架、空态、名单三种内容都在它
		 * 里面，每一行以 `PickCell` 开头。三支各自搭一棵树的话，让出的列宽就有三个出处，
		 * 漏掉其中一处会在结果到达的那一帧让整份名单横向位移，而到达时不允许有
		 * 位移（AGENTS.md）。
		 *
		 * 这一层同时是 `CheckboxGroup`：全选、半选状态，以及「这一组复选框属于同
		 * 一件事」的语义都由它提供（Base UI），不必自己用 `checked={a && b}` 拼。
		 * 不挑人时里面的复选框都是 0 宽且 `invisible`，保留的是布局，不是一组隐藏
		 * 但仍可聚焦的控件。
		 */
		<CheckboxGroup
			allValues={picks.shownIds}
			aria-label="名单"
			className="group/list block"
			data-picking={picks.picking || undefined}
			onValueChange={(next) => picks.setShown(next.map(String))}
			value={picks.shownPicked}
		>
			{content}

			{/*
			 * 选中人之后才出现，浮在名单下沿（`pick-dock.tsx` 开头写了原因）。它在
			 * 上面三支之外：筛到一个人都不剩时，已选中的那几个仍然可以导出——选中
			 * 记录是按选中那一刻的快照保存的，不随筛选消失。
			 */}
			{picks.picking && (
				<PickDock picks={picks} names={claims.map(claimName)} total={total} />
			)}
		</CheckboxGroup>
	);
}
