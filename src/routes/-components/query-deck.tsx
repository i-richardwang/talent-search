import { AlertCircleIcon, RotateCwIcon } from "lucide-react";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Frame, FramePanel } from "#/components/ui/frame";
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
 * 顺序就是句子的顺序——先说要找什么（输入框），再逐项调整（chips），
 * 最后收窄范围（筛选）。整块吸顶：名单可以滚很长，而「我现在搜的是什么」必须一直在。
 *
 * 它是**一块面**（`Frame` 的浅底托盘 + 里面那块白面板），不是几条并排漂着的
 * 横带。三样东西左边缘都对齐在版心上、间距又都差不多的时候，眼睛读不出它们
 * 是一组还是各管各的；而这一屏里所有能操作的东西都在这块面上，它值得有个边界。
 * 托盘那一档比页底深、比卡片浅，于是操作面和结果面各是各的，不必再画一条线。
 *
 * 报数不在这里。「N 人 · 按相关度排序」回答的是「这份名单是什么」，所以它是名单的
 * 表头（`result-list.tsx` 的 `ResultHeader`），不是这块操作面上的一个角。
 */
export function QueryDeck({
	terms,
	chips,
	onChangeQuery,
	onQuery,
	inputRef,
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
	terms: TermPlan[];
	/** 查询条件，来自这条查询记录。理解完成之前是空的。 */
	chips: Chip[];
	onChangeQuery: (next: Chip[]) => void;
	/** 往当前查询上再加一句话，派生一条新记录 */
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	inputRef: React.RefObject<HTMLInputElement | null>;
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
		 * 吸顶层的底是半透明加模糊：名单从它下面穿过去，实色底会把那一下切得很硬，
		 * 滚到一半的卡片在一条看不见的线上凭空消失。分层到此为止，不再补一条
		 * `border-b`——下面那块托盘自己就是边界，两道边界画的是同一件事。
		 */
		<div className="sticky top-0 z-stick bg-canvas/85 backdrop-blur-md">
			<div className="mx-auto w-full max-w-page px-4 py-2.5">
				<Frame>
					<FramePanel className="flex flex-col gap-2.5 p-2.5">
						<QueryBar inputRef={inputRef} onQuery={onQuery} variant="header" />
						{interpreting ? (
							/*
							 * 理解中显示的是用户自己那句话，不是占位方块——这一格接下来
							 * 会变成 chips，而 chips 正是从这句话翻译出来的。
							 */
							<span
								aria-live="polite"
								className="flex min-w-0 items-center gap-2 px-1"
								role="status"
							>
								<span className="truncate text-sm">{rawText}</span>
								<span className="shrink-0 text-muted-foreground text-xs">
									正在理解…
								</span>
							</span>
						) : (
							hasQuery && (
								<>
									<QueryChips
										chips={chips}
										onChange={onChangeQuery}
										terms={terms}
									/>
									{/*
									 * 范围条件排在概念条件下面，不并排：chips 决定「找谁」，
									 * 筛选决定「在这批人里再看哪一部分」。并排会让人以为删一枚
									 * chip 和取消一个筛选是同一量级的动作，而前者会换掉整份名单。
									 */}
									<FilterBar
										fields={fields}
										onChange={onChangeView}
										strongCount={strongCount}
										view={view}
									/>
								</>
							)
						)}

						{/*
						 * 降级必须说出来。规则解析读不出语气，「最好」「不要」会被一律判成
						 * 必须词——结果是错的而 chips 看起来完全正常。只在服务端记一行日志
						 * 不算说出来：拿到错结果的人不看日志。给的是可执行的一步，
						 * 不是一句道歉。
						 *
						 * 但它是**关于这几枚 chip 的一条脚注**，不是页面级事件，所以是这块
						 * 面板里的一行小字，不是一整块 amber 的 Alert。满宽的警示块会成为
						 * 整屏第二重的东西，为的却是一句注解。
						 */}
						{degraded && !interpreting && (
							<div className="flex items-baseline gap-1.5 px-1 text-muted-foreground text-xs">
								<AlertCircleIcon className="size-3.5 shrink-0 translate-y-0.5 text-warning" />
								<span className="min-w-0 flex-1">
									未能识别这句话里的语气，「最好」「不要」都已按必须条件处理。
								</span>
								{onReinterpret && (
									<Button
										className="h-auto p-0 text-xs"
										onClick={onReinterpret}
										size="xs"
										variant="link"
									>
										<RotateCwIcon />
										重新理解
									</Button>
								)}
							</div>
						)}
					</FramePanel>
				</Frame>

				{/* 提交或理解整个失败了，那是页面级的事件，不是查询上的注解 */}
				{error && (
					<Alert className="mt-2" variant="error">
						<AlertCircleIcon />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
			</div>
		</div>
	);
}
