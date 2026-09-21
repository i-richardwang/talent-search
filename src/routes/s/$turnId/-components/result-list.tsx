import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EvidenceLine, MissedClaims } from "#/components/evidence";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
import { Checkbox } from "#/components/ui/checkbox";
import { CheckboxGroup } from "#/components/ui/checkbox-group";
import { Label } from "#/components/ui/label";
import { Tooltip, TooltipPopup, TooltipTrigger } from "#/components/ui/tooltip";
import { positionLabel } from "#/lib/format";
import { cn } from "#/lib/utils";
import type { Condition } from "#/search/condition";
import { conditionKey } from "#/search/condition";
import { claimName } from "#/search/condition-label";
import { claimsOf, type SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import { RESULT_PAGE } from "#/search/weights";
import type { Picks } from "../-lib/picks";
import { reachOf, type View } from "../-lib/view-params";
import { PickDock } from "./pick-dock";
import {
	NoResults,
	ResultHeader,
	Searching,
	type SearchPhase,
} from "./result-state";

const PAD = "px-4 py-3.5";

function PickCell({ children }: { children?: ReactNode }) {
	return (
		<div className="invisible w-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-out group-data-picking/list:visible group-data-picking/list:w-(--pick-column)">
			{children}
		</div>
	);
}

export function ResultList({
	outcome,
	empId,
	loading,
	phase,
	canMore,
	growing,
	onAll,
	onMore,
	spec,
	turnId,
	onChange,
	onReviseQuery,
	onEditQuery,
	picks,
}: {
	outcome: SearchOutcome;
	empId: string | undefined;
	loading: boolean;
	phase: SearchPhase;
	canMore: boolean;
	growing: boolean;
	onAll: () => void;
	onMore: () => void;
	spec: SearchSpec;
	turnId: string;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
	picks: Picks;
}) {
	const { results, claims, order, total } = outcome;
	const reach = reachOf(total);
	const pending = claimsOf(spec.conditions);
	const pickable = !loading && results.length > 0;

	const head = (
		<div className="mb-2.5 flex items-start">
			<PickCell>
				{pickable && (
					<Tooltip>
						<TooltipTrigger
							render={
								<Label className="p-1">
									<Checkbox aria-label={`全选这 ${results.length} 人`} parent />
								</Label>
							}
						/>
						<TooltipPopup>全选这 {results.length} 人</TooltipPopup>
					</Tooltip>
				)}
			</PickCell>
			<ResultHeader
				loading={loading}
				onPicking={picks.start}
				order={order}
				pickable={pickable}
				picking={picks.picking}
				planned={pending.length > 0}
				claims={claims}
				total={total}
			/>
		</div>
	);

	const content = loading ? (
		<Searching phase={phase} />
	) : results.length === 0 ? (
		<NoResults
			onChange={onChange}
			onEditQuery={onEditQuery}
			onReviseQuery={onReviseQuery}
			outcome={outcome}
			spec={spec}
		/>
	) : (
		<>
			{head}
			<ul className="flex flex-col gap-2">
				{picks.rows.map(({ employee: e, hits, missed }) => {
					const selected = e.empId === empId;
					return (
						<li className="flex" key={e.empId}>
							<PickCell>
								<Label className="mt-2.5 p-1">
									<Checkbox aria-label={`选择 ${e.name}`} value={e.empId} />
								</Label>
							</PickCell>
							<Card
								className={cn(
									PAD,
									"min-w-0 flex-1 transition-[border-color,background-color]",
									"scroll-mt-[calc(var(--chrome-height)+--spacing(4))] scroll-mb-4",
									selected
										? "border-info/40 ring-1 ring-info/30"
										: "hoverable:hover:bg-accent/40",
								)}
								data-emp={e.empId}
							>
								<div className="flex items-baseline gap-2.5">
									<Link
										aria-current={selected ? "page" : undefined}
										className="title-2 shrink-0 truncate rounded-sm font-semibold after:absolute after:inset-0 after:content-['']"
										params={{ turnId, empId: e.empId }}
										replace
										search={(prev) => prev}
										to="/s/$turnId/p/$empId"
									>
										{e.name}
									</Link>
									<span className="min-w-0 truncate text-muted-foreground text-sm">
										{positionLabel(e)}
									</span>
								</div>
								{claims.length > 0 && (
									<div className="mt-3 space-y-1.5">
										{hits.map(({ claim, name, hit, basis }) => (
											<EvidenceLine
												basis={basis}
												boost={claim.mode === "boost"}
												hit={hit}
												key={conditionKey(claim)}
												name={name}
											/>
										))}
										<MissedClaims names={missed} />
									</div>
								)}
							</Card>
						</li>
					);
				})}
			</ul>

			{total > RESULT_PAGE && (
				<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-6">
					<span className="text-muted-foreground text-xs">
						已显示 <b className="tabular-nums">{results.length}</b> 人{"，共 "}
						<b className="tabular-nums">{total}</b> 人
					</span>
					{canMore ? (
						<Button
							loading={growing}
							onClick={onMore}
							size="sm"
							variant="outline"
						>
							再加载 {RESULT_PAGE} 人
						</Button>
					) : (
						<span className="text-muted-foreground text-xs">
							{total > reach
								? `名单按相关度只显示前 ${reach} 位。想看更靠后的人，把条件收窄。`
								: "已显示全部结果。"}
						</span>
					)}
				</div>
			)}
		</>
	);

	return (
		<CheckboxGroup
			allValues={picks.shownIds}
			aria-label="名单"
			className="group/list block"
			data-picking={picks.picking || undefined}
			onValueChange={(next) => picks.setShown(next.map(String))}
			value={picks.shownPicked}
		>
			{content}
			{picks.picking && (
				<PickDock
					loading={growing}
					names={claims.map(claimName)}
					onAll={onAll}
					picks={picks}
					total={total}
				/>
			)}
		</CheckboxGroup>
	);
}
