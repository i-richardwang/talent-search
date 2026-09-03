import { AlertCircleIcon, PencilIcon, RotateCwIcon } from "lucide-react";
import { useImperativeHandle, useState } from "react";
import { QueryBar } from "#/components/query-bar";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Frame, FramePanel } from "#/components/ui/frame";
import {
	fellBack,
	hasMeaning,
	type QueryInput,
	type SearchSpec,
	unsupportedOf,
} from "#/search/spec";
import { QueryChips } from "./query-chips";
import { QueryScope } from "./query-scope";

/** 从外面打开改写：键盘流的 `/`，以及空名单上那条「改一改」的出路。 */
export type QueryDeckHandle = { edit: () => void };

/**
 * 查询台：这一屏**唯一**的操作面。整块吸顶——名单可以滚很长，而「我现在搜的
 * 是什么」必须一直在。
 *
 * 上面摆着两样东西，它们不是两条平级的横带，是**两层**：
 *
 * 1. **我问的那句话**（`rawText`）。它是这条查询的门面，也是唯一完整的表示——
 *    点一下就地展开成输入框，改完回车派生一条新记录。想加条件就在句子后面
 *    接着写，模型读错了就把那个词说清楚：两件事在用户那里本来就是同一个动作
 *    「改我的问题」，不该在屏幕上拆成两个口。
 * 2. **系统读成的条件**（chips + 范围）。它是那句话的解释，小一号，可以逐枚
 *    调强度、停用、删除——那是**微调**，快过重写整句。它不必独自扛起表达
 *    整个查询的责任：扛不动的部分，上面那句话扛着。
 * 「换个看法」不在这里。筛选不改问题，只是在同一批候选里再看哪一部分，连查询
 * 记录都不产生（见 `-lib/commit.ts` 开头）——「记录还是视图」是这个产品最要紧的
 * 一条界线，屏幕上由位置说出来：这块面里的动作会派生新记录，名单左边那条筛选栏
 * （`filter-rail.tsx`）只动 URL。两者共用一块面的话，这条界线就只剩文案在扛。
 *
 * 报数不在这里。「N 人 · 按相关度排序」回答的是「这份名单是什么」，所以它是名单的
 * 表头（`result-list.tsx` 的 `ResultHeader`），不是这块操作面上的一个角。
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
	onReinterpret,
}: {
	/** 查询条件，来自这条查询记录。理解完成之前是空的。 */
	spec: SearchSpec;
	onChangeSpec: (next: SearchSpec) => void;
	/** 改写这句话，派生一条新记录 */
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	ref: React.Ref<QueryDeckHandle>;
	/** 还在等模型把这句话翻译成条件 */
	interpreting: boolean;
	/** 这条查询在问的那句话。只有点词汇表落下的记录没有。 */
	rawText: string | null;
	error: string | null;
	/** 理解失败时的重试动作。 */
	onRetry?: () => void;
	/** 降级之后拿原话再跑一次模型。同一句话，不是新问题，所以不走改写。 */
	onReinterpret?: () => void;
}) {
	const degraded = fellBack(spec);
	const unsupported = unsupportedOf(spec);
	const settled = hasMeaning(spec) && !interpreting;
	const [editing, setEditing] = useState(false);

	useImperativeHandle(ref, () => ({ edit: () => setEditing(true) }));

	return (
		/*
		 * 吸顶层的底是半透明加模糊：名单从它下面穿过去，实色底会把那一下切得很硬，
		 * 滚到一半的卡片在一条看不见的线上凭空消失。托盘给这块面画出边界，把上面
		 * 那两层圈在一起；提交失败那条 Alert 落在托盘外面、这一层的底上，因为它
		 * 说的不是这次查询是什么，是这一步没走成。
		 */
		<div className="sticky top-(--header-height) z-stick bg-canvas/85 backdrop-blur-md">
			<div className="mx-auto flex w-full max-w-page flex-col gap-2 px-4 py-2.5">
				<Frame>
					<FramePanel className="flex flex-col gap-2.5 p-2.5">
						{editing ? (
							<QueryBar
								initial={rawText ?? ""}
								onCancel={() => setEditing(false)}
								onQuery={onQuery}
							/>
						) : (
							rawText && (
								/*
								 * 一整行都能点：这句话本身就是「点我改我」的靶子，
								 * 旁边再摆一颗按钮等于把一件事分成看的和点的两半。
								 * 铅笔只是记号，不是唯一的落点。
								 */
								<Button
									className="w-full justify-start"
									disabled={interpreting}
									onClick={() => setEditing(true)}
									title="改写这句话"
									variant="ghost"
								>
									<span className="truncate">{rawText}</span>
									{interpreting ? (
										/* 理解中显示的仍是这句话，不是占位方块——下面那一格
										   接下来会变成 chips，而 chips 正是从它翻译出来的。 */
										<span
											aria-live="polite"
											className="ms-auto shrink-0 font-normal text-muted-foreground text-xs"
											role="status"
										>
											正在理解…
										</span>
									) : (
										<PencilIcon className="ms-auto text-muted-foreground" />
									)}
								</Button>
							)
						)}

						{settled && (
							<>
								<QueryChips
									chips={spec.evidence}
									onChange={(evidence) => onChangeSpec({ ...spec, evidence })}
								/>
								<QueryScope
									onChange={(scope) => onChangeSpec({ ...spec, scope })}
									scope={spec.scope}
								/>

								{/*
								 * 没处放的条件是这几枚 chip 的脚注：用户写了「北京的」，
								 * 屏幕上的条件里没有它，不说一句的话他会以为它生效了。
								 */}
								{unsupported.length > 0 && (
									<Footnote>
										「{unsupported.join("」「")}」暂不支持作为条件，本次未生效。
									</Footnote>
								)}
								{/*
								 * 降级必须说出来。规则解析读不出语气，「最好」「不要」会被一律
								 * 判成必须词——结果是错的而 chips 看起来完全正常。只在服务端记
								 * 一行日志不算说出来：拿到错结果的人不看日志。
								 *
								 * 但它同样是**关于这几枚 chip 的一条脚注**，不是页面级事件，
								 * 所以是一行小字，不是一整块 amber 的 Alert——满宽的警示块会
								 * 成为整屏第二重的东西，为的却是一句注解。
								 */}
								{degraded && (
									<Footnote>
										未能识别这句话里的语气，「最好」「不要」都已按必须条件处理。
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
									</Footnote>
								)}
							</>
						)}
					</FramePanel>
				</Frame>

				{/* 提交或理解整个失败了，那是页面级的事件，不是查询上的注解 */}
				{error && (
					<Alert variant="error">
						<AlertCircleIcon />
						<AlertDescription className="flex items-baseline gap-2">
							<span className="min-w-0 flex-1">{error}</span>
							{onRetry && (
								<Button
									className="h-auto shrink-0 p-0 text-xs"
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
			</div>
		</div>
	);
}

/** 关于这几枚 chip 的一行小字。图标对齐第一行基线，长句照常换行。 */
function Footnote({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex items-baseline gap-1.5 px-1 text-muted-foreground text-xs">
			<AlertCircleIcon className="size-3.5 shrink-0 translate-y-0.5 text-warning" />
			<span className="min-w-0 flex-1">{children}</span>
		</div>
	);
}
