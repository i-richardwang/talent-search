import { Link } from "@tanstack/react-router";
import { ListChecksIcon, SearchXIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
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
import { Spinner } from "#/components/ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { positionLabel } from "#/lib/format";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { conditionKey } from "#/search/condition";
import { claimName } from "#/search/condition-label";
import { type Claim, claimsOf, type SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import { RESULT_PAGE } from "#/search/weights";
import { emptyState } from "../-lib/empty-state";
import type { Picks } from "../-lib/picks";
import { reachOf, type View } from "../-lib/view-params";
import { PickDock } from "./pick-dock";

/** 一块卡片的内边距。 */
const PAD = "px-4 py-3.5";

/** 计数那一行怎么描述这份名单的排序。 */
const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按证据排序",
	employee: "默认顺序",
};

/**
 * 名单的表头：这份名单有多少人、按什么排、图例三个点各是什么意思。
 *
 * 这些都是名单自身的属性，所以跟着名单走。放进查询区的话，计数会随 chips 换行
 * 上下移动，而它回答的也不是「我搜了什么」。
 *
 * 图例必须和它解释的那些点在同一屏，所以排在这里。
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
	 * 图例因此从第一帧就在，而不是等 `claims` 回来。等的话它会在结果到达时
	 * 凭空多出来，把这一行挤到换行，整份名单跟着往下跳一次。
	 */
	planned: boolean;
	/** 是否处于选择模式。选择时整份名单左侧让出一列复选框，表头这一行最左边是全选。 */
	picking: boolean;
	/** 进入或退出选择。 */
	onPicking: (on: boolean) => void;
	/** 是否有可供选择的名单。没有时按钮保留位置但禁用，位置留着列表才不会位移。 */
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
				{/* 图例说的是证据，没有条件的查询里它没有意义；选择与条件无关，
				    按部门筛出的一批人同样需要导出。 */}
				{(planned || claims.length > 0) && (
					<>
						<StrengthLegend />
						{/*
						 * 竖线分开两类东西：左边说明这份名单怎么读，右边是对这份
						 * 名单执行的操作。连着排会被读成同一类，而这两半不是。
						 */}
						<Separator className="h-4 max-sm:hidden" orientation="vertical" />
					</>
				)}
				{/*
				 * 进入和退出都用动作文案（「选择」／「取消选择」），不靠按下态
				 * 表示当前模式：名单左侧那一列复选框已经表示了。
				 */}
				<Button
					disabled={!pickable}
					onClick={() => onPicking(!picking)}
					size="sm"
					variant="outline"
				>
					{picking ? <XIcon /> : <ListChecksIcon />}
					{picking ? "取消选择" : "选择"}
				</Button>
			</div>
		</div>
	);
}

/**
 * 选择时名单左侧让出的那一列，在每一行上对应的那一格。
 *
 * 表头、骨架块、候选卡片都以它开头，宽度只有 `--pick-column` 一个出处
 * （styles.css），所以加载中和结果到达后的几何完全一致：名单只在进入选择模式时
 * 位移一次。
 *
 * 不选择时宽度为 0 且 `invisible`（`visibility: hidden`），里面的复选框同时退出
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
 * 检索中这一屏说什么。
 *
 * 一句话，而且句子里那个名词**一秒后用户要在屏幕上看见**：条件会变成查询带上
 * 那排 chips，人会变成下面那份名单。屏幕上不出现管道自己的名字（理解、翻译、
 * 召回、重排）——那是我们这边在干什么，等的人要的是一份名单。
 *
 * 键是**真实发生的两跳**，不是按秒表播放的脚本：`interpreting` 是模型把原话翻成
 * 条件那一跳（最长 60 秒，盯着看的那段几乎全是它），`searching` 是服务端召回加
 * 重排。计时脚本写不得——模型跑 40 秒时，几句词会在前几秒播完，然后停在一句
 * 宣称自己快好了的话上；模型 800 毫秒就回来时，几句词一闪而过。界面不该说系统
 * 不知道的事。
 *
 * 两句之间真的会跳一次，而且跳的那一刻查询带上的 chips 同时亮起（`QueryDeck`）：
 * 两处同时变，才是「有进展」拿得出的证据。
 */
const PHASE_TEXT = {
	interpreting: "正在整理搜索条件",
	searching: "正在查找符合条件的人",
} as const;

/** 检索这件事此刻走到哪一跳。 */
export type SearchPhase = keyof typeof PHASE_TEXT;

/** 等过这么久还没好，才把秒数说出来。快的那些查询永远看不到这个数。 */
const PATIENCE_MS = 5000;

/**
 * 从挂载起算已经等了几秒；没到 `PATIENCE_MS` 之前答 `null`。
 *
 * 跨阶段不重置：用户问的是「这次搜索花了多久」，不是「这一跳花了多久」。
 */
function useElapsed(): number | null {
	const [ms, setMs] = useState(0);
	useEffect(() => {
		const start = Date.now();
		const timer = setInterval(() => setMs(Date.now() - start), 1000);
		return () => clearInterval(timer);
	}, []);
	return ms >= PATIENCE_MS ? Math.round(ms / 1000) : null;
}

/**
 * 检索中占的那一屏。
 *
 * 不画骨架块：这一页的骨架屏要按条件数拼出证据行，画出来是一堆灰条，而它换来的
 * 只有「高度占住了」这一件事——高度用一个空盒子同样占得住。空着不难看，灰条难看。
 *
 * 高度必须占住：这一列下面还挂着快捷键页脚，塌下去页脚就会跳上来一次。一屏的定义
 * 只有一个出处——`--chrome-height`（顶栏加查询带，styles.css）；再减掉 5rem 是
 * 外面那层 `main` 自己的 `pt-4 pb-16`，不减就会多出一条只在检索时出现的滚动条。
 */
function Searching({ phase }: { phase: SearchPhase }) {
	const seconds = useElapsed();
	return (
		<div className="flex min-h-[calc(100dvh-var(--chrome-height)-5rem)] flex-col items-center justify-center gap-4">
			{/* 图标不进无障碍树：这一屏要读出来的是下面那句话，读一遍就够。 */}
			<Spinner
				aria-hidden="true"
				aria-label={undefined}
				className="size-5 text-muted-foreground"
				role="presentation"
			/>
			<p className="font-medium text-sm" role="status">
				{PHASE_TEXT[phase]}
				{seconds !== null && (
					<span className="text-muted-foreground tabular-nums">
						{` · ${seconds} 秒`}
					</span>
				)}
			</p>
		</div>
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
	phase,
	canMore,
	growing,
	onAll,
	onMore,
	spec,
	turnId,
	onChange,
	onReviseQuery,
	onEditQuery,
	picks,
}: {
	/** 这次检索的结果。还没跑出来的那一份是 `NO_OUTCOME`，不是 `null`。 */
	outcome: SearchOutcome;
	empId: string | undefined;
	loading: boolean;
	/** 检索中走到哪一跳了。只在 `loading` 为真时看得见。 */
	phase: SearchPhase;
	/** 还翻得动吗。翻不动的原因有两种（看完了 / 到上限了），文案在页脚分。 */
	canMore: boolean;
	/** 正在翻下一页：已经看到的人留在原地，只有按钮转圈 */
	growing: boolean;
	/** 导出时的「选择全部 N 人」：能显示的全部选中，名单没加载出来的一并加载。 */
	onAll: () => void;
	onMore: () => void;
	/** 这条查询记录上的条件。表头那一组图例由它算，不等服务端。 */
	spec: SearchSpec;
	turnId: string;
	onChange: (next: Partial<View>) => void;
	/** 改查询：给一份新的条件，派生一条新记录。 */
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
	/** 选择这件事的全部状态，以及名单每一块推好的那份东西（`-lib/picks.ts`）。 */
	picks: Picks;
}) {
	const { results, claims, order, total } = outcome;
	// 名单给得到的人有几个。结尾那句话和导出那条提示说的是同一个数。
	const reach = reachOf(total);
	// 这次查询有没有经历主张，从记录上算，不等服务端返回 `claims`：改筛选那一帧
	// 服务端还是旧值，表头右边那一组会先消失再回来。
	const pending = claimsOf(spec.conditions);

	// 有可供选择的名单吗。表头那颗按钮和表头这一行的第一格（全选）说的是同一件事。
	const pickable = !loading && results.length > 0;

	const head = (
		/* 名单的第一行，和下面每一块同一副骨架：选择格加内容。于是表头那个全选和
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
				loading={loading}
				onPicking={picks.start}
				order={order}
				pickable={pickable}
				picking={picks.picking}
				planned={pending.length > 0}
				claims={claims}
				total={total}
			/>
		</div>
	);

	// 检索中绝不闪现「没有结果」。
	const content = loading ? (
		<Searching phase={phase} />
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
								 * 现在写着证据。
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
				 * 翻不动的时候不留一个按不动的按钮，改说原因——「看完了」和「名单到此
				 * 为止」是两件事，后者要给出路，前者不必。后者说的是这份答案的口径
				 * （按相关度只显示到第几位，`weights.ts` 那一段），出路因此是收窄条件。
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
							{total > reach
								? `名单按相关度只显示前 ${reach} 位。想看更靠后的人，把条件收窄。`
								: "已显示全部结果。"}
						</span>
					)}
				</div>
			)}
		</>
	);

	return (
		/*
		 * 只有这一层容器，选择时让出一列由它负责：骨架、空态、名单三种内容都在它
		 * 里面，每一行以 `PickCell` 开头。三支各自搭一棵树的话，让出的列宽就有三个出处，
		 * 漏掉其中一处会在结果到达的那一帧让整份名单横向位移，而到达时不允许有
		 * 位移（AGENTS.md）。
		 *
		 * 这一层同时是 `CheckboxGroup`：全选、半选状态，以及「这一组复选框属于同
		 * 一件事」的语义都由它提供（Base UI），不必自己用 `checked={a && b}` 拼。
		 * 不选择时里面的复选框都是 0 宽且 `invisible`，保留的是布局，不是一组隐藏
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
				<PickDock
					loading={growing}
					names={claims.map(claimName)}
					onAll={onAll}
					picks={picks}
					total={total}
				/>
			)}
		</CheckboxGroup>
	);
}
