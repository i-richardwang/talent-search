import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { EvidenceLine, MissedClaims } from "#/components/evidence";
import { Block, BlockLink } from "#/components/ui/block";
import { Button } from "#/components/ui/button";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";
import { Tooltip } from "#/components/ui/tooltip";
import { positionLabel } from "#/lib/format";
import type { Condition } from "#/search/condition";
import { conditionKey } from "#/search/condition";
import { claimName } from "#/search/condition-label";
import { claimsOf, type SearchOutcome } from "#/search/result";
import type { SearchSpec } from "#/search/spec";
import { RESULT_PAGE } from "#/search/weights";
import type { InterpretFault, SearchMode } from "#/server/turn";
import type { Picks } from "../-lib/picks";
import { reachOf, type View } from "../-lib/view-params";
import { PickDock } from "./pick-dock";
import {
	NoResults,
	NotUnderstood,
	ResultHeader,
	Searching,
	type SearchPhase,
} from "./result-state";

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
	mode,
	turnId,
	onChange,
	onReviseQuery,
	onEditQuery,
	picks,
	failure = null,
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
	/** 这次搜索是对话还是关键词：空态的出路说法不一样。 */
	mode: SearchMode;
	turnId: string;
	onChange: (next: Partial<View>) => void;
	onReviseQuery: (next: Condition[]) => void;
	onEditQuery: () => void;
	picks: Picks;
	/** 这一轮没理解出来：名单停在这里，说出哪一环坏了。 */
	failure?: { fault: InterpretFault; onRetry: () => void } | null;
}) {
	const { results, claims, order, total } = outcome;
	const reach = reachOf(total);
	// 名单上有证据行，或这一轮的条件搜出来会有：图例才有点可对照
	const evidence = claims.length > 0 || claimsOf(spec.conditions).length > 0;
	const pickable = !loading && results.length > 0;

	const head = (
		<div className="mb-2.5 flex items-start">
			<PickCell>
				{pickable && (
					<Tooltip title={`全选这 ${results.length} 人`}>
						{/* biome-ignore lint/a11y/noLabelWithoutControl: 方框就是这层标签里的控件 */}
						<label className="inline-flex items-center p-1">
							<Checkbox aria-label={`全选这 ${results.length} 人`} parent />
						</label>
					</Tooltip>
				)}
			</PickCell>
			<ResultHeader
				loading={loading}
				onPicking={picks.start}
				order={order}
				pickable={pickable}
				picking={picks.picking}
				evidence={evidence}
				total={total}
			/>
		</div>
	);

	const content = failure ? (
		<NotUnderstood fault={failure.fault} onRetry={failure.onRetry} />
	) : loading ? (
		<Searching phase={phase} />
	) : results.length === 0 ? (
		<NoResults
			mode={mode}
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
								{/* biome-ignore lint/a11y/noLabelWithoutControl: 方框就是这层标签里的控件 */}
								<label className="mt-2.5 inline-flex items-center p-1">
									<Checkbox aria-label={`选择 ${e.name}`} value={e.empId} />
								</label>
							</PickCell>
							<Block
								allowShrink
								className="scroll-mt-[calc(var(--chrome-height)+--spacing(4))] scroll-mb-4"
								clickable
								data-emp={e.empId}
								flex={1}
								paddingBlock={14}
								paddingInline={16}
								selected={selected}
								variant="outlined"
							>
								<div className="flex items-baseline gap-2.5">
									<BlockLink
										aria-current={selected ? "page" : undefined}
										className="shrink-0 truncate font-semibold text-lg"
										render={
											<Link
												params={{ turnId, empId: e.empId }}
												replace
												search={(prev) => prev}
												to="/s/$turnId/p/$empId"
											/>
										}
									>
										{e.name}
									</BlockLink>
									<span className="min-w-0 truncate text-fg-secondary text-base">
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
							</Block>
						</li>
					);
				})}
			</ul>

			{total > RESULT_PAGE && (
				<div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 py-6">
					<span className="text-fg-secondary text-xs">
						已显示 <b className="tabular-nums">{results.length}</b> 人{"，共 "}
						<b className="tabular-nums">{total}</b> 人
					</span>
					{canMore ? (
						<Button loading={growing} onClick={onMore} size="small">
							再加载 {RESULT_PAGE} 人
						</Button>
					) : (
						<span className="text-fg-secondary text-xs">
							{total > reach
								? `仅显示匹配度最高的 ${reach} 人。添加条件可以缩小范围。`
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
			className="group/list"
			data-picking={picks.picking || undefined}
			onChange={picks.setShown}
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
