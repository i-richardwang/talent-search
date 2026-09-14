import { Link } from "@tanstack/react-router";
import { ListChecksIcon, SearchXIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
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

/** 报数那一行怎么说这份名单按什么排。 */
const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按证据排序",
	depth: "按经历深度排序",
	employee: "按工号排序",
};

/**
 * 名单的表头：这份名单有多少人、按什么排、那三颗点各是什么意思、要不要
 * 只留任职记录能证明的那些人，以及要不要只看深度。
 *
 * 这些都是**关于这份名单**的，所以它们跟着名单走。放进查询台的角落，报数就会
 * 随着 chips 换行上下漂，而它回答的本来也不是「我搜了什么」。
 *
 * 图例必须和它解释的那些点同屏，所以只能排在这里；而那个开关要求的正是图例里
 * 第一颗点，两者挨着放，开关就不必再解释一遍自己是什么意思。
 *
 * 「按什么排」是**整份名单**的性质，一句话说完就够：名次由每个人在这一列里的位置
 * 给出（AGENTS.md「分数不上屏」），这里只需要说清那个顺序是按什么排的。
 *
 * 它只在有名单可介绍的时候出现，而那个判断归调用点——见下面空态那一支。
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
	 * 这次查询有没有经历主张——**从记录上算，不等服务端**。
	 *
	 * 右边那一簇（图例和那个开关）因此从第一帧就在场，而不是等 `claims` 回来。
	 * 等的话这一行会在结果落地时长高一档（那个开关比一行字高 8px），整份名单
	 * 跟着往下跳一次。
	 */
	planned: boolean;
	/** 「仅岗位或序列」开着没有。它是这份名单的性质，不是一份视图状态。 */
	strong: boolean;
	/** 「只看深度」开着没有（视图要的）。结果还没回来时它已经按下去了。 */
	byDepth: boolean;
	onChange: (next: Partial<View>) => void;
	/** 只留受控证据之后还剩多少人 */
	strongOn: number;
	/** 在挑人吗。挑人时整份名单往右让出一列复选框，表头这一行的最左边是全选。 */
	picking: boolean;
	/** 进入或退出挑人。 */
	onPicking: (on: boolean) => void;
	/** 有名单可挑吗。没有的时候按钮留在原地、按不下去，理由和「仅岗位或序列」同一条。 */
	pickable: boolean;
}) {
	return (
		<div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
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
				{/* 图例和它旁边那个开关都在讲证据，没有条件的查询里两样都无从说起；
				    挑人不看条件——按部门圈出来的一批人同样是要交出去的名单。 */}
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
						 * 一条竖线分开两类东西：左边讲**这份名单是什么**（三颗点、
						 * 只留受控证据的那一档），右边是**对这份名单做点什么**。
						 * 挨着排的一串控件默认读成一类，而这两半不是。
						 */}
						<Separator className="h-4 max-sm:hidden" orientation="vertical" />
					</>
				)}
				{/*
				 * 挑人是一次**动作**，不是这份名单的一种性质：按下去这份名单一个人
				 * 不少，只是我要开始从里面挑了。所以它是按钮，不是它左边那种
				 * `Toggle`——「仅岗位或序列」按下去是会让人消失的，两件事同款同尺寸
				 * 并排，等于宣称它们是一类。
				 *
				 * 进和出都写成这一下要做的事（「挑人导出」／「退出挑人」），不靠
				 * 一个按下去的样子表示现在在哪一档：名单左边那一列框已经把它说完了。
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
 * 打开之后，每一条必须条件都得落在岗位或序列上才算数（`rank.ts` 的 `complete`）。
 * 部门、公司、简历、技能都不算。和图例最强那一档同一句话，不另造一套说法。
 *
 * 它不是一个筛选维度，所以不在左栏里：左栏那几维是「在这批人里再看哪一部分」，
 * 而它改的是**什么才算命中**，和左边那句报数、右边那三颗点是同一件事。
 *
 * 只有开关两态，没有值可选，所以不做成选择器——为一个布尔量弹一层，是多点
 * 一下换零信息。`Toggle` 是这件事的原生形状：按下态由组件自己用 `data-pressed`
 * 表示，不必手写 `aria-pressed` 再自配一套底色。
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
	// 一个人都数不出来时**按不下去**，但位子还在——点下去必然清空名单，那是一条
	// 死路，而左栏那几维处理死路的办法正是把数到 0 的那一行禁用掉、留在原地
	// （`filter-rail.tsx` 开头）。整个抽掉的话，这一行会随着结果落地长高一档，
	// 整份名单跟着往下跳，而那正是这一屏最该稳住的东西。
	// 已经打开的永远可点：否则筛到 0 人之后就没有任何东西能关掉它了。
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
	// 那一簇都读它——两处都是「结果回来之前就得把位子占好」。
	const pending = claimsOf(spec.conditions);

	const head = (
		<ResultHeader
			byDepth={byDepth}
			loading={loading}
			onChange={onChange}
			onPicking={picks.start}
			order={order}
			pickable={!loading && results.length > 0}
			picking={picks.picking}
			planned={pending.length > 0}
			strong={strong}
			strongOn={strongOn}
			claims={claims}
			total={total}
		/>
	);

	// 检索中绝不闪现「没有结果」。
	if (loading) {
		return (
			<div>
				{head}
				<div className="flex flex-col gap-2">
					{Array.from(
						{ length: Math.min(lastRows.current, RESULT_PAGE) },
						(_, row) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: 骨架块没有身份
							<Card className={PAD} key={row}>
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
						),
					)}
				</div>
			</div>
		);
	}

	if (results.length === 0) {
		// 空态永远给一条出路，而且是能一键走的那条——不是让人自己回去猜该改哪。
		// 成因由检索层给（`search/empty.ts`），这里只把它翻译成一句话和一个按钮；
		// 检索还没跑（换查询的头一帧）时按「还没有条件」说。
		const state = emptyState(outcome.empty ?? { kind: "noConditions" }, {
			conditions: spec.conditions,
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
		/*
		 * 挑人时整份名单往右让出一列：那一列是复选框的位置，表头上那个全选和
		 * 每一块的那个框在同一条竖线上——和表格的第一列是同一个道理，只不过
		 * 这里的「行」是一块卡片。
		 *
		 * 让位是**推着走的**（`transition-[padding]`），不是凭空跳一档：这是一次
		 * 人自己按下去的换挡，看得见谁让给了谁；而结果落地时的位移一次都不许有
		 * （AGENTS.md），两件事不是一回事。
		 *
		 * `CheckboxGroup` 从表头那个框一直罩到最后一块：全选、勾不满时那个横杠、
		 * 以及「这一组框是一件事」的语义，都由它给（Base UI），不用自己拿一个
		 * `checked={a && b}` 去凑。
		 */
		<CheckboxGroup
			allValues={picks.shownIds}
			aria-label="名单"
			className={cn(
				"block transition-[padding] duration-200 ease-out",
				picks.picking && "ps-9",
			)}
			onValueChange={(next) => picks.setShown(next.map(String))}
			value={picks.shownPicked}
		>
			<div className="relative">
				{picks.picking && (
					// 这一个框没有写出来的标签——它的位置（表头这一行的第一列）就是它的
					// 说明，而那是表格用了几十年的约定。说明挂在 Tooltip 上，和图例
					// 那三颗点同一个办法：不确定它是什么的人，停一下就读得到。
					<Tooltip>
						<TooltipTrigger
							render={
								<Label className="-start-9 absolute top-0 p-1">
									<Checkbox
										aria-label={`挑上名单上这 ${results.length} 人`}
										parent
									/>
								</Label>
							}
						/>
						<TooltipPopup>挑上名单上这 {results.length} 人</TooltipPopup>
					</Tooltip>
				)}
				{head}
			</div>
			<ul className="flex flex-col gap-2">
				{/* 命中的逐条画，没命中的收成一行——这份推导在 `-lib/picks.ts` 做完，
				    因为挑上那一刻要写进 CSV 的正是同一份东西。「未命中」这三个字重复
				    五遍没有任何可读的东西，只是把每一块撑高一倍。 */}
				{picks.rows.map(({ employee: e, hits, missed }) => {
					const selected = e.empId === empId;
					return (
						<li className="relative" key={e.empId}>
							{/*
							 * 复选框在卡片**外面**，不在里面：卡片整块是一条打开详情的
							 * 链接，往一个整块可点的东西里再塞一个控件，就是 AGENTS.md
							 * 说的那种挑错了形状。放进左边让出来的那一列，两件事各有各
							 * 的命中区，谁也不必去猜点在哪儿会发生什么。
							 * 绝对定位是为了让卡片自己一点不变——它的宽度只由那一列
							 * 让出的位置决定，勾不勾都是同一块。
							 */}
							{picks.picking && (
								<Label className="-start-9 absolute top-2.5 p-1">
									<Checkbox aria-label={`挑上 ${e.name}`} value={e.empId} />
								</Label>
							)}
							<Card
								className={cn(
									PAD,
									"transition-[border-color,background-color]",
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

			{/* 挑上人之后才浮起来，浮在名单下沿（`pick-dock.tsx` 开头写了为什么在下面） */}
			{picks.picking && (
				<PickDock picks={picks} names={claims.map(claimName)} total={total} />
			)}
		</CheckboxGroup>
	);
}
