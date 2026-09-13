import { AlertCircleIcon, PencilIcon, RotateCwIcon } from "lucide-react";
import { useImperativeHandle, useState } from "react";
import { QueryBar } from "#/components/query-bar";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { cn } from "#/lib/utils";
import { hasMeaning, type QueryInput, type SearchSpec } from "#/search/spec";
import { QueryChips } from "./query-chips";

/** 从外面打开改写：键盘流的 `/`，以及空名单上那几条通向改写的出路。 */
export type QueryDeckHandle = { edit: () => void };

/**
 * 查询带：**我问的那句话**，和系统把它读成的条件，一行。
 *
 * 那句话是**只读的显示**：给它配上输入框那块面的材质，它就一边长成能打字的
 * 样子、一边点下去只弹出另一个框；所以它是**标题**加一颗小铅笔（Wellfound 的
 * 搜索名、Perplexity 的问题都是这么排的），输入框在别处——这一屏的输入是
 * **一次性**的，问完就该去读名单了。
 *
 * 一行里从粗到细：
 *
 * 1. **那句话**（`rawText`）。这一屏的 h1，也是这条查询唯一完整的表示。
 *    改它就是改问题：想加条件在句子后面接着写，模型读错了就把那个词说清楚，
 *    两件事在用户那里本来就是同一个动作。
 * 2. **系统读成的条件**（chips）。那句话的解释，可以逐枚调强度、停用、
 *    删除——那是**微调**，快过重写整句。它不必独自扛起表达整个查询的责任：
 *    扛不动的部分，左边那句话扛着。这排 chip 就是读出来的全部：句子里没
 *    变成 chip 的字，就是没参与找人的字。
 *
 * 再往下的报数与图例（`result-list.tsx` 的 `ResultHeader`）回答的是「这份名单是
 * 什么」。它归名单，不归这里。
 *
 * **定高，而且吸在顶栏下沿。** 两件事是一起的：
 *
 * - 吸顶，因为 chips 要在整份名单上都点得到。名单可以滚很长，而「风控这个词
 *   读窄了」是滚到第三十个人才看出来的事——那时得能当场把它调弱，不是先滚回
 *   页顶。这也是它值一条常驻横带的理由：它不是一块永远不变的抬头，是这一屏
 *   唯一能改「问的是什么」的地方。
 * - 定高（`--deck-height`），因为左右两栏和名单卡片都照那个数吸顶、让位。
 *   所以句子长了就截断（整句挂在 `title` 上），而改写框和错误提示不长在带子
 *   里、从带子里**浮出来**（`DeckSheet`）——跟着内容长高的带子会把下面那三栏
 *   推到各自算好的位置之外。
 *
 * 「换个看法」不在这里。筛选不改问题，只是在同一批候选里再看哪一部分，连查询
 * 记录都不产生（见 `routes/-lib/commit.ts` 开头）——「记录还是视图」是这个产品最要紧的
 * 一条界线，屏幕上由位置说出来：这条带里的动作会派生新记录，名单左边那条
 * 筛选栏（`filter-rail.tsx`）只动 URL。两者共用一块面的话，这条界线就只剩
 * 文案在扛。
 */
export function QueryDeck({
	spec,
	onChangeSpec,
	onQuery,
	ref,
	interpreting,
	rawText,
	error,
	onRetry,
}: {
	/** 查询条件，来自这条查询记录。理解完成之前是空的。 */
	spec: SearchSpec;
	onChangeSpec: (next: SearchSpec) => void;
	/** 改写这句话，派生一条新记录 */
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	ref: React.Ref<QueryDeckHandle>;
	/** 还在等模型把这句话翻译成条件 */
	interpreting: boolean;
	/**
	 * 这条查询在问的那句话。
	 *
	 * 界面产生的每条记录都有原话：零态敲的是句子，工作台上改 chip 派生出来的那条
	 * 继承父记录的原话。为 `null` 的只有一种——直接拿一份条件调 RPC 落下的记录
	 * （`kind: "spec"` 且没有父记录）。所以这里不给它配一套「没有原话时长什么样」
	 * 的抬头：那一格空着，条件由那排 chips 自己说。
	 */
	rawText: string | null;
	error: string | null;
	/** 理解失败时的重试动作。 */
	onRetry?: () => void;
}) {
	const settled = hasMeaning(spec) && !interpreting;
	// 系统到底读出了东西没有。读出来了才有左右两半，也才有中间那条竖线——
	// 一条一侧空着的分隔线画的是一个不存在的分界。
	const reading = spec.conditions.length > 0;
	const [editing, setEditing] = useState(false);

	useImperativeHandle(ref, () => ({ edit: () => setEditing(true) }));

	return (
		/*
		 * **整个工作区那么宽**，不是中间那一栏的抬头。
		 *
		 * 左筛选栏和右详情面板都在这条查询**之内**：左边筛的是这条查询的结果，
		 * 右边看的是这份结果里的某一个人，两者都只动 URL 上的视图参数，不产生新的
		 * 查询记录。而改这句话会派生一条新记录——「记录还是视图」这条界线在屏幕上
		 * 由位置说出来（见 `routes/-lib/commit.ts` 开头），那就不能把父级和它的两个子级
		 * 并排摆成三栏的抬头。
		 *
		 * 于是这一页是三层：顶栏（应用身份，跨查询）、这条带（这一页是什么）、
		 * 三栏（在这一页里看哪一部分、哪一个人）。
		 *
		 * 半透明的画布色加一层模糊、底边一根 `h-px` 的发丝线——和顶栏同一份配方
		 * （`routes/-components/app-header.tsx`）。这两样是它作为常驻横带的必需：
		 * 名单要从它下面穿过去，穿过去的地方得透出一点，而那根线是这套系统里
		 * 「一层的下沿」的画法。
		 *
		 * `app-column` 是顶栏用的那个盒子：于是这句话的左沿和顶栏那个应用名同线，
		 * 也和左栏里每一行选项的左沿同线。
		 */
		<header className="sticky top-(--header-height) z-stick min-h-(--deck-height) bg-canvas/80 backdrop-blur-sm before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64 lg:h-(--deck-height)">
			{/*
			 * 高度长在 `<header>` 上，不长在这一行上：改写的时候这一行整个不渲染
			 * （被浮出来的框盖住的东西不该还能 Tab 到，那句话也不该在屏幕上出现
			 * 两遍），而带子的高度是下面三栏让位的依据，不能跟着一起消失。
			 *
			 * lg 以上是**一行**：句子先让位（`truncate`），chips 不让——读错的那一枚
			 * 必须点得到。lg 以下允许换行长高，那时左右两栏一栏都不在场
			 * （筛选栏 lg+、详情 xl+），没有人读那个高度。
			 */}
			{!editing && (
				<div className="app-column flex h-full flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5 lg:flex-nowrap lg:overflow-hidden lg:py-0">
					{rawText && (
						<>
							{/*
							 * 标题是**文字**，铅笔才是按钮。整行做成一颗按钮的话，悬停时
							 * 那条通栏发亮的灰底会让它重新读成一个能打字的框——而它是只读的。
							 *
							 * 正文号加一档字重，不放大：这条带只有 40px 高，17px 的句子
							 * 配 24px 的 chip 会把整条带压得头重脚轻；何况汉字系统字没有
							 * 拉丁 display 字那种放大之后还成立的字形。它的重量由**位置**
							 * 给——一条常驻的横带，左沿和顶栏同线。
							 *
							 * 截断了整句挂在 `title` 上：这条带定高，长句子没有第二行可去。
							 */}
							<h1
								className="min-w-0 truncate font-medium text-sm"
								title={rawText}
							>
								{rawText}
							</h1>
							{interpreting ? (
								/* 理解中显示的仍是这句话，不是占位方块——右边那一格接下来
							   会变成 chips，而 chips 正是从它翻译出来的。 */
								<span
									className="shrink-0 text-muted-foreground text-xs"
									role="status"
								>
									正在理解…
								</span>
							) : (
								<Button
									aria-label="改写这句话"
									className="shrink-0"
									onClick={() => setEditing(true)}
									/* 和 chip 同一档尺码（`xs`）：带子里的控件只有一种高度，
									   带子的高度才等于 `--deck-height` 而不是「最高那一档
									   加空气」。触控目标不因此变小——coss 每个控件都带
									   `pointer-coarse:after:min-h-11`。 */
									size="icon-xs"
									variant="ghost"
								>
									<PencilIcon />
								</Button>
							)}
						</>
					)}

					{/* 一行里两类东西：我说的那句话，和系统读成的条件。竖线只在两边
				    都在场时画，而且只在真的排成一行的那一档——换了行之后，
				    分界由换行本身给。 */}
					{rawText && settled && reading && (
						<Separator className="h-4 max-lg:hidden" orientation="vertical" />
					)}

					{settled && (
						<div className="flex shrink-0 items-center gap-1.5 max-lg:flex-wrap">
							<QueryChips
								conditions={spec.conditions}
								onChange={(conditions) => onChangeSpec({ conditions })}
							/>
						</div>
					)}
				</div>
			)}

			{editing ? (
				/*
				 * 改写框浮在带子自己那一格上（`top-0`），于是框的左沿和刚才那句话
				 * 同线——原地长成一个框。
				 *
				 * 提交失败的提示跟着框走，不另外挂一层：它常常正是这次改写的结果，
				 * 而两层浮层各自定位会叠在一起。
				 */
				<DeckSheet className="top-0">
					<QueryBar
						initial={rawText ?? ""}
						onCancel={() => setEditing(false)}
						onQuery={onQuery}
					/>
					{error && <Failure error={error} onRetry={onRetry} />}
				</DeckSheet>
			) : (
				error && (
					/* 挂在带子下沿：那句话和条件要接着看得见——出错之后要判断的
					   正是「我问的是这句，它读成了这些，然后失败了」。 */
					<DeckSheet className="top-full">
						<Failure error={error} onRetry={onRetry} />
					</DeckSheet>
				)
			)}
		</header>
	);
}

/**
 * 从带子里浮出来的那一层：改写框和错误提示住在这里。
 *
 * 它是 `absolute`，所以带子的高度不变（`--deck-height` 的读者列在 styles.css
 * 那个令牌旁边）。不透明的画布色加一根发丝线，是因为名单要从它下面穿过去——
 * 这是同一条带的延续，不是新画的一块面。
 *
 * 里面封在版心里：零态的输入面读的是同一个数，所以改写框在两屏是同一块面，
 * 不是一个被拉到一千多像素宽的框。
 */
function DeckSheet({
	className,
	children,
}: {
	className: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"absolute inset-x-0 bg-canvas pt-2 pb-3",
				"before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64",
				className,
			)}
		>
			<div className="app-column">
				<div className="flex max-w-page flex-col gap-2">{children}</div>
			</div>
		</div>
	);
}

/**
 * 提交或理解整个失败了。那是页面级的事件，不是查询上的注解，所以是一块 `Alert`
 * 而不是一行小字——它下面那份名单此刻要么是空的、要么是上一次的。
 */
function Failure({ error, onRetry }: { error: string; onRetry?: () => void }) {
	return (
		<Alert variant="error">
			<AlertCircleIcon />
			<AlertDescription className="flex items-baseline gap-2">
				<span className="min-w-0 flex-1">{error}</span>
				{onRetry && (
					<Button
						className="shrink-0"
						onClick={onRetry}
						size="xs"
						variant="link"
					>
						<RotateCwIcon />
						重试
					</Button>
				)}
			</AlertDescription>
		</Alert>
	);
}
