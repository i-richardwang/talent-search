import { AlertCircleIcon, RotateCwIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { Chip, QueryInput } from "#/search/parse";
import type { TermPlan } from "#/search/result";
import type { FilterField } from "../-lib/filters";
import type { View } from "../-lib/view-params";
import { FilterBar } from "./filter-bar";
import { QueryBar } from "./query-bar";
import { QueryChips } from "./query-chips";

/**
 * 查询台：这一屏**唯一**的操作面。
 *
 * 输入框、chips、筛选全在这里，因为它们回答的是同一个问题：这次要找什么人。
 * 拆到三个容器里去摆，代价是每改一个条件都得先找到它住在哪儿。
 *
 * 顺序就是句子的顺序：**先说要找什么**（输入框），**再逐项调整**（chips），
 * **最后收窄范围**（筛选）。三行从上到下，越往下越次要，字号和颜色也跟着降。
 *
 * 整块吸顶：名单可以滚很长，而「我现在搜的是什么」必须一直在。
 */
export function QueryDeck({
	total,
	terms,
	chips,
	onChangeQuery,
	onQuery,
	inputRef,
	loading,
	interpreting,
	rawText,
	degraded,
	error,
	onReinterpret,
	fields,
	view,
	onChangeView,
	strongCount,
}: {
	total: number;
	terms: TermPlan[];
	/** 查询条件，来自这条查询记录。理解完成之前是空的。 */
	chips: Chip[];
	onChangeQuery: (next: Chip[]) => void;
	/** 往当前查询上再加一句话，派生一条新记录 */
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	inputRef: React.RefObject<HTMLInputElement | null>;
	/** 检索中不报数：下面是骨架屏，这里再挂一个上一次查询的确定值就是自相矛盾 */
	loading: boolean;
	/** 还在等模型把这句话翻译成条件 */
	interpreting: boolean;
	/** 用户敲的原话。有它才谈得上「重新理解」。 */
	rawText: string | null;
	/** 这次理解退回了本地规则解析，语气没人翻译 */
	degraded: boolean;
	error: string | null;
	/** 拿原话再理解一次，落成一条新记录。没有原话时不给这个入口。 */
	onReinterpret?: () => void;
	fields: FilterField[];
	view: View;
	onChangeView: (next: Partial<View>) => void;
	strongCount: number;
}) {
	const hasQuery = terms.length > 0 || chips.length > 0;

	return (
		/*
		 * 吸顶层的底不是实色，是**半透明加模糊**。
		 *
		 * 单列布局里名单是从它下面穿过去的，实色底会把那一下切得很硬：滚到
		 * 一半的候选人卡片在一条看不见的线上凭空消失。半透明让被压住的内容
		 * 仍然透出一点，读起来是「它在下面走过去」而不是「它被裁掉了」。
		 *
		 * 底边的发丝线只在滚下去之后才需要，但「滚没滚」要挂滚动监听才知道，
		 * 而那是一个每帧都在跑的监听换一条线。这里直接常驻——模糊层本身已经
		 * 把边界说得够清楚，线只是收口。
		 */
		<div className="sticky top-0 z-stick border-border/70 border-b bg-canvas/85 backdrop-blur-md">
			<div className="mx-auto w-full max-w-page px-4 py-3">
				<QueryBar inputRef={inputRef} onQuery={onQuery} variant="header" />

				{(hasQuery || interpreting) && (
					<div className="mt-2.5 flex items-start gap-4">
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							{/*
							 * 理解中显示的是**用户自己那句话**，不是一排占位方块。
							 *
							 * 这一格接下来会变成 chips，而 chips 正是从这句话翻译出来的；
							 * 先把原话摆在它们将要出现的位置上，等待期间人看到的就是
							 * 「我说的话在这儿，正在被拆成条件」，而不是「界面在转圈」。
							 */}
							{interpreting ? (
								<span
									aria-live="polite"
									className="flex min-w-0 items-center gap-2"
									role="status"
								>
									<span className="truncate text-sm">{rawText}</span>
									<span className="shrink-0 text-muted-foreground text-xs">
										正在理解…
									</span>
								</span>
							) : (
								<>
									<QueryChips
										chips={chips}
										onChange={onChangeQuery}
										terms={terms}
									/>
									{/*
									 * 范围条件排在概念条件下面，不是并排。
									 *
									 * 它们回答的问题不同档：chips 决定「找谁」，筛选决定
									 * 「在这批人里再看哪一部分」。后者依赖前者，混在一行里
									 * 会让人以为删掉一枚 chip 和取消一个筛选是同一量级的
									 * 动作——而前者会换掉整份名单。
									 */}
									{hasQuery && (
										<FilterBar
											fields={fields}
											onChange={onChangeView}
											strongCount={strongCount}
											view={view}
										/>
									)}
								</>
							)}
						</div>

						{/*
						 * 人数钉在右上角，和 chips 的第一行齐平。
						 *
						 * 它不能排在 chips 后面：每加一个条件它就横着挪一次，而这是
						 * 整块里唯一需要盯着看的数。位置固定，值才读得出变化。
						 *
						 * 没有概念词就不报数：0 是个确定的答案，而这里根本还没有
						 * 问题可答。
						 */}
						{(loading || terms.length > 0) && (
							<span
								aria-live="polite"
								className="shrink-0 pt-0.5 text-right"
								role="status"
							>
								{loading ? (
									<span className="text-muted-foreground text-sm">搜索中…</span>
								) : (
									<>
										<span className="flex items-baseline justify-end gap-1.5">
											<b className="title-2 tabular-nums">{total}</b>
											<span className="text-muted-foreground text-xs">人</span>
										</span>
										{/*
										 * 排序依据紧跟在数下面，不是只在结果被截断时才在页脚
										 * 出现一次：这是一份**排过序的**名单，而排序规则决定了
										 * 「从上往下看」这个动作有没有意义。名单上那一列名次
										 * 只说明「有顺序」，说明不了「按什么排」。
										 */}
										<span className="block text-muted-foreground text-xs">
											按相关度排序
										</span>
									</>
								)}
							</span>
						)}
					</div>
				)}

				{/*
				 * 降级必须说出来。
				 *
				 * 模型不可用时服务端退回本地规则解析，而规则解析读不出语气：
				 * 「最好带过团队、不要实习」里的两个限定会被一律判成必须词。结果是
				 * 错的，而屏幕上那几枚 chip 看起来完全正常——这正是「不静默降级」
				 * 这条产品原则要挡住的东西。只在服务端记一行日志不算说出来：
				 * 拿到错结果的人不看日志。
				 *
				 * 给的是可执行的一步（重新理解），不是一句道歉。
				 */}
				{degraded && !interpreting && (
					<div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
						<AlertCircleIcon className="size-3.5 shrink-0 text-warning" />
						<span className="text-muted-foreground text-xs">
							未能识别这句话里的语气，「最好」「不要」都已按必须条件处理。
						</span>
						{onReinterpret && (
							<Button onClick={onReinterpret} size="xs" variant="ghost">
								<RotateCwIcon />
								重新理解
							</Button>
						)}
					</div>
				)}

				{error && (
					<p className="mt-2 text-destructive-foreground text-xs" role="alert">
						{error}
					</p>
				)}
			</div>
		</div>
	);
}
