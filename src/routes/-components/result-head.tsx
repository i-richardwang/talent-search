import { Button, Text } from "@cloudflare/kumo";
import {
	ArrowClockwiseIcon,
	FunnelIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import type { Chip } from "#/search/parse";
import type { TermPlan } from "#/search/result";
import { QueryChips } from "./query-chips";

/**
 * 中栏顶上那一条：**这次检索的条件，和它的结果**。
 *
 * 条件那一半是 chips（query-chips.tsx），也是查询的操作面：表头只呈现列，
 * 输入框只添加条件，逐项修改集中在这里。
 *
 * 结果那一半是总人数和排序依据。不写「已排除 N 人」——那是左栏「匹配来源」
 * 后面那个数的另一种说法。整词退子串的提示属于**某一枚 chip**，
 * 长在那枚 chip 上，看到说明和动手改之间不隔一次寻找。
 *
 * 排序依据常驻在这里，不是只在截断时才在页脚出现一次：这是一张**排过序的**
 * 表，而排序规则决定了「从上往下看」这个动作有没有意义。
 *
 * 窄屏那个筛选把手仍然在（左栏在 xl 以下收起来了，得有个入口）。
 */
export function ResultHead({
	total,
	terms,
	chips,
	onChangeQuery,
	loading,
	interpreting,
	rawText,
	degraded,
	error,
	onReinterpret,
	activeFilters,
	onOpenFilters,
}: {
	total: number;
	terms: TermPlan[];
	/** 查询条件，来自这条查询记录。理解完成之前是空的。 */
	chips: Chip[];
	onChangeQuery: (next: Chip[]) => void;
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
	activeFilters: number;
	onOpenFilters: () => void;
}) {
	return (
		/*
		 * 这一条是面板的顶边，高度和顶栏、左栏的标题行都是 56px：三者在同一条
		 * 水平线上收口，界面才有一个「上沿」。
		 *
		 * 顶层不换行：chips 是可变长的，条件多的时候该在**它自己的框里**折行，
		 * 而不是把右边那个数挤到下一行去。查询的操作面（左）和结果的读数（右）
		 * 是两件事，位置必须是固定的。
		 */
		<div className="shrink-0 border-kumo-hairline border-b px-4 py-3">
			<div className="flex min-h-8 items-center gap-3">
				<Button
					className="shrink-0 xl:hidden"
					icon={FunnelIcon}
					onClick={onOpenFilters}
					size="sm"
					variant={activeFilters > 0 ? "secondary" : "ghost"}
				>
					筛选{activeFilters > 0 && ` · ${activeFilters}`}
				</Button>

				<div className="min-w-0 flex-1">
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
							<span className="truncate text-kumo-default text-sm">
								{rawText}
							</span>
							<Text as="span" size="xs" variant="secondary">
								正在理解…
							</Text>
						</span>
					) : (
						<QueryChips chips={chips} onChange={onChangeQuery} terms={terms} />
					)}
				</div>

				{/*
				 * 人数靠右，而且是**贴着右边缘**的一格，不是排在 chips 后面。
				 * 紧跟在 chips 后面的话，每加一个条件它就横着挪一次，而这是整条里
				 * 唯一需要盯着看的数。
				 *
				 * 没有概念词就不报数：0 是个确定的答案，而这里根本还没有问题可答。
				 */}
				{(loading || terms.length > 0) && (
					// ml-auto 挂在外层：Kumo 的 `Text` 刻意不收 className
					<span aria-live="polite" className="shrink-0" role="status">
						{loading ? (
							<Text as="span" size="base" variant="secondary">
								搜索中…
							</Text>
						) : (
							<span className="flex items-baseline gap-2">
								<Text as="span" size="base">
									共 <b className="tabular-nums">{total}</b> 人
								</Text>
								<Text as="span" size="xs" variant="secondary">
									按相关度排序
								</Text>
							</span>
						)}
					</span>
				)}
			</div>

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
					<WarningCircleIcon
						className="shrink-0 text-kumo-warning"
						size={14}
						weight="fill"
					/>
					<Text as="span" size="xs" variant="secondary">
						未能识别这句话里的语气，「最好」「不要」都已按必须条件处理。
					</Text>
					{onReinterpret && (
						<Button
							icon={ArrowClockwiseIcon}
							onClick={onReinterpret}
							size="xs"
							variant="ghost"
						>
							重新理解
						</Button>
					)}
				</div>
			)}

			{error && (
				<p className="mt-2 text-kumo-danger text-xs" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}
