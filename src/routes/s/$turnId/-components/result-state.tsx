import { Link } from "@tanstack/react-router";
import {
	ListChecksIcon,
	MessageSquareWarningIcon,
	RotateCwIcon,
	SearchXIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { StrengthLegend } from "#/components/evidence";
import { Button } from "#/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#/components/ui/empty";
import { Separator } from "#/components/ui/separator";
import { Spinner } from "#/components/ui/spinner";
import type { Condition } from "#/search/condition";
import type { Claim, SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import type { InterpretFault, SearchMode } from "#/server/turn";
import { emptyState } from "../-lib/empty-state";
import { FAULT_COPY } from "../-lib/interpret";
import type { View } from "../-lib/view-params";

const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按匹配度排序",
	employee: "默认顺序",
};

export function ResultHeader({
	loading,
	order,
	total,
	claims,
	planned,
	picking,
	onPicking,
	pickable,
}: {
	loading: boolean;
	order: SearchOutcome["order"];
	total: number;
	claims: Claim[];
	planned: boolean;
	picking: boolean;
	onPicking: (on: boolean) => void;
	pickable: boolean;
}) {
	return (
		<div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
			<p className="text-muted-foreground text-sm" role="status">
				{loading ? (
					"搜索中…"
				) : (
					<>
						<b className="text-foreground tabular-nums">{total}</b> 人
						{` · ${ORDER_LABEL[order]}`}
					</>
				)}
			</p>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
				{(planned || claims.length > 0) && (
					<>
						<StrengthLegend />
						<Separator className="h-4 max-sm:hidden" orientation="vertical" />
					</>
				)}
				<Button
					disabled={!pickable}
					onClick={() => onPicking(!picking)}
					size="sm"
					variant="outline"
				>
					{picking ? <XIcon /> : <ListChecksIcon />}
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
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchXIcon />
				</EmptyMedia>
				<EmptyTitle>{state.title}</EmptyTitle>
				<EmptyDescription>{state.hint}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button onClick={state.action.onClick} variant="outline">
					{state.action.label}
				</Button>
			</EmptyContent>
		</Empty>
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
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<MessageSquareWarningIcon />
				</EmptyMedia>
				<EmptyTitle>{copy.title}</EmptyTitle>
				<EmptyDescription>{copy.hint}</EmptyDescription>
			</EmptyHeader>
			{(copy.retry || copy.keyword) && (
				<EmptyContent className="flex-row justify-center">
					{copy.retry && (
						<Button onClick={onRetry} variant="outline">
							<RotateCwIcon />
							重试
						</Button>
					)}
					{copy.keyword && (
						<Button
							render={<Link search={{ mode: "keyword" }} to="/" />}
							variant="ghost"
						>
							改用关键词搜索
						</Button>
					)}
				</EmptyContent>
			)}
		</Empty>
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
		<div className="flex min-h-[calc(100dvh-var(--chrome-height)-5rem)] flex-col items-center justify-center gap-4">
			<Spinner
				aria-hidden="true"
				aria-label={undefined}
				className="size-5 text-muted-foreground"
				role="presentation"
			/>
			<p className="font-medium text-sm" role="status">
				{PHASE_TEXT[phase]}
				{seconds !== null && (
					<span className="text-muted-foreground tabular-nums">
						{` · ${seconds} 秒`}
					</span>
				)}
			</p>
		</div>
	);
}
