import { Link } from "@tanstack/react-router";
import {
	MessageSquareWarningIcon,
	RotateCwIcon,
	SearchXIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { StrengthLegend } from "#/components/evidence";
import { Button } from "#/components/ui/button";
import { Empty } from "#/components/ui/empty";
import { Text } from "#/components/ui/text";
import type { Condition } from "#/search/condition";
import type { SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import type { InterpretFault, SearchMode } from "#/server/turn";
import { emptyState } from "../-lib/empty-state";
import { FAULT_COPY, FAULT_EXIT_LABEL, faultExits } from "../-lib/interpret";
import type { View } from "../-lib/view-params";

const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按匹配度排序",
	employee: "默认顺序",
};

/**
 * 名单的表头：这份名单有多少人、按什么排，有证据行时带上那三颗点的图例。等待时这一格
 * 换成在做什么。字跟着所在的表头（12px 中粗次要色），人数用等宽数字。
 */
export function ResultHeader({
	phase,
	order,
	total,
	evidence,
}: {
	/** 在等什么；null 时写人数和排序。 */
	phase: SearchPhase | null;
	order: SearchOutcome["order"];
	total: number;
	/** 名单上有证据行（或这一轮的条件会有）：图例才有点可对照。 */
	evidence: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
			<p className="flex items-center gap-1" role="status">
				{phase ? (
					<Waiting key={phase} phase={phase} />
				) : (
					<>
						<span className="tabular-nums">{total.toLocaleString()}</span>
						{` 人 · ${ORDER_LABEL[order]}`}
					</>
				)}
			</p>
			{evidence && <StrengthLegend />}
		</div>
	);
}

export function NoResults({
	outcome,
	spec,
	mode,
	onChange,
	onReviseQuery,
	onEditQuery,
}: {
	outcome: SearchOutcome;
	spec: SearchSpec;
	mode: SearchMode;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
}) {
	const reason = outcome.empty ?? { kind: "noConditions" };
	const state = emptyState(reason, {
		mode,
		conditions: spec.conditions,
		onChange,
		onEditQuery,
		onReviseQuery,
	});
	return (
		<Empty
			action={
				/* 筛掉了所有人时出路是清掉筛选，一次撤回，不是主操作 */
				<Button
					onClick={state.action.onClick}
					type={reason.kind === "filtered" ? "default" : "primary"}
				>
					{state.action.label}
				</Button>
			}
			className="py-16"
			description={state.hint}
			icon={SearchXIcon}
			title={state.title}
		/>
	);
}

/**
 * 这一轮没理解出来。记录停在「待理解」，名单那一列就停在这里——不是一份空名单：
 * 空名单在这个界面里的意思是「没有这样的人」。说的是哪一环坏了（`FAULT_COPY`），
 * 连不上时不能说成这句话没读懂。重试放在这里而不是右栏：窄屏上右栏是收着的，
 * 名单这一列总在眼前。
 */
export function NotUnderstood({
	fault,
	onRetry,
}: {
	fault: InterpretFault;
	onRetry: () => void;
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
			className="py-16"
			description={copy.hint}
			icon={MessageSquareWarningIcon}
			title={copy.title}
		/>
	);
}

const PHASE_TEXT = {
	interpreting: "正在理解你的需求…",
	searching: "正在搜索…",
} as const;

export type SearchPhase = keyof typeof PHASE_TEXT;

/** 等过这么久才写已等的秒数：短于它的等待数字刚出现就消失，只是一闪。 */
const ELAPSED_AFTER = 2100;

/** 这一步开始后过了几秒，整秒向下取；每一步重新计（调用处按 `phase` 换 key）。 */
function useElapsedSeconds(): number {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		const start = Date.now();
		const timer = setInterval(
			() => setSeconds(Math.floor((Date.now() - start) / 1000)),
			1000,
		);
		return () => clearInterval(timer);
	}, []);
	return seconds;
}

/** 在做什么，字上走流光；等过 2.1 秒后面跟一个「(12s)」。 */
function Waiting({ phase }: { phase: SearchPhase }) {
	const seconds = useElapsedSeconds();
	return (
		<>
			<Text shiny>{PHASE_TEXT[phase]}</Text>
			{seconds * 1000 >= ELAPSED_AFTER && (
				<Text className="tabular-nums" type="tertiary">
					({seconds}s)
				</Text>
			)}
		</>
	);
}
