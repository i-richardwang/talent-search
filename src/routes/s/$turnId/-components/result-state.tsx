import { Link } from "@tanstack/react-router";
import {
	MessageSquareWarningIcon,
	RotateCwIcon,
	SearchXIcon,
} from "lucide-react";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { Text } from "#/components/ui/text";
import type { EmptyReason } from "#/search/empty";
import type { QueryCondition } from "#/search/query";
import type { SearchOutcome } from "#/search/result";
import { queryOfSpec, type SearchSpec } from "#/search/spec";
import type { AttemptFault, SearchMode } from "#/server/turn";
import { FAULT_COPY, FAULT_EXIT_LABEL, faultExits } from "../-lib/attempt";
import { ELAPSED_SHOW_AFTER_MS, lasting, useElapsed } from "../-lib/elapsed";
import { emptyState } from "../-lib/empty-state";
import type { ListWait, SearchPhase } from "../-lib/nav-phase";
import type { View } from "../-lib/view-params";

const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按匹配度排序",
	employee: "默认顺序",
};

/**
 * 名单的表头：这份名单有多少人、按什么排。等待时这一格写在做什么；名单上已有的人照常成立、
 * 只是还在补人时（`keep`），人数照写，后面跟着在做什么。
 */
export function ResultHeader({
	wait,
	order,
	total,
}: {
	wait: ListWait | null;
	order: SearchOutcome["order"];
	total: number;
}) {
	const counted = !wait || (wait.list === "keep" && total > 0);
	return (
		<p className="flex min-w-0 items-center gap-1" role="status">
			{counted && (
				<>
					<span className="tabular-nums">{total.toLocaleString()}</span>
					{` 人 · ${ORDER_LABEL[order]}`}
				</>
			)}
			{counted && wait && " · "}
			{wait && (
				<Waiting key={wait.phase} phase={wait.phase} since={wait.since} />
			)}
		</p>
	);
}

/** 请 HR 自己再说一句时按钮上的字：对话里是补充一句，关键词是去改框里的词。 */
const SAY_LABEL: Record<SearchMode, string> = {
	conversation: "去补充一句",
	keyword: "去改关键词",
};

export function NoResults({
	reason,
	spec,
	mode,
	onChange,
	onReviseQuery,
	onEditQuery,
	onSay,
	onContinue,
}: {
	reason: EmptyReason;
	spec: SearchSpec;
	mode: SearchMode;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: QueryCondition[]) => unknown;
	/** 光标进输入框；对话的输入框换上示范说法。没有地方可写时不给。 */
	onEditQuery?: (example?: string) => void;
	onSay?: (text: string) => unknown;
	onContinue?: () => unknown;
}) {
	const { title, hint, next } = emptyState(reason, {
		mode,
		conditions: queryOfSpec(spec).conditions,
		onChange,
		onContinue,
		onReviseQuery,
		onSay,
		canSay: onEditQuery !== undefined,
	});
	return (
		<Empty
			action={
				next &&
				(next.kind === "act" ? (
					/* 筛掉了所有人时下一步是清掉筛选，一次撤回，不是主操作 */
					<Button
						onClick={next.onClick}
						type={reason.kind === "filtered" ? "default" : "primary"}
					>
						{next.label}
					</Button>
				) : (
					/* 按下去名单不会变，只是去输入框：不做主操作 */
					<Button onClick={() => onEditQuery?.(next.example)}>
						{SAY_LABEL[mode]}
					</Button>
				))
			}
			size="large"
			description={hint}
			icon={SearchXIcon}
			title={title}
		/>
	);
}

/**
 * AI 没处理成，名单上又没有人可看：一句话没理解出来，或者改完条件、要补的人没补上而名单是
 * 空的。名单那一列就停在这里——不是一份空名单：空名单在这个界面里的意思是「没有这样的人」。
 * 说的是哪个环节出了问题（`FAULT_COPY`），连不上时不能说成这句话没读懂。重试放在这里而不是
 * 右栏：窄屏上右栏是收着的，名单这一列总在眼前。
 */
export function ListFailed({
	fault,
	onRetry,
}: {
	fault: AttemptFault;
	onRetry: () => unknown;
}) {
	const copy = FAULT_COPY[fault];
	const exits = faultExits(fault);
	return (
		<Empty
			action={
				exits.length > 0 &&
				exits.map((exit) =>
					exit === "retry" ? (
						<Button
							icon={RotateCwIcon}
							key={exit}
							onClick={onRetry}
							type="primary"
						>
							{FAULT_EXIT_LABEL[exit]}
						</Button>
					) : (
						<Button
							key={exit}
							render={<Link search={{ mode: "keyword" }} to="/" />}
							type="text"
						>
							{FAULT_EXIT_LABEL[exit]}
						</Button>
					),
				)
			}
			size="large"
			description={copy.hint}
			icon={MessageSquareWarningIcon}
			title={copy.title}
		/>
	);
}

const PHASE_TEXT: Record<SearchPhase, string> = {
	understanding: "正在理解你的需求…",
	searching: "正在搜索…",
	completing: "正在补充符合条件的人…",
};

/** 在做什么，后面跟已等的秒数。每一步重新计：调用处按 `phase` 换 key。 */
function Waiting({
	phase,
	since,
}: {
	phase: SearchPhase;
	since: number | null;
}) {
	const elapsed = useElapsed(since);
	return (
		<>
			<Text shiny>{PHASE_TEXT[phase]}</Text>
			{elapsed >= ELAPSED_SHOW_AFTER_MS && (
				<Text className="tabular-nums" type="tertiary">
					（{lasting(elapsed)}）
				</Text>
			)}
		</>
	);
}
