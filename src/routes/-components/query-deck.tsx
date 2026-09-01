import { AlertCircleIcon, RotateCwIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "#/components/ui/alert";
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
 * 顺序就是句子的顺序——先说要找什么（输入框），再逐项调整（chips），
 * 最后收窄范围（筛选）。整块吸顶：名单可以滚很长，而「我现在搜的是什么」必须一直在。
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
		 * 吸顶层的底是半透明加模糊：名单从它下面穿过去，实色底会把那一下切得很硬，
		 * 滚到一半的卡片在一条看不见的线上凭空消失。
		 */
		<div className="sticky top-0 z-stick border-border/70 border-b bg-canvas/85 backdrop-blur-md">
			<div className="mx-auto w-full max-w-page px-4 py-3">
				<QueryBar inputRef={inputRef} onQuery={onQuery} variant="header" />
				{(hasQuery || interpreting) && (
					<div className="mt-2.5 flex items-start gap-4">
						<div className="flex min-w-0 flex-1 flex-col gap-2">
							{/*
							 * 理解中显示的是用户自己那句话，不是占位方块——这一格接下来
							 * 会变成 chips，而 chips 正是从这句话翻译出来的。
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
									 * 范围条件排在概念条件下面，不并排：chips 决定「找谁」，
									 * 筛选决定「在这批人里再看哪一部分」。并排会让人以为删一枚
									 * chip 和取消一个筛选是同一量级的动作，而前者会换掉整份名单。
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
						 * 人数钉在右上角，和 chips 第一行齐平：排在 chips 后面的话每加一个
						 * 条件它就横着挪一次，而这是整块里唯一需要盯着看的数。
						 * 没有概念词就不报数——0 是个确定的答案，而这里还没有问题可答。
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
										{/* 一份排过序的名单必须说出自己按什么排，
										    否则「从上往下看」这个动作没有依据。 */}
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
				 * 降级必须说出来。规则解析读不出语气，「最好」「不要」会被一律判成必须词——
				 * 结果是错的而 chips 看起来完全正常。只在服务端记一行日志不算说出来：
				 * 拿到错结果的人不看日志。给的是可执行的一步，不是一句道歉。
				 */}
				{degraded && !interpreting && (
					<Alert className="mt-2.5" variant="warning">
						<AlertCircleIcon />
						<AlertDescription>
							未能识别这句话里的语气，「最好」「不要」都已按必须条件处理。
						</AlertDescription>
						{onReinterpret && (
							<AlertAction>
								<Button onClick={onReinterpret} size="xs" variant="outline">
									<RotateCwIcon />
									重新理解
								</Button>
							</AlertAction>
						)}
					</Alert>
				)}

				{error && (
					<Alert className="mt-2.5" variant="error">
						<AlertCircleIcon />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
			</div>
		</div>
	);
}
