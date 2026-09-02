import { AlertCircleIcon, RotateCwIcon } from "lucide-react";
import { useState } from "react";
import { QueryBar } from "#/components/query-bar";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Frame, FramePanel } from "#/components/ui/frame";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "#/components/ui/input-group";
import {
	fellBack,
	hasMeaning,
	type QueryInput,
	type SearchSpec,
	unsupportedOf,
} from "#/search/spec";
import type { FilterField, TextFilter } from "../-lib/filters";
import type { View } from "../-lib/view-params";
import { FilterBar } from "./filter-bar";
import { QueryChips } from "./query-chips";
import { QueryScope } from "./query-scope";

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
	spec,
	onChangeSpec,
	onQuery,
	inputRef,
	interpreting,
	rawText,
	error,
	onRetry,
	onReinterpret,
	onCorrect,
	fields,
	textFilters,
	view,
	onChangeView,
	strongCount,
}: {
	/** 查询条件，来自这条查询记录。理解完成之前是空的。 */
	spec: SearchSpec;
	onChangeSpec: (next: SearchSpec) => void;
	/** 往当前查询上再加一句话，派生一条新记录 */
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	inputRef: React.RefObject<HTMLInputElement | null>;
	/** 还在等模型把这句话翻译成条件 */
	interpreting: boolean;
	/** 用户敲的原话。有它才谈得上「重新理解」。 */
	rawText: string | null;
	error: string | null;
	/** 理解失败时的重试动作。 */
	onRetry?: () => void;
	/** 拿原话再理解一次，落成一条新记录。没有原话时不给这个入口。 */
	onReinterpret?: () => void;
	/**
	 * 纠正理解：带着一句补充说明重新理解原话。和 `onReinterpret` 不是一回事——
	 * 那个是降级后的重跑（第一次模型没参与，再试一次是真的可能不同），这个是
	 * 「模型理解错了」的出路：同一句话原样重问只会拿回同一份错的理解，
	 * 用户手里那句「算法指的是推荐算法」才是模型缺的东西。
	 */
	onCorrect?: (note: string) => boolean | Promise<boolean>;
	fields: FilterField[];
	/** 已生效的公司名 / 学校名条件 */
	textFilters: TextFilter[];
	view: View;
	onChangeView: (next: Partial<View>) => void;
	strongCount: number;
}) {
	const chips = spec.evidence;
	const degraded = fellBack(spec);
	const unsupported = unsupportedOf(spec);
	const hasQuery = hasMeaning(spec);
	// 纠正框收在一个入口后面：它是偶发动作，常驻一个输入框会和上面那个
	// 「添加条件」的框摆成两个平级的口，而两者的分量差着一个量级。
	const [correcting, setCorrecting] = useState(false);
	const [note, setNote] = useState("");
	const [sending, setSending] = useState(false);
	const closeCorrection = () => {
		setCorrecting(false);
		setNote("");
	};

	return (
		/*
		 * 吸顶层的底是半透明加模糊：名单从它下面穿过去，实色底会把那一下切得很硬，
		 * 滚到一半的卡片在一条看不见的线上凭空消失。下面的托盘承担这一层的
		 * 唯一边界，整块操作面因此保持一个轮廓。
		 */
		<div className="sticky top-0 z-stick bg-canvas/85 backdrop-blur-md">
			<div className="mx-auto w-full max-w-page px-4 py-2.5">
				<Frame>
					<FramePanel className="flex flex-col gap-2.5 p-2.5">
						<QueryBar
							disabled={interpreting}
							inputRef={inputRef}
							onQuery={onQuery}
							variant="header"
						/>
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
										onChange={(evidence) => onChangeSpec({ ...spec, evidence })}
										trailing={
											onCorrect &&
											!correcting && (
												<Button
													className="h-auto p-0 text-muted-foreground text-xs"
													onClick={() => setCorrecting(true)}
													size="xs"
													variant="link"
												>
													理解得不对？
												</Button>
											)
										}
									/>
									<QueryScope
										onChange={(scope) => onChangeSpec({ ...spec, scope })}
										scope={spec.scope}
									/>
									{onCorrect && correcting && (
										<form
											className="flex items-center gap-1.5"
											onSubmit={async (e) => {
												e.preventDefault();
												const n = note.trim();
												if (!n || sending) return;
												setSending(true);
												try {
													// 成功才清空：这一步会失败，失败还把人刚敲的
													// 说明吞掉，就连重试都没得重试
													if (await onCorrect(n)) {
														closeCorrection();
													}
												} finally {
													setSending(false);
												}
											}}
										>
											<InputGroup className="flex-1">
												<InputGroupInput
													aria-label="纠正对这句话的理解"
													autoFocus
													onChange={(e) => setNote(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === "Escape" && !sending)
															closeCorrection();
													}}
													placeholder="哪里理解错了？补一句说明，例如：算法指的是推荐算法"
													value={note}
												/>
												<InputGroupAddon align="inline-end">
													<Button
														disabled={!note.trim()}
														loading={sending}
														render={<button type="submit" />}
														size="xs"
														variant="secondary"
													>
														<RotateCwIcon />
														重新理解
													</Button>
												</InputGroupAddon>
											</InputGroup>
											<Button
												disabled={sending}
												onClick={closeCorrection}
												size="xs"
												variant="ghost"
											>
												取消
											</Button>
										</form>
									)}
									{/*
									 * URL 视图筛选排在查询条件下面：上面改的是问题本身，下面只是
									 * 换一种看法。两者不并排，避免把派生新记录和改当前视图读成
									 * 同一量级的动作。
									 */}
									<FilterBar
										fields={fields}
										onChange={onChangeView}
										strongCount={strongCount}
										textFilters={textFilters}
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
						{/*
						 * 没处放的条件同样是这几枚 chip 的脚注：用户写了「北京的」，
						 * 屏幕上的条件里没有它，不说一句的话他会以为它生效了。
						 */}
						{unsupported.length > 0 && !interpreting && (
							<div className="flex items-baseline gap-1.5 px-1 text-muted-foreground text-xs">
								<AlertCircleIcon className="size-3.5 shrink-0 translate-y-0.5 text-warning" />
								<span className="min-w-0 flex-1">
									「{unsupported.join("」「")}」暂不支持作为条件，本次未生效。
								</span>
							</div>
						)}
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
