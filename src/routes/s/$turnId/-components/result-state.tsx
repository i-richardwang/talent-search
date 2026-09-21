import { ListChecksIcon, SearchXIcon, XIcon } from "lucide-react";
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
import { emptyState } from "../-lib/empty-state";
import type { View } from "../-lib/view-params";

const ORDER_LABEL: Record<SearchOutcome["order"], string> = {
	evidence: "按证据排序",
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
	onChange,
	onReviseQuery,
	onEditQuery,
}: {
	outcome: SearchOutcome;
	spec: SearchSpec;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
}) {
	const state = emptyState(outcome.empty ?? { kind: "noConditions" }, {
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

const PHASE_TEXT = {
	interpreting: "正在整理搜索条件",
	searching: "正在查找符合条件的人",
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
