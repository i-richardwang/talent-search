import { Link } from "@tanstack/react-router";
import {
	ListChecksIcon,
	Loader2Icon,
	MessageSquareWarningIcon,
	RotateCwIcon,
	SearchXIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { StrengthLegend } from "#/components/evidence";
import { Button } from "#/components/ui/button";
import { Divider } from "#/components/ui/divider";
import { Empty } from "#/components/ui/empty";
import { Icon } from "#/components/ui/icon";
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

export function ResultHeader({
	loading,
	order,
	total,
	evidence,
	picking,
	onPicking,
	pickable,
}: {
	loading: boolean;
	order: SearchOutcome["order"];
	total: number;
	/** 名单上有证据行（或这一轮的条件会有）：图例才有点可对照。 */
	evidence: boolean;
	picking: boolean;
	onPicking: (on: boolean) => void;
	pickable: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
			<p className="text-fg-secondary text-base" role="status">
				{loading ? (
					"搜索中…"
				) : (
					<>
						<b className="text-fg tabular-nums">{total}</b> 人
						{` · ${ORDER_LABEL[order]}`}
					</>
				)}
			</p>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				{evidence && (
					<>
						<StrengthLegend />
						<Divider className="max-sm:hidden" orientation="vertical" />
					</>
				)}
				<Button
					disabled={!pickable}
					icon={picking ? XIcon : ListChecksIcon}
					onClick={() => onPicking(!picking)}
					size="small"
				>
					{picking ? "取消选择" : "选择"}
				</Button>
			</div>
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
	const state = emptyState(outcome.empty ?? { kind: "noConditions" }, {
		mode,
		conditions: spec.conditions,
		onChange,
		onEditQuery,
		onReviseQuery,
	});
	return (
		<Empty
			action={
				<Button onClick={state.action.onClick}>{state.action.label}</Button>
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
						<Button icon={RotateCwIcon} key={exit} onClick={onRetry}>
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
	interpreting: "正在理解你的需求",
	searching: "正在搜索",
} as const;

export type SearchPhase = keyof typeof PHASE_TEXT;

function useElapsed(): number | null {
	const [ms, setMs] = useState(0);
	useEffect(() => {
		const start = Date.now();
		const timer = setInterval(() => setMs(Date.now() - start), 1000);
		return () => clearInterval(timer);
	}, []);
	return ms >= 5000 ? Math.round(ms / 1000) : null;
}

export function Searching({ phase }: { phase: SearchPhase }) {
	const seconds = useElapsed();
	return (
		<div className="flex flex-col items-center justify-center gap-4 py-24">
			<Icon
				aria-hidden="true"
				className="text-fg-secondary"
				icon={Loader2Icon}
				size={20}
				spin
			/>
			<p className="font-medium text-base" role="status">
				{PHASE_TEXT[phase]}
				{seconds !== null && (
					<span className="text-fg-secondary tabular-nums">
						{` · ${seconds} 秒`}
					</span>
				)}
			</p>
		</div>
	);
}
