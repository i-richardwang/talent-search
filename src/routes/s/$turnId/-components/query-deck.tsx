import { AlertCircleIcon, PencilIcon, RotateCwIcon } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { QueryBar } from "#/components/query-bar";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import {
	hasMeaning,
	type QueryInput,
	type SearchSpec,
	unsupportedOf,
	wideTerms,
} from "#/search/spec";
import { HEADER_QUERY_SLOT } from "../../../-components/app-header";
import { QueryChips } from "./query-chips";
import { QueryScope } from "./query-scope";

/** 从外面打开改写：键盘流的 `/`，以及空名单上那几条通向改写的出路。 */
export type QueryDeckHandle = { edit: () => void };

/**
 * 名单的抬头：**我问的那句话**，和系统把它读成的条件。
 *
 * 它不是一块面，也不吸顶。那句话是**只读的显示**：给它配上输入框那块面的材质，
 * 它就一边长成能打字的样子、一边点下去只弹出另一个框；把它吸在顶栏底下，则是
 * 把整屏最贵的那条横带包给一件永远不变的东西。
 * 同类产品在这里只有两种答案，没有第三种：要么它是**真的输入框**（Pin、
 * Remote：顶部那条永远能打字，不回显上一句），要么它是**标题**（Wellfound 的
 * 搜索名、Perplexity 的问题：纯文字加一颗小铅笔，输入框在别处）。这里选后者，
 * 因为这一屏的输入是**一次性**的——问完就该去读名单了。
 *
 * 于是三样东西顺着读下来，是一个从粗到细的抬头，而不是三条横带：
 *
 * 1. **那句话**（`rawText`）。这一屏的 h1，也是这条查询唯一完整的表示。
 *    改它就是改问题：想加条件在句子后面接着写，模型读错了就把那个词说清楚,
 *    两件事在用户那里本来就是同一个动作。
 * 2. **系统读成的条件**（chips + 范围）。那句话的解释，小一号，可以逐枚调强度、
 *    停用、删除——那是**微调**，快过重写整句。它不必独自扛起表达整个查询的
 *    责任：扛不动的部分，上面那句话扛着。
 * 3. 再往下是报数与图例（`result-list.tsx` 的 `ResultHeader`），回答的是
 *    「这份名单是什么」。它归名单，不归这里。
 *
 * 「换个看法」不在这里。筛选不改问题，只是在同一批候选里再看哪一部分，连查询
 * 记录都不产生（见 `routes/-lib/commit.ts` 开头）——「记录还是视图」是这个产品最要紧的
 * 一条界线，屏幕上由位置说出来：这块抬头里的动作会派生新记录，名单左边那条
 * 筛选栏（`filter-rail.tsx`）只动 URL。两者共用一块面的话，这条界线就只剩
 * 文案在扛。
 *
 * 常驻由顶栏接手。抬头会跟着名单一起滚走，而「我现在搜的是什么」必须一直在，
 * 所以它滚出视野之后，顶栏中间那一格里出现同一句话的一行缩略
 * （`HEADER_QUERY_SLOT`）。在顶上的时候它不出现——两处同时说同一句话，就是
 * 又一次把一件事说了两遍。
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
	 * 的抬头：整格空着，条件由下面那排 chips 自己说。
	 */
	rawText: string | null;
	error: string | null;
	/** 理解失败时的重试动作。 */
	onRetry?: () => void;
}) {
	const unsupported = unsupportedOf(spec);
	const settled = hasMeaning(spec) && !interpreting;
	const [editing, setEditing] = useState(false);
	const headline = useRef<HTMLDivElement>(null);
	const [slot, setSlot] = useState<HTMLElement | null>(null);
	const [scrolledPast, setScrolledPast] = useState(false);

	useImperativeHandle(ref, () => ({ edit: () => setEditing(true) }));

	// 抬头滚到顶栏底下了没有。观察的是那句话所在的那一格（改写时是输入框，
	// 位置一样），不是整块抬头：下面的 chips 和脚注滚走无所谓，走掉之后
	// 需要一个替身的只有那句话。
	useEffect(() => {
		const head = headline.current;
		const target = document.getElementById(HEADER_QUERY_SLOT);
		if (!head || !target) return;
		setSlot(target);
		/*
		 * 顶栏的高度从顶栏本身量出来，不在这里再抄一份 `--header-height`：
		 * 抄下来的那一份不受任何检查保护，改一次顶栏高度，替身就会早出现或
		 * 晚出现一小段，而没有任何东西会红。
		 */
		const top = target.closest("header")?.offsetHeight ?? 0;
		const io = new IntersectionObserver(
			([entry]) => setScrolledPast(entry ? !entry.isIntersecting : false),
			{ rootMargin: `-${top}px 0px 0px 0px` },
		);
		io.observe(head);
		return () => io.disconnect();
	}, []);

	return (
		/*
		 * **整个工作区那么宽**，不是中间那一栏的抬头。
		 *
		 * 左筛选栏和右详情面板都在这条查询**之内**：左边筛的是这条查询的结果，
		 * 右边看的是这份结果里的某一个人，两者都只动 URL 上的视图参数，不产生新的
		 * 查询记录。而改这句话会派生一条新记录——「记录还是视图」这条界线在屏幕上
		 * 由位置说出来（见 `routes/-lib/commit.ts` 开头），那就不能把父级和它的两个子级
		 * 并排摆成三栏的抬头。摆成三栏之后要做的第一件事必然是「让三栏起始高度
		 * 对齐」，而那正是在替一个错的层级关系描边。
		 *
		 * 于是这一页是三层：顶栏（应用身份，跨查询）、这条带（这一页是什么）、
		 * 三栏（在这一页里看哪一部分、哪一个人）。
		 *
		 * 不画下边框。一条横线加两条竖线就是「三栏铺满、发丝线切开」的后台形状
		 * （见 `s/$turnId/route.tsx` 开头），分层交给留白，以及三栏各自那条边线
		 * 从这条带**下面**才开始这件事本身。
		 *
		 * `app-column` 是顶栏用的那个盒子：于是这句话的左沿和顶栏那个应用名同线，
		 * 也和左栏里每一行选项的左沿同线。和名单卡片共边是同一栏里的事，而这条带
		 * 管着的正是包含那一栏在内的三栏。
		 */
		<header className="app-column flex flex-col gap-3 py-4">
			{/*
			 * 这一格的两态位置相同：读的时候是标题，改的时候原地长成输入框。
			 * `scroll-mt` 让顶栏那行替身把人送回来时，标题停在顶栏**下沿**，
			 * 而不是钻到它底下。
			 */}
			<div className="scroll-mt-(--header-height)" ref={headline}>
				{editing ? (
					<QueryBar
						initial={rawText ?? ""}
						onCancel={() => setEditing(false)}
						onQuery={onQuery}
					/>
				) : (
					rawText && (
						/* `w-fit`：这一行只占这句话那么宽，铅笔于是紧跟在句末。
						   撑满整条带的话，铅笔会被推到一千像素之外的右端——那正是
						   一块只读的面留下的那种死白。 */
						<div className="flex w-fit max-w-full items-start gap-1">
							{/*
							 * 标题是**文字**，铅笔才是按钮。整行做成一颗按钮的话，
							 * 悬停时那条通栏发亮的灰底会让它重新读成一个能打字的
							 * 框——而它是只读的。
							 *
							 * 字号只上到 17（`title-2`）——汉字系统字没有拉丁 display
							 * 字那种放大之后还成立的字形，这句话的重量由它独占整条
							 * 带、上下留白和左边缘与顶栏同线给出，不由字号硬撑。
							 *
							 * 全宽的带子里正文仍然要有度量：17px 的汉字排到一千多
							 * 像素是没法读的一行，所以封在版心那个数上——名单和
							 * 零态的输入面读的也是它。
							 */}
							<h1 className="title-2 min-w-0 max-w-page text-pretty font-medium">
								{rawText}
							</h1>
							{interpreting ? (
								/* 理解中显示的仍是这句话，不是占位方块——下面那一格
								   接下来会变成 chips，而 chips 正是从它翻译出来的。 */
								<span
									className="shrink-0 py-1 text-muted-foreground text-xs"
									role="status"
								>
									正在理解…
								</span>
							) : (
								<Button
									aria-label="改写这句话"
									className="shrink-0"
									onClick={() => setEditing(true)}
									size="icon-sm"
									variant="ghost"
								>
									<PencilIcon />
								</Button>
							)}
						</div>
					)
				)}
			</div>

			{settled && (
				<>
					{/* chips 和范围排在同一行里：它们都是「系统读成的条件」，
					    分成两条横带只会让人以为那是两类东西。 */}
					<div className="flex flex-wrap items-center gap-1.5">
						<QueryChips
							onChange={(evidence) => onChangeSpec({ ...spec, evidence })}
							query={spec.evidence}
							wide={new Set(wideTerms(spec))}
						/>
						<QueryScope
							onChange={(scope) => onChangeSpec({ ...spec, scope })}
							scope={spec.scope}
						/>
					</div>

					{/*
					 * 没处放的条件是这几枚 chip 的脚注：用户写了「北京的」，
					 * 屏幕上的条件里没有它，不说一句的话他会以为它生效了。
					 */}
					{unsupported.length > 0 && (
						<Footnote>
							「{unsupported.join("」「")}」暂不支持作为条件，本次未生效。
						</Footnote>
					)}
				</>
			)}

			{/* 提交或理解整个失败了，那是页面级的事件，不是查询上的注解 */}
			{error && (
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
			)}

			{/*
			 * 滚下去之后顶栏里的那行替身。它只回答「我现在搜的是什么」，点它把人
			 * 送回抬头并展开改写——顶栏里不放第二个能改查询的地方，那句话只有
			 * 一个改写入口，在它自己身上。
			 */}
			{slot &&
				scrolledPast &&
				rawText &&
				createPortal(
					<Button
						className="min-w-0 max-w-full justify-start font-normal text-muted-foreground"
						onClick={() => {
							setEditing(true);
							headline.current?.scrollIntoView({ block: "start" });
						}}
						size="sm"
						title="改写这句话"
						variant="ghost"
					>
						<span className="truncate">{rawText}</span>
						<PencilIcon className="shrink-0" />
					</Button>,
					slot,
				)}
		</header>
	);
}

/** 关于这几枚 chip 的一行小字。图标对齐第一行基线，长句照常换行。 */
function Footnote({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-baseline gap-1.5 text-muted-foreground text-xs">
			<AlertCircleIcon className="size-3.5 shrink-0 translate-y-0.5 text-warning" />
			<span className="min-w-0 flex-1">{children}</span>
		</div>
	);
}
